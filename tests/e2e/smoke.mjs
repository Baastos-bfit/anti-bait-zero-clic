/**
 * Test de fumée E2E : charge l'extension dans un Chromium headless (profil
 * jetable, supprimé à la fin) et la pilote via le protocole DevTools (CDP).
 *
 * Usage :
 *   node tests/e2e/smoke.mjs "<chemin du navigateur>" "<dossier de l'extension>" "<dossier de travail>"
 * Exemple (Windows, Edge — Chrome stable ignore --load-extension depuis la v137) :
 *   node tests/e2e/smoke.mjs "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" . %TEMP%
 *
 * Vérifie : chargement du worker, coffre chiffré (IndexedDB réelle), page
 * d'options, survol sur une page x.com simulée (interception réseau), Shadow
 * DOM fermé, monde isolé, fermeture de l'infobulle.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [browserPath, extDir, workDir] = process.argv.slice(2);
const PORT = 9333;
const profile = path.join(workDir, 'profile-' + Date.now());
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

let ws, seq = 0;
const pending = new Map();
const listeners = [];
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
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
    } else for (const l of listeners) l(msg);
  };
  console.log('Navigateur :', version.Browser);

  // 1. Service worker de l'extension
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) {
    const { targetInfos } = await send('Target.getTargets');
    sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background/service-worker.js'));
    if (!sw) await sleep(250);
  }
  check('service worker enregistré (importScripts OK)', Boolean(sw), sw?.url);
  if (!sw) throw new Error('extension non chargée');
  const extId = new URL(sw.url).host;
  const swSession = await attach(sw.targetId);
  await send('Runtime.enable', {}, swSession).catch(() => {});
  await send('Runtime.runIfWaitingForDebugger', {}, swSession).catch(() => {});
  await sleep(1000);

  const modules = await evaluate(swSession, 'Object.keys(self.AntiBait).sort().join(",")');
  check('modules du worker chargés', ['ai', 'cache', 'mediaSites', 'premium', 'scraper', 'settings', 'vault'].every((m) => modules.split(',').includes(m)), modules);

  let vaultOk = false;
  try {
  const vault = await evaluate(swSession, `(async () => {
    const hint = await AntiBait.settings.setApiKey('anthropic', 'sk-ant-fake-e2e-0123456789abcdefWXYZ');
    const back = await AntiBait.settings.getApiKey('anthropic');
    const raw = JSON.stringify(await chrome.storage.local.get('apiKeys'));
    return { hint, roundtrip: back === 'sk-ant-fake-e2e-0123456789abcdefWXYZ', leaked: raw.includes('0123456789abcdef') };
  })()`);
  check('coffre : IndexedDB + AES-GCM réels, clé relue', vault.roundtrip && vault.hint === '…WXYZ');
  check('coffre : aucune trace de la clé en clair dans chrome.storage', vault.leaked === false);

    vaultOk = true;
  } catch (e) { check('coffre (IndexedDB) dans ce bac à sable', false, e.message); }
  const access = await evaluate(swSession, `chrome.storage.session.get(null).then(() => 'ok')`);
  check('chrome.storage.session accessible au worker', access === 'ok');

  const quota = await evaluate(swSession, `AntiBait.premium.getStatus().then(s => s)`);
  check('statut Premium/quota (ExtensionPay hors ligne → repli gratuit)', quota.premium === false && quota.limit === 10, JSON.stringify(quota));

  // 2. Page d'options
  const { targetId: optTarget } = await send('Target.createTarget', { url: `chrome-extension://${extId}/src/options/options.html` });
  const optSession = await attach(optTarget);
  await send('Runtime.enable', {}, optSession);
  await sleep(1500);
  const opt = await evaluate(optSession, `({
    keyState: document.getElementById('key-state').textContent,
    access: document.getElementById('access-badge').textContent,
    premium: document.getElementById('premium-status').textContent,
    providers: document.getElementById('provider').options.length
  })`);
  check('options : état chargé depuis le worker', (vaultOk ? opt.keyState.includes('…WXYZ') : opt.keyState.length > 0) && opt.providers === 2, JSON.stringify(opt));
  const forbidden = await evaluate(optSession, `chrome.runtime.sendMessage({ type: 'getState' }).then(r => r.ok)`);
  check('options : messages de gestion autorisés depuis la page de l’extension', forbidden === true);

  // 3. Page x.com simulée (interception réseau) + survol d'un lien t.co
  const { targetId: pageTarget } = await send('Target.createTarget', { url: 'about:blank' });
  const pageSession = await attach(pageTarget);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://x.com/*' }] }, pageSession);
  const fakePage = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:16px sans-serif">
    <div style="padding:40px"><a id="bait" href="https://t.co/abc123" style="display:inline-block;padding:10px">Vous ne croirez jamais ce que cette star a fait</a></div>
    <div style="padding:40px"><a id="internal" href="https://x.com/someone" style="display:inline-block;padding:10px">@someone</a></div></body></html>`;
  listeners.push((msg) => {
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId === pageSession) {
      send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(fakePage).toString('base64'),
      }, pageSession).catch(() => {});
    }
  });
  await send('Page.enable', {}, pageSession);
  await send('Page.navigate', { url: 'https://x.com/home' }, pageSession);
  await sleep(2000);

  const rectOf = (id) => evaluate(pageSession, `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const move = (p) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }, pageSession);

  async function tooltipText() {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }, pageSession);
    const texts = [];
    let hostFound = false;
    let cardHidden = null;
    (function walk(n, inHost) {
      if (n.nodeName === 'ANTI-BAIT-ROOT') { hostFound = true; inHost = true; }
      if (inHost && n.nodeName === 'DIV' && (n.attributes || []).includes('card')) cardHidden = n.attributes.includes('hidden');
      if (inHost && n.nodeType === 3 && n.nodeValue.trim() && !n.nodeValue.includes('{')) texts.push(n.nodeValue.trim());
      for (const c of n.children || []) walk(c, inHost);
      for (const s of n.shadowRoots || []) walk(s, inHost);
    })(root, false);
    return { hostFound, cardHidden, text: texts.join(' | ') };
  }

  // Survol éclair (< délai) : rien ne doit apparaître.
  const bait = await rectOf('bait');
  await move(bait);
  await sleep(150);
  await move({ x: 5, y: 400 });
  await sleep(1000);
  let tip = await tooltipText();
  check('survol éclair (150 ms) : aucune infobulle', !tip.text.includes('Autorisez') && !tip.text.includes('clé API'), tip.text);

  // Lien interne x.com : jamais d'analyse.
  await move(await rectOf('internal'));
  await sleep(1200);
  tip = await tooltipText();
  check('lien interne x.com ignoré', !tip.text.includes('Autorisez') && !tip.text.includes('clé API') && !tip.text.includes('Lecture'), tip.text);

  // Arrêt sur le lien t.co : infobulle avec erreur « Autorisez… » (permission optionnelle non accordée).
  await move({ x: 5, y: 400 });
  await sleep(500);
  await move(bait);
  await sleep(2000);
  tip = await tooltipText();
  check('arrêt sur un lien t.co : infobulle Shadow DOM affichée', tip.hostFound && tip.text.includes('Anti-Bait'), tip.text);
  check('erreur guidée affichée (clé ou permission manquante) + bouton d’action', (tip.text.includes('Autorisez Anti-Bait') && tip.text.includes('Autoriser')) || (tip.text.includes('clé API') && tip.text.includes('Ouvrir les réglages')), tip.text);

  const pageIsolation = await evaluate(pageSession, `(() => { const h = document.querySelector('anti-bait-root'); return { shadowHidden: h && h.shadowRoot === null, pageCanSeeAB: typeof window.AntiBait }; })()`);
  check('Shadow DOM fermé : la page ne peut pas lire l’infobulle', pageIsolation.shadowHidden === true);
  check('monde isolé : la page ne voit pas le code de l’extension', pageIsolation.pageCanSeeAB === 'undefined');

  // Quitter le lien : l'infobulle disparaît après le délai de grâce.
  await move({ x: 5, y: 600 });
  await sleep(800);
  const hidden = await evaluate(pageSession, `(() => { const h = document.querySelector('anti-bait-root'); return h ? 'present' : 'absent'; })()`);
  tip = await tooltipText();
  check('départ du lien : infobulle refermée (carte masquée, texte vidé)', tip.cardHidden === true && !tip.text.includes('clé API'), `${hidden} hidden=${tip.cardHidden} / ${tip.text}`);

} catch (err) {
  check('exécution du scénario', false, err.message);
} finally {
  try { ws?.close(); } catch {}
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
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed ? 1 : 0);
}
