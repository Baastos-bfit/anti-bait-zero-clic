/**
 * Audit statique du paquet : le manifest est valide, chaque fichier référencé
 * existe (sinon Chrome refuse de charger l'extension) et les règles SecOps
 * (permissions minimales, pas de code distant) sont respectées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadScripts } from './helpers/load.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('manifest MV3 : tous les fichiers référencés existent', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js || []),
  ];
  for (const f of files) assert.ok(exists(f), `fichier manquant : ${f}`);
});

test('service worker : chaque importScripts pointe vers un fichier existant', () => {
  const swPath = manifest.background.service_worker;
  const src = fs.readFileSync(path.join(ROOT, swPath), 'utf8');
  const block = /importScripts\(([\s\S]*?)\);/.exec(src)[1];
  const imports = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length >= 10);
  for (const rel of imports) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(swPath), rel));
    assert.ok(exists(resolved), `importScripts introuvable : ${resolved}`);
  }
});

test('page d’options : scripts et styles locaux existants', () => {
  const page = manifest.options_ui.page;
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    assert.ok(!/^https?:/.test(ref), `ressource distante interdite : ${ref}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page), ref));
    assert.ok(exists(resolved), `ressource introuvable : ${resolved}`);
  }
  assert.ok(!/<script>(?!<\/script>)/.test(html.replace(/<script[^>]*src=[^>]*><\/script>/g, '')), 'pas de script inline');
});

test('SecOps : permissions minimales, HTTPS uniquement, aucune ressource exposée', () => {
  const all = JSON.stringify(manifest);
  assert.ok(!all.includes('<all_urls>'));
  assert.ok(!all.includes('http://'));
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.deepEqual(manifest.permissions.sort(), ['scripting', 'storage']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.ok(!manifest.content_security_policy.extension_pages.includes('unsafe'));
  // ExtensionPay : content script requis à document_start (sinon onPaid lève une erreur).
  const ext = manifest.content_scripts.find((c) => c.matches.includes('https://extensionpay.com/*'));
  assert.equal(ext.run_at, 'document_start');
});

test('fichiers injectés dynamiquement (sites de médias) = mêmes fichiers que le manifest', () => {
  const ctx = loadScripts(['src/background/config.js']);
  const dynamic = [...ctx.AntiBait.CONFIG.CONTENT_SCRIPT_FILES];
  const staticFiles = manifest.content_scripts[0].js;
  assert.deepEqual(dynamic, staticFiles);
});

test('aucun code distant ni eval dans les sources de l’extension', () => {
  const walk = (dir) =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]
    );
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/\beval\(|new Function\(/.test(src), `eval interdit : ${file}`);
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), `HTML dynamique interdit : ${file}`);
    assert.ok(!/importScripts\(\s*['"]https?:/.test(src), `script distant interdit : ${file}`);
  }
});
