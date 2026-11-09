/**
 * Test E2E v2 (tâche 4.6) : page d'options — langue, format par défaut,
 * carte « Vos statistiques », confirmation de remise à zéro, thèmes.
 *
 * Usage :
 *   node tests/e2e/options-v2.mjs "<navigateur>" "<dossier de l'extension>" "<dossier de sortie>"
 * (Edge ou Chromium — Chrome stable ignore --load-extension depuis la v137.)
 * Produit des captures dans le dossier de sortie.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [browserPath, extDir, outDir] = process.argv.slice(2);
const PORT = 9335;
const profile = path.join(outDir, 'profile-' + Date.now());
fs.mkdirSync(profile, { recursive: true });

const proc = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${extDir}`,
  `--load-extension=${extDir}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}
async function getJson(p) {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error('CDP injoignable');
}

try {
  const version = await getJson('/json/version');
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  console.log('Navigateur :', version.Browser);

  // Service worker
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) {
    const { targetInfos } = await send('Target.getTargets');
    sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background/service-worker.js'));
    if (!sw) await sleep(250);
  }
  if (!sw) throw new Error('extension non chargée');
  const swS = await attach(sw.targetId);
  await send('Runtime.enable', {}, swS).catch(() => {});
  await send('Runtime.runIfWaitingForDebugger', {}, swS).catch(() => {});
  await sleep(800);
  const extId = new URL(sw.url).host;
  await evaluate(swS, `(async () => {
    await AntiBait.stats.reset();
    for (let i = 0; i < 45; i++) await AntiBait.stats.recordAvoidedClick('https://site.fr/article-' + i);
  })()`);
  const storedSettings = () => evaluate(swS, `chrome.storage.local.get('settings').then((d) => d.settings || {})`);

  // Page d'options (grande hauteur : toute la page tient dans la fenêtre pour les captures)
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const page = await attach(targetId);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 3000, deviceScaleFactor: 2, mobile: false }, page);
  const theme = (value) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }, page);
  await theme('light');
  await send('Page.enable', {}, page);
  const openOptions = async () => {
    await send('Page.navigate', { url: `chrome-extension://${extId}/src/options/options.html` }, page);
    await sleep(1500);
  };
  const q = (js) => evaluate(page, js);
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function shot(name, selectors) {
    const box = await q(`(() => {
      const rects = ${JSON.stringify(selectors)}.map((s) => document.querySelector(s).getBoundingClientRect());
      const x = Math.min(...rects.map((r) => r.left)) - 16, y = Math.min(...rects.map((r) => r.top)) - 16;
      const r = Math.max(...rects.map((r) => r.right)) + 16, b = Math.max(...rects.map((r) => r.bottom)) + 16;
      return { x: Math.max(0, x), y: Math.max(0, y), width: r - Math.max(0, x), height: b - Math.max(0, y) };
    })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } }, page);
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  const shots = [];

  // ── 1. Compte GRATUIT ───────────────────────────────────────────────────
  await openOptions();
  check('3 choix de langue, « Langue du navigateur » par défaut',
    (await q(`[...document.querySelectorAll('input[name=language]')].map((r) => r.value + (r.checked ? '*' : '')).join(',')`)) === 'browser*,fr,article');
  check('gratuit : « Puces » marqué 🔒 Premium',
    (await q(`!document.getElementById('bullets-badge').hidden && document.getElementById('format-bullets-choice').classList.contains('locked')`)) === true,
    await q(`document.getElementById('bullets-badge').textContent`));

  await click('input[name=format][value=bullets]');
  await sleep(300);
  check('gratuit : clic sur « Puces » → reste sur « Une phrase »',
    (await q(`document.querySelector('input[name=format]:checked').value`)) === 'sentence');
  check('gratuit : incitation Premium affichée',
    /réservé à la version Premium/.test(await q(`document.getElementById('answers-feedback').textContent`)) &&
      (await q(`!document.getElementById('answers-upgrade').hidden`)) === true);
  check('gratuit : rien n’est enregistré côté worker', ((await storedSettings()).format || 'sentence') === 'sentence');
  // Même en forçant la requête, le worker refuse (le cadenas n'est pas la seule barrière).
  const forced = await q(`chrome.runtime.sendMessage({ type: 'saveSettings', settings: { format: 'bullets' } })`);
  check('SecOps : requête forcée « Puces » refusée par le worker', forced.ok === false && forced.error.code === 'PREMIUM_REQUIRED', JSON.stringify(forced.error));

  await click('input[name=language][value=fr]');
  await sleep(300);
  check('langue « Toujours en français » enregistrée', (await storedSettings()).language === 'fr');

  check('gratuit : carte statistiques verrouillée',
    (await q(`!document.getElementById('stats-locked').hidden && document.getElementById('stats-unlocked').hidden`)) === true);
  check('gratuit : texte incitatif', /Débloquez vos statistiques détaillées/.test(await q(`document.querySelector('.lock-text').textContent`)));
  const pageText = await q('document.body.innerText');
  check('gratuit : aucun vrai chiffre affiché (45 clics / 1 h 30 min)', !/1 h 30 min/.test(pageText) && !/\b45\b/.test(pageText));
  shots.push(await shot('v2-options-gratuit.png', ['#answers', '#stats']));

  // ── 2. Compte PREMIUM ───────────────────────────────────────────────────
  await evaluate(swS, `(async () => {
    await chrome.storage.sync.set({ extensionpay_api_key: 'e2e-invalid-key' });
    await AntiBait.vault.secureStore.set('premiumLastKnown', { paid: true, checkedAt: Date.now() });
    return AntiBait.premium.isPremium({ force: true });
  })()`);
  await openOptions();
  check('premium : badge 🔒 retiré', (await q(`document.getElementById('bullets-badge').hidden`)) === true);
  await click('input[name=format][value=bullets]');
  await sleep(400);
  check('premium : format par défaut « Puces » enregistré', (await storedSettings()).format === 'bullets');
  check('premium : statistiques déverrouillées', (await q(`!document.getElementById('stats-unlocked').hidden && document.getElementById('stats-locked').hidden`)) === true);
  const time = await q(`document.getElementById('stats-time').textContent`);
  const clicks = await q(`document.getElementById('stats-clicks').textContent + ' ' + document.getElementById('stats-clicks-label').textContent`);
  check('premium : temps gagné calculé (45 clics × 2 min)', time === '1 h 30 min', time);
  check('premium : clics évités', clicks === '45 clics évités', clicks);
  shots.push(await shot('v2-options-premium-clair.png', ['#answers', '#stats']));

  // Thème sombre : bascule fluide (variables CSS) et capture.
  const bgLight = await q(`getComputedStyle(document.body).backgroundColor`);
  await theme('dark');
  await sleep(400); // transitions de 200 ms
  const bgDark = await q(`getComputedStyle(document.body).backgroundColor`);
  check('thème sombre appliqué', bgLight !== bgDark, `${bgLight} → ${bgDark}`);
  shots.push(await shot('v2-options-premium-sombre.png', ['#answers', '#stats']));

  // Mise à jour en direct : un lien analysé ailleurs fait évoluer la carte.
  await evaluate(swS, `AntiBait.stats.recordAvoidedClick('https://site.fr/nouvel-article')`);
  await sleep(600);
  check('mise à jour en direct (46 clics → 1 h 32 min)', (await q(`document.getElementById('stats-time').textContent`)) === '1 h 32 min');

  // Remise à zéro : boîte de confirmation, Annuler puis Confirmer.
  await click('#stats-reset');
  await sleep(300);
  check('remise à zéro : boîte de confirmation ouverte', (await q(`document.getElementById('reset-dialog').open`)) === true);
  shots.push(await shot('v2-options-confirmation.png', ['#reset-dialog']));
  await q(`document.querySelector('#reset-dialog button[value=cancel]').click()`);
  await sleep(300);
  check('« Annuler » ne change rien', (await q(`document.getElementById('stats-time').textContent`)) === '1 h 32 min' &&
    (await q(`document.getElementById('reset-dialog').open`)) === false);
  await click('#stats-reset');
  await sleep(300);
  await q(`document.getElementById('reset-confirm').click()`);
  await sleep(600);
  check('« Remettre à zéro » → 0 min, bouton désactivé',
    (await q(`document.getElementById('stats-time').textContent`)) === '0 min' &&
      (await q(`document.getElementById('stats-reset').disabled`)) === true);
  check('stats remises à zéro côté worker', (await evaluate(swS, 'AntiBait.stats.read()')).clicksAvoided === 0);

  console.log('\nCaptures :\n  ' + shots.join('\n  '));
} catch (err) {
  check('exécution du scénario', false, err.stack || err.message);
} finally {
  try {
    ws?.close();
  } catch {}
  // Edge relance son processus principal sous un autre PID : on arrête tous les
  // processus qui utilisent CE profil jetable (unique à ce run), et eux seuls.
  try {
    proc.kill();
    if (process.platform === 'win32') {
      const tag = path.basename(profile);
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { stdio: 'ignore' });
    }
  } catch {}
  await sleep(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed ? 1 : 0);
}
