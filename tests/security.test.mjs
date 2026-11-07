/**
 * Tests SecOps : garde d'URL (anti-SSRF), domaines, coffre chiffré, quota et
 * statut Premium infalsifiables.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, fakeStorageArea, memoryKeyProvider } from './helpers/load.mjs';

const BG = [
  'src/shared/domain-utils.js',
  'src/background/config.js',
  'src/background/errors.js',
  'src/background/url-guard.js',
];

test('url-guard : seules les URL HTTPS publiques passent', () => {
  const { AntiBait } = loadScripts(BG);
  const ok = (u) => AntiBait.urlGuard.validate(u).ok;
  const code = (u) => AntiBait.urlGuard.validate(u).code;

  assert.equal(ok('https://www.lemonde.fr/article-1.html#comments'), true);
  assert.equal(AntiBait.urlGuard.validate('https://t.co/abc#x').url.href, 'https://t.co/abc');
  assert.equal(code('http://example.com/'), 'INSECURE_URL');
  assert.equal(code('javascript:alert(1)'), 'INVALID_URL');
  assert.equal(code('https://user:pass@example.com/'), 'INVALID_URL');
  assert.equal(code('https://192.168.1.1/admin'), 'BLOCKED_HOST');
  assert.equal(code('https://127.0.0.1/'), 'BLOCKED_HOST');
  assert.equal(code('https://[::1]/'), 'BLOCKED_HOST');
  assert.equal(code('https://localhost/'), 'BLOCKED_HOST');
  assert.equal(code('https://nas.local/'), 'BLOCKED_HOST');
  assert.equal(code('https://intranet/'), 'BLOCKED_HOST');
  assert.equal(code('https://example.com:8443/'), 'BLOCKED_HOST');
  assert.equal(code('https://0x7f.0.0.1/'), 'BLOCKED_HOST'); // normalisé en 127.0.0.1 par URL
  assert.equal(code('https://2130706433/'), 'BLOCKED_HOST'); // IP décimale
  assert.equal(code('x'.repeat(3000)), 'INVALID_URL');
  assert.equal(code(42), 'INVALID_URL');
});

test('domain-utils : normalisation, redirecteurs, plateformes', () => {
  const { AntiBait } = loadScripts(['src/shared/domain-utils.js']);
  const D = AntiBait.domain;
  assert.equal(D.normalizeDomain(' https://www.LeMonde.fr/politique '), 'lemonde.fr');
  assert.equal(D.normalizeDomain('bfmtv.com'), 'bfmtv.com');
  assert.equal(D.normalizeDomain('10.0.0.1'), null);
  assert.equal(D.normalizeDomain('localhost'), null);
  assert.equal(D.normalizeDomain('ftp://site.com'), null);
  assert.equal(D.normalizeDomain(''), null);

  const li = new URL('https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fwww.lefigaro.fr%2Fa-b-c&urlhash=x');
  assert.equal(D.unwrapRedirector(li).href, 'https://www.lefigaro.fr/a-b-c');
  const safety = new URL('https://fr.linkedin.com/safety/go?url=https%3A%2F%2Fwww.20minutes.fr%2Fsociete%2F123-titre&trk=public_post');
  assert.equal(D.unwrapRedirector(safety).href, 'https://www.20minutes.fr/societe/123-titre');
  const evil = new URL('https://www.linkedin.com/redir/redirect?url=javascript%3Aalert(1)');
  assert.equal(D.unwrapRedirector(evil).href, evil.href, 'les schémas dangereux ne sont pas déballés');

  assert.equal(D.isSocialHost('mobile.twitter.com'), true);
  assert.equal(D.isSocialHost('t.co'), false, 't.co est un lien sortant, pas une page sociale');
  assert.equal(D.isSocialHost('lnkd.in'), false);
  assert.equal(D.isSameSite('www.lemonde.fr', 'lemonde.fr'), true);
  assert.equal(D.isSameSite('lemonde.fr', 'monde.fr'), false);
});

async function loadVaultContext(extraFiles = [], extraGlobals = {}) {
  const local = fakeStorageArea();
  const ctx = loadScripts([...BG, 'src/background/vault.js', ...extraFiles], {
    chrome: { storage: { local }, i18n: { getUILanguage: () => 'fr' } },
    ...extraGlobals,
  });
  ctx.AntiBait.vault.useKeyProvider(await memoryKeyProvider());
  return { ctx, local };
}

test('vault : chiffrement AES-GCM, liaison à l’usage (AAD), détection de falsification', async () => {
  const { ctx } = await loadVaultContext();
  const { vault } = ctx.AntiBait;
  const secret = 'sk-ant-fake-SECRET-0123456789';
  const blob = await vault.encrypt(secret, 'apikey:anthropic');
  assert.ok(!JSON.stringify(blob).includes('SECRET'), 'le clair ne doit pas apparaître');
  assert.equal(await vault.decrypt(blob, 'apikey:anthropic'), secret);
  await assert.rejects(vault.decrypt(blob, 'apikey:openai'), 'AAD différente → refus');
  const tampered = { ...blob, ct: blob.ct.slice(0, -4) + (blob.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(vault.decrypt(tampered, 'apikey:anthropic'), 'chiffré modifié → refus');
  const again = await vault.encrypt(secret, 'apikey:anthropic');
  assert.notEqual(again.iv, blob.iv, 'IV unique à chaque chiffrement');
});

test('settings : la clé est stockée chiffrée et seul un indice est exposé', async () => {
  const { ctx, local } = await loadVaultContext(['src/background/settings.js']);
  const { settings } = ctx.AntiBait;
  const key = 'sk-ant-fake-abcdefghijklmnopqrstuvwxyz-WXYZ';
  const hint = await settings.setApiKey('anthropic', key);
  assert.equal(hint, '…WXYZ');
  assert.ok(!JSON.stringify([...local.data.values()]).includes('abcdefghijkl'), 'aucune trace en clair');
  assert.equal(await settings.getApiKey('anthropic'), key);
  assert.equal(JSON.stringify(await settings.getKeyHints()), JSON.stringify({ anthropic: '…WXYZ', openai: null }));
  await assert.rejects(settings.setApiKey('openai', key), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(settings.setApiKey('anthropic', 'sk-ant-trop court'), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(settings.getApiKey('openai'), (e) => e.code === 'NO_API_KEY');
  // Falsification du stockage → KEY_UNREADABLE, jamais une clé corrompue.
  local.data.get('apiKeys').anthropic.ct = 'AAAA';
  await assert.rejects(settings.getApiKey('anthropic'), (e) => e.code === 'KEY_UNREADABLE');
  await assert.rejects(settings.getApiKey('evil'), (e) => e.code === 'BAD_REQUEST');
});

test('settings : assainissement des réglages', async () => {
  const { ctx } = await loadVaultContext(['src/background/settings.js']);
  const s = ctx.AntiBait.settings.sanitizeSettings;
  const plain = (o) => JSON.parse(JSON.stringify(o));
  assert.deepEqual(plain(s({})), { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', hoverDelayMs: 600 });
  assert.deepEqual(plain(s({ provider: 'openai', model: 'claude-opus-5-5', hoverDelayMs: 99999 })), {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    hoverDelayMs: 2000,
  });
  assert.equal(s({ provider: '__proto__' }).provider, 'anthropic');
  assert.equal(s({ model: '<script>' }).model, 'claude-opus-5-5');
});

/** Contexte complet Premium avec un faux ExtPay pilotable. */
async function loadPremium({ paid = false, failing = false } = {}) {
  const ext = { paid, failing, calls: 0, startedBackground: false, onPaid: [] };
  const ExtPay = () => ({
    startBackground: () => {
      ext.startedBackground = true;
    },
    getUser: async () => {
      ext.calls++;
      if (ext.failing) throw new Error('réseau');
      return { paid: ext.paid };
    },
    onPaid: { addListener: (cb) => ext.onPaid.push(cb) },
    openPaymentPage: async () => {},
    openLoginPage: async () => {},
  });
  const { ctx, local } = await loadVaultContext(['src/background/premium.js'], { ExtPay });
  return { premium: ctx.AntiBait.premium, ext, local };
}

test('quota gratuit : 10 analyses/jour, réservations concurrentes sans dépassement', async () => {
  const { premium, ext } = await loadPremium();
  assert.equal(ext.startedBackground, true, 'startBackground() appelé au chargement');
  const results = await Promise.all(Array.from({ length: 25 }, () => premium.reserve()));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal(results.filter((r) => !r.ok).length, 15);
  const status = await premium.getStatus();
  assert.equal(status.used, 10);
  assert.equal(status.remaining, 0);
});

test('quota : remboursement après échec', async () => {
  const { premium } = await loadPremium();
  const r = await premium.reserve();
  assert.equal((await premium.getStatus()).used, 1);
  await premium.refund(r.reservation);
  assert.equal((await premium.getStatus()).used, 0);
  await premium.refund(null); // sans effet
  assert.equal((await premium.getStatus()).used, 0);
});

test('quota : un compteur falsifié dans chrome.storage.local est ignoré', async () => {
  const { premium, local } = await loadPremium();
  for (let i = 0; i < 10; i++) await premium.reserve();
  assert.equal((await premium.reserve()).ok, false);
  // Un attaquant remplace le compteur chiffré par une valeur forgée en clair.
  local.data.set('quota', { day: 'x', used: 0 });
  // Valeur illisible → refus par défaut : quota épuisé pour aujourd'hui.
  assert.equal((await premium.getStatus()).used, 10);
  assert.equal((await premium.reserve()).ok, false);
  // La valeur a été réécrite proprement (chiffrée) : plus d'état « invalide ».
  assert.equal(typeof local.data.get('quota').ct, 'string');
});

test('Premium : décidé par ExtensionPay uniquement, falsification sans effet', async () => {
  const { premium, ext, local } = await loadPremium({ paid: false, failing: true });
  // Le dernier statut connu est forgé en clair : doit être rejeté.
  local.data.set('premiumLastKnown', { paid: true, checkedAt: Date.now() });
  assert.equal(await premium.isPremium({ force: true }), false);

  ext.failing = false;
  ext.paid = true;
  assert.equal(await premium.isPremium({ force: true }), true);
  const r = await premium.reserve();
  assert.equal(r.ok, true);
  assert.equal(r.premium, true);
  assert.equal(r.remaining, null);

  // Panne ExtensionPay ensuite : repli sur le dernier statut chiffré (payant non bloqué).
  ext.failing = true;
  assert.equal(await premium.isPremium({ force: true }), true);
});

test('Premium : statut mis en cache (pas un appel réseau par survol)', async () => {
  const { premium, ext } = await loadPremium({ paid: true });
  for (let i = 0; i < 30; i++) await premium.reserve();
  assert.equal(ext.calls, 1);
});
