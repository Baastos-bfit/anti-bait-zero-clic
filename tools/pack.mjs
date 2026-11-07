/**
 * Empaquette l'extension pour le Chrome Web Store : dist/anti-bait-<version>.zip
 * Seuls les fichiers nécessaires à l'exécution sont inclus (pas de tests,
 * outils, docs ni fichiers de développement).
 *
 * Usage : node tools/pack.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INCLUDE = ['manifest.json', 'LICENSE', 'icons', 'src', 'vendor'];
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const outDir = path.join(ROOT, 'dist');
const out = path.join(outDir, `anti-bait-${version}.zip`);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(out, { force: true });

if (process.platform === 'win32') {
  // tar.exe de Windows (bsdtar) sait produire un .zip avec -a.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', out, ...INCLUDE], { cwd: ROOT, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-X', out, ...INCLUDE], { cwd: ROOT, stdio: 'inherit' });
}

console.log(`Paquet créé : ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} Ko)`);
