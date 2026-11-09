/**
 * Tests v2 (tâche 4.5) : compteur de clics évités et de temps gagné.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, fakeStorageArea } from './helpers/load.mjs';

function load() {
  const local = fakeStorageArea();
  const ctx = loadScripts(
    ['src/shared/domain-utils.js', 'src/background/config.js', 'src/background/errors.js', 'src/background/stats.js'],
    { chrome: { storage: { local } } }
  );
  return { stats: ctx.AntiBait.stats, local };
}

const DAY1 = new Date(2026, 10, 9, 10, 0); // 9 nov. 2026, 10 h (heure locale)
const DAY1_LATE = new Date(2026, 10, 9, 23, 59);
const DAY2 = new Date(2026, 10, 10, 0, 1); // juste après minuit
const plain = (o) => JSON.parse(JSON.stringify(o));

test('un seul clic évité par URL et par jour, même en survol en boucle', async () => {
  const { stats } = load();
  const url = 'https://www.lemonde.fr/article-1.html';
  assert.equal(await stats.recordAvoidedClick(url, DAY1), true);
  for (let i = 0; i < 50; i++) assert.equal(await stats.recordAvoidedClick(url, DAY1_LATE), false);
  assert.equal((await stats.read(DAY1)).clicksAvoided, 1);
});

test('URL différentes : chacune compte', async () => {
  const { stats } = load();
  for (let i = 0; i < 7; i++) await stats.recordAvoidedClick(`https://site.fr/a-${i}`, DAY1);
  assert.equal((await stats.read(DAY1)).clicksAvoided, 7);
});

test('le même lien recompte le lendemain (minuit, heure locale)', async () => {
  const { stats, local } = load();
  const url = 'https://site.fr/a';
  await stats.recordAvoidedClick(url, DAY1);
  assert.equal(await stats.recordAvoidedClick(url, DAY2), true);
  assert.equal((await stats.read(DAY2)).clicksAvoided, 2);
  // Le registre de la veille est remplacé, pas cumulé.
  assert.equal(local.data.get('statsSeen').day, '2026-11-10');
  assert.equal(local.data.get('statsSeen').ids.length, 1);
});

test('concurrence entre onglets : 30 enregistrements simultanés du même lien → 1', async () => {
  const { stats } = load();
  const results = await Promise.all(
    Array.from({ length: 30 }, () => stats.recordAvoidedClick('https://site.fr/viral', DAY1))
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await stats.read(DAY1)).clicksAvoided, 1);
});

test('vie privée : aucune URL stockée, seulement des empreintes courtes', async () => {
  const { stats, local } = load();
  await stats.recordAvoidedClick('https://www.secret-site.fr/mon-article-prive', DAY1);
  const dump = JSON.stringify([...local.data.values()]);
  assert.ok(!dump.includes('secret-site'), 'l’URL ne doit jamais apparaître');
  assert.match(local.data.get('statsSeen').ids[0], /^[0-9a-f]{16}$/);
});

test('registre du jour plafonné (stockage borné)', async () => {
  const { stats, local } = load();
  local.data.set('statsSeen', { day: '2026-11-09', ids: Array.from({ length: 5000 }, (_, i) => i.toString(16).padStart(16, '0')) });
  await stats.recordAvoidedClick('https://site.fr/nouveau', DAY1);
  assert.equal(local.data.get('statsSeen').ids.length, 5000);
});

test('remise à zéro propre : compteur, date de départ et registre', async () => {
  const { stats, local } = load();
  await stats.recordAvoidedClick('https://site.fr/a', DAY1);
  await stats.recordAvoidedClick('https://site.fr/b', DAY1);
  const fresh = await stats.reset(DAY1_LATE);
  assert.equal(fresh.clicksAvoided, 0);
  assert.equal(fresh.since, DAY1_LATE.toISOString());
  assert.equal(local.data.has('statsSeen'), false);
  // Après remise à zéro, un lien déjà vu aujourd'hui peut de nouveau compter.
  assert.equal(await stats.recordAvoidedClick('https://site.fr/a', DAY1_LATE), true);
});

test('données corrompues ou modifiées : assainies sans erreur', async () => {
  const { stats, local } = load();
  local.data.set('stats', { clicksAvoided: -5, since: 'pas une date' });
  const s = await stats.read(DAY1);
  assert.equal(s.clicksAvoided, 0);
  assert.equal(s.since, DAY1.toISOString());
  local.data.set('stats', 'n’importe quoi');
  assert.equal((await stats.read(DAY1)).clicksAvoided, 0);
  local.data.set('stats', { clicksAvoided: 1.5 });
  assert.equal((await stats.read(DAY1)).clicksAvoided, 0);
});

test('temps gagné : 2 min par clic, libellés lisibles', async () => {
  const { stats } = load();
  assert.equal(stats.formatDuration(0), '0 min');
  assert.equal(stats.formatDuration(14), '14 min');
  assert.equal(stats.formatDuration(90), '1 h 30 min');
  assert.equal(stats.formatDuration(125), '2 h 05 min');
  assert.equal(stats.formatDuration(3000), '2 j 2 h');
  const s = stats.summarize({ clicksAvoided: 45, since: DAY1.toISOString(), updatedAt: null });
  assert.equal(s.minutesSaved, 90);
  assert.equal(s.timeSavedLabel, '1 h 30 min');
  assert.equal(s.sinceLabel, '9 novembre 2026');
  assert.equal(s.locked, false);
});

test('affichage réservé au Premium : un compte gratuit ne reçoit aucun chiffre', async () => {
  const { stats } = load();
  for (let i = 0; i < 3; i++) await stats.recordAvoidedClick(`https://site.fr/${i}`, DAY1);
  const free = plain(await stats.getForDisplay(false));
  assert.deepEqual(free, { locked: true, minutesPerClick: 2 });
  const premium = await stats.getForDisplay(true);
  assert.equal(premium.locked, false);
  assert.equal(premium.clicksAvoided, 3, 'le comptage a continué pendant la période gratuite');
  assert.equal(premium.timeSavedLabel, '6 min');
});
