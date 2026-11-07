/**
 * Test de charge QA — « 50 survols rapides de liens »
 * ====================================================
 * Simule un utilisateur qui fait défiler un fil X en balayant 50 liens avec la
 * souris, puis s'arrête sur un seul. Exigences :
 *   - aucune analyse lancée pendant le balayage (0 appel réseau / IA) ;
 *   - exactement UNE analyse pour le lien où l'utilisateur s'arrête ;
 *   - aucun minuteur orphelin (pas de fuite mémoire / CPU) ;
 *   - côté service worker, jamais plus de MAX_CONCURRENT_JOBS analyses vivantes
 *     et une seule par onglet, même sous rafale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, fakeClock } from './helpers/load.mjs';

const ctx = loadScripts(['src/content/hover-intent.js', 'src/background/jobs.js']);
const { HoverIntent } = ctx.AntiBaitContent;
const { JobRegistry } = ctx.AntiBait;

function setup(delayMs = 600) {
  const clock = fakeClock();
  const intents = [];
  const abandons = [];
  const hi = new HoverIntent({
    delayMs,
    graceMs: 350,
    onIntent: (l) => intents.push(l),
    onAbandon: (l) => abandons.push(l),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, hi, intents, abandons };
}

const links = Array.from({ length: 50 }, (_, i) => ({ id: i }));

test('50 survols rapides (40 ms chacun) : aucune analyse déclenchée', () => {
  const { clock, hi, intents } = setup();
  for (const link of links) {
    hi.enterLink(link);
    clock.advance(40);
    hi.leaveLink(link);
  }
  clock.advance(5000);
  assert.equal(intents.length, 0);
  assert.equal(clock.pending, 0, 'aucun minuteur ne doit subsister');
  assert.equal(hi.liveTimers, 0);
});

test('balayage de lien en lien sans pointerout intermédiaire, puis arrêt : 1 seule analyse', () => {
  const { clock, hi, intents } = setup();
  for (const link of links) {
    hi.enterLink(link); // enchaînement direct (liens adjacents)
    clock.advance(30);
  }
  clock.advance(600);
  assert.equal(intents.length, 1);
  assert.equal(intents[0], links[49]);
  assert.equal(clock.pending, 0);
});

test('arrêt sur un lien puis départ : abandon après le délai de grâce, minuteurs libérés', () => {
  const { clock, hi, intents, abandons } = setup();
  hi.enterLink(links[0]);
  clock.advance(600);
  assert.equal(intents.length, 1);
  hi.leaveLink(links[0]);
  clock.advance(200);
  assert.equal(abandons.length, 0, 'toujours dans la période de grâce');
  clock.advance(200);
  assert.deepEqual(abandons.map((l) => l.id), [0]);
  assert.equal(clock.pending, 0);
});

test('glisser du lien vers l’infobulle conserve l’analyse', () => {
  const { clock, hi, abandons } = setup();
  hi.enterLink(links[1]);
  clock.advance(600);
  hi.leaveLink(links[1]);
  clock.advance(100);
  hi.enterTooltip();
  clock.advance(5000);
  assert.equal(abandons.length, 0);
  hi.leaveTooltip();
  clock.advance(400);
  assert.equal(abandons.length, 1);
});

test('un nouveau lien remplace proprement l’ancien (abandon puis intention)', () => {
  const { clock, hi, intents, abandons } = setup();
  hi.enterLink(links[0]);
  clock.advance(600);
  hi.leaveLink(links[0]);
  hi.enterLink(links[1]);
  clock.advance(600);
  assert.deepEqual(intents.map((l) => l.id), [0, 1]);
  assert.deepEqual(abandons.map((l) => l.id), [0]);
  assert.equal(clock.pending, 0);
});

test('destroy() annule tout sans callback ni minuteur restant', () => {
  const { clock, hi, intents, abandons } = setup();
  hi.enterLink(links[0]);
  hi.destroy();
  clock.advance(5000);
  hi.enterLink(links[1]);
  clock.advance(5000);
  assert.equal(intents.length + abandons.length, 0);
  assert.equal(clock.pending, 0);
});

test('service worker : 50 demandes en rafale du même onglet → 1 seule analyse vivante', () => {
  const reg = new JobRegistry(3);
  const signals = [];
  for (let i = 0; i < 50; i++) signals.push(reg.start(7).signal);
  assert.equal(reg.size, 1);
  assert.equal(signals.filter((s) => !s.aborted).length, 1);
  assert.equal(signals[49].aborted, false);
});

test('service worker : 50 demandes réparties sur 10 onglets → plafond de 3 respecté', () => {
  const reg = new JobRegistry(3);
  const signals = [];
  for (let i = 0; i < 50; i++) signals.push(reg.start(i % 10).signal);
  assert.equal(reg.size, 3);
  assert.equal(signals.filter((s) => !s.aborted).length, 3);
  // Les 3 survivants sont les plus récents.
  assert.deepEqual(signals.slice(47).map((s) => s.aborted), [false, false, false]);
});
