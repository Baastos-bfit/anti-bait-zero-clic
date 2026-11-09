/**
 * Anti-Bait Zéro Clic — Statistiques : clics évités et temps gagné (v2)
 * ======================================================================
 * Chaque réponse affichée est un clic que l'utilisateur n'a pas eu à faire.
 * Le temps gagné est CALCULÉ à l'affichage (clics × MINUTES_SAVED_PER_CLICK),
 * jamais stocké : changer l'estimation ne fausse pas l'historique.
 *
 * Stockage (chrome.storage.local) :
 *   stats     : { v: 1, clicksAvoided, since, updatedAt }
 *   statsSeen : { day: 'AAAA-MM-JJ', ids: ['<16 hex>', ...] }  registre du jour
 *
 * [QA] Un seul clic évité par URL et par jour : survoler le même lien en
 * boucle ne gonfle pas le compteur. On compte sur l'URL FINALE de l'article
 * (après t.co / lnkd.in) : un même article partagé par 20 comptes compte une
 * fois. Les écritures sont sérialisées (pas de double comptage entre onglets).
 * [SecOps] Vie privée : le registre ne contient AUCUNE URL, seulement une
 * empreinte SHA-256 tronquée, effacée au changement de jour et plafonnée.
 * Donnée non sensible et purement locale : jamais transmise hors de l'appareil.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  const STATS_KEY = 'stats';
  const SEEN_KEY = 'statsSeen';
  const MAX_SEEN_PER_DAY = 5000; // [QA] borne le stockage, même pour un usage intensif

  let queue = Promise.resolve();
  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  /** Date locale AAAA-MM-JJ : le registre se renouvelle à minuit, heure de l'utilisateur. */
  function dayOf(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** Empreinte courte (64 bits) d'une URL : suffisant pour dédupliquer, sans stocker l'URL. */
  async function fingerprint(url) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Valeur stockée assainie (une donnée corrompue ou modifiée ne casse rien). */
  function sanitize(raw, now) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const clicks = Number.isSafeInteger(s.clicksAvoided) && s.clicksAvoided > 0 ? s.clicksAvoided : 0;
    const since = typeof s.since === 'string' && !Number.isNaN(Date.parse(s.since)) ? s.since : now.toISOString();
    const updatedAt = typeof s.updatedAt === 'string' && !Number.isNaN(Date.parse(s.updatedAt)) ? s.updatedAt : null;
    return { v: 1, clicksAvoided: clicks, since, updatedAt };
  }

  /** Lecture brute (assainie). */
  async function read(now = new Date()) {
    const data = await chrome.storage.local.get(STATS_KEY);
    return sanitize(data[STATS_KEY], now);
  }

  /**
   * Enregistre un clic évité pour cette URL, au plus une fois par jour.
   * @param {string} url  URL finale de l'article (de préférence).
   * @param {Date} [now]  Injectable pour les tests.
   * @returns {Promise<boolean>} vrai si le compteur a été incrémenté.
   */
  function recordAvoidedClick(url, now = new Date()) {
    return serialized(async () => {
      if (typeof url !== 'string' || !url) return false;
      const id = await fingerprint(url);
      const day = dayOf(now);
      const data = await chrome.storage.local.get([STATS_KEY, SEEN_KEY]);

      const seenRaw = data[SEEN_KEY];
      let ids = seenRaw && seenRaw.day === day && Array.isArray(seenRaw.ids) ? seenRaw.ids : [];
      if (ids.includes(id)) return false; // déjà compté aujourd'hui

      ids = ids.concat(id);
      if (ids.length > MAX_SEEN_PER_DAY) ids = ids.slice(ids.length - MAX_SEEN_PER_DAY);

      const stats = sanitize(data[STATS_KEY], now);
      stats.clicksAvoided = Math.min(Number.MAX_SAFE_INTEGER, stats.clicksAvoided + 1);
      stats.updatedAt = now.toISOString();

      await chrome.storage.local.set({ [STATS_KEY]: stats, [SEEN_KEY]: { day, ids } });
      return true;
    });
  }

  /** Remise à zéro complète (compteur ET registre du jour). */
  function reset(now = new Date()) {
    return serialized(async () => {
      const fresh = { v: 1, clicksAvoided: 0, since: now.toISOString(), updatedAt: null };
      await chrome.storage.local.set({ [STATS_KEY]: fresh });
      await chrome.storage.local.remove(SEEN_KEY);
      return fresh;
    });
  }

  /** « 1 h 30 min », « 14 min », « 0 min ». */
  function formatDuration(totalMinutes) {
    const m = Math.max(0, Math.round(totalMinutes));
    const days = Math.floor(m / 1440);
    const hours = Math.floor((m % 1440) / 60);
    const minutes = m % 60;
    if (days > 0) return `${days} j ${hours} h`;
    if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
    return `${minutes} min`;
  }

  /**
   * Modèle d'affichage pour la page d'options (tâche 4.6).
   * @param {{clicksAvoided: number, since: string, updatedAt: string|null}} stats
   */
  function summarize(stats) {
    const minutesSaved = stats.clicksAvoided * CONFIG.MINUTES_SAVED_PER_CLICK;
    let sinceLabel = '';
    try {
      sinceLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(stats.since)
      );
    } catch {
      sinceLabel = stats.since.slice(0, 10);
    }
    return {
      locked: false,
      clicksAvoided: stats.clicksAvoided,
      minutesSaved,
      timeSavedLabel: formatDuration(minutesSaved),
      minutesPerClick: CONFIG.MINUTES_SAVED_PER_CLICK,
      since: stats.since,
      sinceLabel,
      updatedAt: stats.updatedAt,
    };
  }

  /**
   * Statistiques à afficher. [SecOps] Réservées au Premium : un compte gratuit
   * ne reçoit aucun chiffre, seulement { locked: true } (le comptage continue
   * en local pour que ses statistiques soient prêtes s'il passe Premium).
   * @param {boolean} premium Statut vérifié par le worker (ExtensionPay).
   */
  async function getForDisplay(premium) {
    if (!premium) return { locked: true, minutesPerClick: CONFIG.MINUTES_SAVED_PER_CLICK };
    return summarize(await read());
  }

  AB.stats = Object.freeze({
    recordAvoidedClick,
    reset,
    read,
    summarize,
    formatDuration,
    getForDisplay,
  });
})(globalThis);
