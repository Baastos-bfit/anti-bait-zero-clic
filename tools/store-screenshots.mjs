/**
 * Génère les captures d'écran du Chrome Web Store (1280 × 800, 24 bits, sans
 * canal alpha) à partir de la VRAIE interface de l'extension, chargée dans un
 * Chromium headless (Edge). Une légende marketing est ajoutée à gauche.
 *
 * Usage :
 *   node tools/store-screenshots.mjs "<navigateur>" "<dossier de travail temporaire>"
 * Sortie : marketing/screenshots/*.png (ou .jpg si le navigateur produit un PNG avec alpha).
 * (Chrome stable ignore --load-extension depuis la v137 : utiliser Edge ou Chromium.)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'marketing', 'screenshots');
const [browserPath, workDir] = process.argv.slice(2);
const PORT = 9336;
const W = 1280;
const H = 800;
const profile = path.join(workDir, 'profile-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const proc = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${ROOT}`,
  `--load-extension=${ROOT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/** Type de couleur PNG (octet 25 de l'en-tête IHDR) : 2 = RVB 24 bits, 6 = RVBA. */
const pngColorType = (buf) => buf[25];

/** Capture pleine fenêtre 1280 × 800 ; JPEG si le PNG contient un canal alpha. */
async function capture(session, baseName) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, session);
  let buf = Buffer.from(data, 'base64');
  let file = path.join(OUT, baseName + '.png');
  if (pngColorType(buf) !== 2) {
    const jpg = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, session);
    buf = Buffer.from(jpg.data, 'base64');
    file = path.join(OUT, baseName + '.jpg');
  }
  fs.writeFileSync(file, buf);
  return file;
}

// ── Légende marketing (commune aux trois captures) ────────────────────────
const ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons', 'icon-128.png')).toString('base64');
const CAPTION_CSS = `
  .ab-caption { position: fixed; left: 0; top: 0; bottom: 0; width: 470px; box-sizing: border-box;
    padding: 64px 48px; display: flex; flex-direction: column; justify-content: center; gap: 18px;
    background: linear-gradient(160deg, #fff4f1 0%, #ffe3da 100%); color: #0f1419;
    font: 400 18px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; z-index: 10; }
  .ab-caption .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 20px; color: #e8452c; }
  .ab-caption .brand img { width: 44px; height: 44px; border-radius: 10px; }
  .ab-caption h1 { margin: 0; font-size: 40px; line-height: 1.12; letter-spacing: -0.5px; }
  .ab-caption p { margin: 0; color: #3d4852; }
  .ab-caption .pill { align-self: flex-start; padding: 6px 14px; border-radius: 999px; background: #e8452c; color: #fff; font-weight: 700; font-size: 14px; }
`;
const caption = (title, text, pill) => `
  <div class="ab-caption">
    <div class="brand"><img src="${ICON}" alt="">Anti-Bait Zéro Clic</div>
    ${pill ? `<span class="pill">${pill}</span>` : ''}
    <h1>${title}</h1>
    <p>${text}</p>
  </div>`;

// ── Fil d'actualité fictif (aucune marque réelle) ─────────────────────────
const BAIT = 'https://t.co/ab12cd34';
const BULLETS =
  '• La charcuterie industrielle (jambon, saucisson, lardons)\n• En cause : les nitrites ajoutés, liés au cancer colorectal\n• Source : étude de l’Inserm sur 100 000 adultes';
const SENTENCE = 'La charcuterie industrielle, à cause des nitrites ajoutés, selon une nouvelle étude de l’Inserm.';
const FEED = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: #f7f9f9; }
  body { font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f1419; }
  .feed { position: absolute; left: 540px; top: 0; width: 620px; min-height: 100%; background: #fff;
    border-left: 1px solid #eff3f4; border-right: 1px solid #eff3f4; }
  .bar { padding: 16px 20px; font-weight: 800; font-size: 20px; border-bottom: 1px solid #eff3f4; }
  .post { display: flex; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #eff3f4; }
  .avatar { flex: 0 0 44px; height: 44px; border-radius: 50%; }
  .who { font-weight: 700; } .who span { color: #536471; font-weight: 400; }
  .post p { margin: 4px 0 0; }
  .card { display: block; margin-top: 10px; border: 1px solid #cfd9de; border-radius: 16px; overflow: hidden; color: inherit; text-decoration: none; }
  .card .img { height: 150px; background: linear-gradient(135deg, #f7c59f, #e8452c); }
  .card .meta { padding: 10px 14px; } .card .site { color: #536471; font-size: 13px; }
  .card .title { font-size: 15px; }
  .actions { display: flex; gap: 48px; margin-top: 10px; color: #536471; font-size: 13px; }
  ${CAPTION_CSS}
</style></head><body>
  ${caption('La réponse, sans cliquer.', 'Survolez un titre racoleur : Anti-Bait lit l’article à votre place et vous donne l’essentiel en 3 points.', 'Nouveau : format puces')}
  <div class="feed">
    <div class="bar">Accueil</div>
    <div class="post"><div class="avatar" style="background:#9ec5fe"></div><div>
      <div class="who">Camille Martin <span>@camille_m · 1 h</span></div>
      <p>Belle journée pour une balade en forêt 🌲</p></div></div>
    <div class="post"><div class="avatar" style="background:#f7c59f"></div><div style="flex:1">
      <div class="who">Le Journal du Web <span>@journalduweb · 2 h</span></div>
      <p>Les médecins sont formels 😱</p>
      <a id="bait" class="card" href="${BAIT}" aria-label="Cet aliment que les médecins déconseillent fortement : vous en mangez tous les jours">
        <div class="img"></div>
        <div class="meta"><div class="site">lejournaldu.web</div>
        <div class="title">Cet aliment que les médecins déconseillent fortement : vous en mangez tous les jours</div></div>
      </a>
      <div class="actions"><span>💬 214</span><span>🔁 1,2 k</span><span>❤️ 4,8 k</span></div>
    </div></div>
    <div class="post"><div class="avatar" style="background:#b7e4c7"></div><div>
      <div class="who">Tech Hebdo <span>@techhebdo · 3 h</span></div>
      <p>Notre sélection des meilleurs outils de la semaine.</p></div></div>
  </div>
</body></html>`;

let ok = true;
const files = [];
try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
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

  // Service worker : Premium simulé, cache et statistiques de démonstration.
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
  await evaluate(swS, `(async () => {
    await chrome.storage.sync.set({ extensionpay_api_key: 'demo-invalid-key' });
    await AntiBait.vault.secureStore.set('premiumLastKnown', { paid: true, checkedAt: Date.now() });
    await AntiBait.premium.isPremium({ force: true });
    await AntiBait.settings.saveSettings({ language: 'fr', format: 'bullets' });
    const language = AntiBait.ai.resolveLanguage('fr').id;
    const entry = (text) => ({ text, title: 'Article', finalUrl: '${BAIT}' });
    await AntiBait.cache.set('${BAIT}', { language, format: 'bullets' }, entry(${JSON.stringify(BULLETS)}));
    await AntiBait.cache.set('${BAIT}', { language, format: 'sentence' }, entry(${JSON.stringify(SENTENCE)}));
    await AntiBait.stats.reset();
    for (let i = 0; i < 67; i++) await AntiBait.stats.recordAvoidedClick('https://exemple.fr/article-' + i);
  })()`);
  const extId = new URL(sw.url).host;

  // Onglet 1280 × 800, thème clair.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const tab = await attach(targetId);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, tab);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, tab);
  await send('Page.enable', {}, tab);

  // ── Capture 1 : infobulle Premium en puces ─────────────────────────────
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://x.com/*' }] }, tab);
  listeners.push((msg) => {
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId === tab) {
      send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(FEED).toString('base64'),
      }, tab).catch(() => {});
    }
  });
  await send('Page.navigate', { url: 'https://x.com/home' }, tab);
  await sleep(1800);
  const c = await evaluate(tab, `(() => { const r = document.querySelector('#bait .img').getBoundingClientRect(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.85 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, tab);
  await sleep(300);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y }, tab);
  await sleep(1600);
  files.push(await capture(tab, '01-infobulle-puces-premium'));

  // ── Captures 2 et 3 : page d'options ───────────────────────────────────
  const OPTIONS_CSS = `
    ${CAPTION_CSS}
    body { padding: 40px 48px 40px 520px !important; min-height: 100vh; box-sizing: border-box;
      display: flex !important; flex-direction: column; justify-content: center; }
    .top, main { margin: 0 !important; max-width: 712px !important; }
    #api, #access, #media, #behavior, #premium, .tagline { display: none !important; }
    .panel { margin-bottom: 14px !important; }
    * { transition: none !important; }
  `;
  const styleOptions = (extraCss, captionHtml) => evaluate(tab, `(() => {
    const s = document.createElement('style');
    s.textContent = ${JSON.stringify(OPTIONS_CSS)} + ${JSON.stringify(extraCss)};
    document.head.appendChild(s);
    document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(captionHtml)});
    window.scrollTo(0, 0);
  })()`);

  await send('Page.navigate', { url: `chrome-extension://${extId}/src/options/options.html` }, tab);
  await sleep(1500);
  await styleOptions(
    `main { display: flex; flex-direction: column; }
     #stats { order: -1; }
     #answers .choice-group:first-of-type, #answers .hint, #answers .feedback-row, #answers h2 { display: none !important; }
     #answers { padding-top: 16px !important; }`,
    caption('Voyez le temps que vous gagnez.', 'Chaque titre désamorcé est un clic évité. Vos statistiques restent sur votre appareil, sans aucune adresse de site.', 'Nouveau : statistiques')
  );
  await sleep(400);
  files.push(await capture(tab, '02-statistiques-temps-gagne'));

  await send('Page.navigate', { url: `chrome-extension://${extId}/src/options/options.html` }, tab);
  await sleep(1500);
  await styleOptions(
    `#stats, #answers .choice-group:nth-of-type(2), #answers .hint, #answers .feedback-row { display: none !important; }`,
    caption('Des réponses dans votre langue.', 'Articles en anglais, en espagnol ou en allemand : recevez la réponse traduite en français, ou gardez la langue d’origine.', 'Nouveau : langue de réponse')
  );
  await sleep(400);
  files.push(await capture(tab, '03-langue-des-reponses'));

  // Vérification du format de chaque fichier.
  for (const f of files) {
    const buf = fs.readFileSync(f);
    let w;
    let h;
    let alpha;
    if (f.endsWith('.png')) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
      alpha = pngColorType(buf) !== 2;
    } else {
      // JPEG : lecture du segment SOF0/SOF2 ; le JPEG n'a jamais de canal alpha.
      let i = 2;
      while (i < buf.length && !(buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2))) i += 2 + buf.readUInt16BE(i + 2);
      h = buf.readUInt16BE(i + 5);
      w = buf.readUInt16BE(i + 7);
      alpha = false;
    }
    const good = w === W && h === H && !alpha;
    ok = ok && good;
    console.log(`${good ? 'OK ' : 'KO '} ${path.relative(ROOT, f)} — ${w}×${h}, ${alpha ? 'AVEC alpha' : '24 bits sans alpha'}, ${(buf.length / 1024).toFixed(0)} Ko`);
  }
} catch (err) {
  ok = false;
  console.error('Erreur :', err.stack || err.message);
} finally {
  try {
    ws?.close();
  } catch {}
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
  process.exit(ok ? 0 : 1);
}
