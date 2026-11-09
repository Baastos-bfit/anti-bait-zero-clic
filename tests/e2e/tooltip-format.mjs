/**
 * Test E2E v2 (tâche 4.4) : sélecteur de format dans l'infobulle.
 *
 * Usage :
 *   node tests/e2e/tooltip-format.mjs "<navigateur>" "<dossier de l'extension>" "<dossier de sortie>"
 * (Edge ou Chromium — Chrome stable ignore --load-extension depuis la v137.)
 *
 * Sans clé API ni réseau IA : le cache du service worker est pré-rempli avec
 * une réponse « phrase » et une réponse « puces » pour un lien t.co.
 * Vérifie, sur une page x.com simulée :
 *   - CSS hostile de la page (button { display:none !important }, Comic Sans…) sans effet ;
 *   - compte gratuit : « 🔒 Puces » → incitation Premium + page ExtensionPay, infobulle intacte ;
 *   - compte Premium : bascule phrase ↔ puces, infobulle jamais refermée ;
 *   - aucun clic dans l'infobulle ne remonte aux gestionnaires de la page.
 * Produit des captures dans le dossier de sortie.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [browserPath, extDir, outDir] = process.argv.slice(2);
const PORT = 9334;
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

// ── Protocole DevTools ────────────────────────────────────────────────────
let ws;
let seq = 0;
const pending = new Map();
const listeners = [];
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

// ── Pages x.com simulées ──────────────────────────────────────────────────
const BAIT_URL = 'https://t.co/abc123';
const HOSTILE_CSS = `
  * { font-family: "Comic Sans MS", cursive !important; color: lime !important; letter-spacing: 3px !important; }
  button { display: none !important; }
  div { padding: 30px !important; background: hotpink !important; }
  [role=group], [aria-pressed] { display: none !important; visibility: hidden !important; }
  anti-bait-root { display: none; }
`;
function page({ hostile }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <style>
    body { margin: 0; background: #fff; font: 15px/1.4 system-ui, sans-serif; color: #0f1419; }
    .tweet { width: 560px; margin: 40px auto; padding: 16px; border: 1px solid #eff3f4; border-radius: 16px; }
    .who { font-weight: 700; } .who span { color: #536471; font-weight: 400; }
    .card { display: block; margin-top: 12px; border: 1px solid #cfd9de; border-radius: 16px; overflow: hidden; color: inherit; text-decoration: none; }
    .card .img { height: 140px; background: linear-gradient(135deg, #f7c59f, #e8452c); }
    .card .meta { padding: 10px 12px; }
    .card .site { color: #536471; font-size: 13px; }
    ${hostile ? HOSTILE_CSS : ''}
  </style></head><body>
  <div class="tweet">
    <div class="who">Le Journal du Web <span>@journalduweb · 2 h</span></div>
    <p>Les médecins sont formels 😱</p>
    <a id="bait" class="card" href="${BAIT_URL}" aria-label="Cet aliment que les médecins déconseillent fortement : vous en mangez tous les jours">
      <div class="img"></div>
      <div class="meta"><div class="site">lejournaldu.web</div>
      <div>Cet aliment que les médecins déconseillent fortement : vous en mangez tous les jours</div></div>
    </a>
  </div>
  <script>window.__pageClicks = 0; document.addEventListener('click', () => window.__pageClicks++);</script>
  </body></html>`;
}

const SENTENCE = 'La charcuterie industrielle, à cause des nitrites ajoutés, selon une nouvelle étude de l’Inserm.';
const BULLETS =
  '• La charcuterie industrielle (jambon, saucisson, lardons)\n• En cause : les nitrites ajoutés, liés au cancer colorectal\n• Source : étude de l’Inserm sur 100 000 adultes';

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

  // 1. Service worker : pré-remplissage du cache (phrase + puces).
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) {
    const { targetInfos } = await send('Target.getTargets');
    sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background/service-worker.js'));
    if (!sw) await sleep(250);
  }
  if (!sw) throw new Error('extension non chargée');
  const swSession = await attach(sw.targetId);
  await send('Runtime.enable', {}, swSession).catch(() => {});
  await send('Runtime.runIfWaitingForDebugger', {}, swSession).catch(() => {});
  await sleep(800);
  await evaluate(swSession, `(async () => {
    const language = AntiBait.ai.resolveLanguage('browser').id;
    const entry = (text) => ({ text, title: 'Article', finalUrl: '${BAIT_URL}' });
    await AntiBait.cache.set('${BAIT_URL}', { language, format: 'sentence' }, entry(${JSON.stringify(SENTENCE)}));
    await AntiBait.cache.set('${BAIT_URL}', { language, format: 'bullets' }, entry(${JSON.stringify(BULLETS)}));
    return language;
  })()`);
  check('cache du worker pré-rempli (phrase + puces)', true);

  // 2. Onglet x.com simulé (interception réseau).
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const tab = await attach(targetId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }, tab);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, tab);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://x.com/*' }] }, tab);
  listeners.push((msg) => {
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId === tab) {
      const hostile = msg.params.request.url.includes('hostile');
      send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(page({ hostile })).toString('base64'),
      }, tab).catch(() => {});
    }
  });
  await send('Page.enable', {}, tab);
  await send('DOM.enable', {}, tab);
  await send('CSS.enable', {}, tab);

  const navigate = async (url) => {
    await send('Page.navigate', { url }, tab);
    await sleep(1800);
  };
  const center = async (selector) =>
    evaluate(tab, `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const move = (p) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }, tab);
  const click = async (p) => {
    await move(p);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }, tab);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }, tab);
  };

  /** Inspecte l'infobulle à travers le Shadow DOM fermé (DOM.getDocument pierce). */
  async function inspect() {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }, tab);
    const out = { card: null, answer: '', notice: '', status: '', buttons: [] };
    const attrs = (n) => {
      const a = {};
      for (let i = 0; i < (n.attributes || []).length; i += 2) a[n.attributes[i]] = n.attributes[i + 1];
      return a;
    };
    const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children || []).map(textOf).join(''));
    (function walk(n) {
      const a = attrs(n);
      const cls = a.class || '';
      if (n.nodeName === 'DIV' && cls === 'card') out.card = { nodeId: n.nodeId, hidden: 'hidden' in a };
      if (n.nodeName === 'P' && cls.startsWith('answer')) out.answer = { text: textOf(n), hidden: 'hidden' in a };
      if (n.nodeName === 'UL' && cls === 'bullets' && !('hidden' in a)) {
        out.bulletItems = (n.children || []).filter((c) => c.nodeName === 'LI').map(textOf);
      }
      if (n.nodeName === 'DIV' && cls === 'notice') out.notice = 'hidden' in a ? '' : textOf(n);
      if (n.nodeName === 'BUTTON' && cls === 'fmt') {
        out.buttons.push({ nodeId: n.nodeId, label: textOf(n), pressed: a['aria-pressed'], locked: a['data-locked'], disabled: 'disabled' in a });
      }
      for (const c of n.children || []) walk(c);
      for (const s of n.shadowRoots || []) walk(s);
    })(root);
    // Réponse visible : la liste à puces si elle est affichée, sinon le paragraphe.
    if (out.bulletItems && out.bulletItems.length) out.answer = { text: '• ' + out.bulletItems.join('\n• '), hidden: false };
    return out;
  }
  async function centerOf(nodeId) {
    const { quads } = await send('DOM.getContentQuads', { nodeId }, tab);
    const q = quads[0];
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
  }
  async function computed(nodeId, props) {
    const { computedStyle } = await send('CSS.getComputedStyleForNode', { nodeId }, tab);
    return Object.fromEntries(props.map((p) => [p, (computedStyle.find((c) => c.name === p) || {}).value]));
  }
  async function screenshot(name, nodeId) {
    const { quads } = await send('DOM.getContentQuads', { nodeId }, tab);
    const q = quads[0];
    const pad = 24;
    const bait = await evaluate(tab, `(() => { const r = document.querySelector('#bait').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    const x = Math.max(0, Math.min(q[0], bait.x) - pad);
    const y = Math.max(0, Math.min(q[1], bait.y) - pad);
    const clip = { x, y, width: Math.max(q[4], bait.x + 560) - x + pad, height: q[5] - y + pad, scale: 1 };
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }, tab);
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  const hoverBait = async () => {
    await move({ x: 5, y: 790 });
    await sleep(600);
    await move(await center('#bait'));
    await sleep(1500);
  };

  // 3. Compte GRATUIT, page au CSS hostile.
  await navigate('https://x.com/hostile');
  await hoverBait();
  let t = await inspect();
  check('gratuit : infobulle affichée avec la réponse « phrase »', t.card && !t.card.hidden && t.answer.text === SENTENCE, t.answer.text);
  const [sentenceBtn, bulletsBtn] = t.buttons;
  check('gratuit : sélecteur présent, « Une phrase » actif', t.buttons.length === 2 && sentenceBtn.pressed === 'true', t.buttons.map((b) => b.label).join(' | '));
  check('gratuit : « Puces » verrouillé avec cadenas 🔒', bulletsBtn.locked === 'true' && bulletsBtn.label.startsWith('🔒'), bulletsBtn.label);

  const style = await computed(bulletsBtn.nodeId, ['display', 'font-family', 'color', 'letter-spacing', 'visibility']);
  check(
    'CSS hostile de la page sans effet sur les boutons (Shadow DOM)',
    style.display !== 'none' && style.visibility !== 'hidden' && !/comic/i.test(style['font-family']) && style.color !== 'rgb(0, 255, 0)' && style['letter-spacing'] !== '3px',
    JSON.stringify(style)
  );

  const targetsBefore = (await send('Target.getTargets')).targetInfos.length;
  await click(await centerOf(bulletsBtn.nodeId));
  await sleep(120);
  t = await inspect();
  check('gratuit : clic sur 🔒 → message d’incitation Premium', /réservé à la version Premium/.test(t.notice), t.notice);
  check('gratuit : l’infobulle reste ouverte, la réponse intacte', t.card && !t.card.hidden && t.answer.text === SENTENCE);
  check('clic dans l’infobulle invisible pour la page (pas de propagation)', (await evaluate(tab, 'window.__pageClicks')) === 0);
  let paymentTab = null;
  for (let i = 0; i < 30 && !paymentTab; i++) {
    const { targetInfos } = await send('Target.getTargets');
    paymentTab = targetInfos.find((x) => x.type === 'page' && /extensionpay\.com/.test(x.url));
    if (!paymentTab) await sleep(200);
  }
  check('gratuit : page de paiement ExtensionPay ouverte', Boolean(paymentTab), paymentTab ? paymentTab.url.replace(/api_key=[^&]+/, 'api_key=…') : `onglets ${targetsBefore}`);
  if (paymentTab) await send('Target.closeTarget', { targetId: paymentTab.targetId });
  await send('Target.activateTarget', { targetId });
  await sleep(300);
  t = await inspect();
  check('gratuit : de retour sur l’onglet, réponse et incitation toujours affichées', t.card && !t.card.hidden && t.answer.text === SENTENCE && /Premium/.test(t.notice));

  // 4. Captures « gratuit » (page propre).
  await navigate('https://x.com/home');
  await hoverBait();
  t = await inspect();
  const shotFree = await screenshot('v2-infobulle-gratuit.png', t.card.nodeId);
  await click(await centerOf(t.buttons[1].nodeId));
  // L'onglet de paiement passe au premier plan : on le ferme et on revient
  // (un onglet en arrière-plan n'est plus rendu, donc pas capturable).
  for (let i = 0; i < 20; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const pay = targetInfos.find((x) => x.type === 'page' && /extensionpay\.com/.test(x.url));
    if (pay) {
      await send('Target.closeTarget', { targetId: pay.targetId });
      break;
    }
    await sleep(200);
  }
  await send('Target.activateTarget', { targetId });
  await sleep(400);
  t = await inspect();
  const shotNotice = await screenshot('v2-infobulle-incitation-premium.png', t.card.nodeId);

  // 5. Compte PREMIUM : statut payé connu (ExtensionPay injoignable → repli sur le dernier statut chiffré).
  const premium = await evaluate(swSession, `(async () => {
    await chrome.storage.sync.set({ extensionpay_api_key: 'e2e-invalid-key' });
    await AntiBait.vault.secureStore.set('premiumLastKnown', { paid: true, checkedAt: Date.now() });
    return AntiBait.premium.isPremium({ force: true });
  })()`);
  check('premium simulé côté worker', premium === true);

  await navigate('https://x.com/hostile');
  await hoverBait();
  t = await inspect();
  check('premium : « Puces » déverrouillé (sans cadenas)', t.buttons[1] && t.buttons[1].locked === 'false' && !t.buttons[1].label.includes('🔒'), t.buttons.map((b) => b.label).join(' | '));
  await click(await centerOf(t.buttons[1].nodeId));
  await sleep(700);
  t = await inspect();
  check('premium : clic « Puces » → réponse en 3 puces', t.answer.text === BULLETS, JSON.stringify(t.answer.text));
  check('premium : infobulle jamais refermée pendant la bascule', t.card && !t.card.hidden);
  check('premium : « Puces » marqué actif', t.buttons[1].pressed === 'true' && t.buttons[0].pressed === 'false');
  await click(await centerOf(t.buttons[0].nodeId));
  await sleep(200);
  t = await inspect();
  check('premium : retour « Une phrase » instantané (cache de l’onglet)', t.answer.text === SENTENCE && !t.card.hidden);
  check('aucun clic propagé à la page sur l’ensemble du scénario', (await evaluate(tab, 'window.__pageClicks')) === 0);

  // 6. Captures « premium » (clair et sombre).
  await navigate('https://x.com/home');
  await hoverBait();
  t = await inspect();
  await click(await centerOf(t.buttons[1].nodeId));
  await sleep(600);
  t = await inspect();
  const shotPremium = await screenshot('v2-infobulle-premium-puces.png', t.card.nodeId);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, tab);
  await sleep(300);
  const shotDark = await screenshot('v2-infobulle-premium-sombre.png', t.card.nodeId);
  console.log('\nCaptures :\n  ' + [shotFree, shotNotice, shotPremium, shotDark].join('\n  '));
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
