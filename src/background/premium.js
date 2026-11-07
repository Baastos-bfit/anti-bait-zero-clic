/**
 * Anti-Bait Zéro Clic — Premium (ExtensionPay) et quota gratuit
 * ==============================================================
 * Modèle économique :
 *   - Gratuit  : FREE_DAILY_QUOTA analyses IA par jour (les réponses en cache
 *                ne consomment rien) ;
 *   - Premium  : illimité. Paiement géré par ExtensionPay (Stripe) : aucune
 *                donnée bancaire ne transite par l'extension.
 *
 * [SecOps] Étanchéité des paiements :
 *   - le statut Premium n'est décidé QUE dans le service worker, à partir de
 *     ExtPay.getUser() (serveur ExtensionPay). Le content script ne peut ni
 *     l'affirmer ni le modifier : il reçoit seulement le résultat ;
 *   - le dernier statut connu (repli hors ligne) et le compteur de quota sont
 *     CHIFFRÉS (vault.secureStore, AAD dédiée) : un content script compromis
 *     qui écrirait dans chrome.storage.local ne peut ni s'octroyer le Premium,
 *     ni remettre son quota à zéro — une valeur falsifiée est illisible donc
 *     ignorée ;
 *   - le message « extpay-fetch-user » (page de paiement → content script →
 *     worker) ne fait que déclencher une RE-VÉRIFICATION serveur : il ne peut
 *     pas, à lui seul, accorder le Premium.
 * [QA]
 *   - le statut est mis en cache 10 min (pas un appel réseau par survol) ;
 *   - la vérification a un délai maximal de 4 s, puis repli sur le dernier
 *     statut connu (un utilisateur payant n'est pas bloqué par une panne
 *     d'ExtensionPay) ;
 *   - le quota est réservé AVANT l'appel IA et remboursé en cas d'échec ou
 *     d'annulation, dans une file sérialisée (pas de course entre onglets).
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  // ExtPay est fourni par vendor/ExtPay.js (importScripts dans le service worker).
  // startBackground() DOIT être appelé au chargement du worker (exigence ExtensionPay).
  const extpay = root.ExtPay(CONFIG.EXTPAY_ID);
  extpay.startBackground();

  /** Statut en mémoire (vie du worker) — évite même la lecture du stockage. */
  let memo = null; // { paid: boolean, checkedAt: number }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Délai ExtensionPay dépassé')), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  async function remember(paid) {
    memo = { paid, checkedAt: Date.now() };
    await AB.vault.secureStore.set('premiumLastKnown', memo);
  }

  /**
   * L'utilisateur est-il Premium ?
   * @param {{force?: boolean}} [opts] force : ignore le cache (bouton « Actualiser »).
   */
  async function isPremium({ force = false } = {}) {
    if (!force && memo && Date.now() - memo.checkedAt < CONFIG.PREMIUM_CHECK_TTL_MS) return memo.paid;
    try {
      const user = await withTimeout(extpay.getUser(), CONFIG.PREMIUM_CHECK_TIMEOUT_MS);
      const paid = Boolean(user && user.paid);
      await remember(paid);
      return paid;
    } catch (err) {
      // ExtensionPay injoignable ou extension pas encore enregistrée : repli.
      console.warn('[Anti-Bait] Vérification Premium impossible :', String(err));
      const last = await AB.vault.secureStore.get('premiumLastKnown');
      const paid = Boolean(last && last.paid === true);
      memo = { paid, checkedAt: Date.now() }; // évite de réessayer à chaque survol
      return paid;
    }
  }

  // Paiement confirmé (la page ExtensionPay prévient le worker) : statut à jour immédiatement.
  extpay.onPaid.addListener(() => {
    remember(true).catch(() => {});
  });

  // ── Quota quotidien ─────────────────────────────────────────────────────

  let quotaQueue = Promise.resolve();
  function serialized(fn) {
    const run = quotaQueue.then(fn, fn);
    quotaQueue = run.catch(() => {});
    return run;
  }

  /** Date locale AAAA-MM-JJ : le quota se renouvelle à minuit, heure de l'utilisateur. */
  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function readQuota() {
    const { status, value: q } = await AB.vault.secureStore.read('quota');
    const day = today();
    if (status === 'invalid') {
      // [SecOps] Compteur falsifié (ou clé maître perdue) : on refuse par défaut —
      // quota épuisé pour aujourd'hui — et on réécrit une valeur valide pour que
      // le compteur reparte normalement demain.
      const locked = { day, used: CONFIG.FREE_DAILY_QUOTA };
      await AB.vault.secureStore.set('quota', locked);
      return locked;
    }
    if (!q || q.day !== day || !Number.isInteger(q.used) || q.used < 0) return { day, used: 0 };
    return q;
  }

  /**
   * Réserve une analyse. Premium : toujours accordé.
   * @returns {Promise<{ok: boolean, premium: boolean, remaining: number, reservation: object|null}>}
   */
  function reserve() {
    return serialized(async () => {
      const premium = await isPremium();
      if (premium) return { ok: true, premium: true, remaining: null, reservation: null };
      const q = await readQuota();
      if (q.used >= CONFIG.FREE_DAILY_QUOTA) return { ok: false, premium: false, remaining: 0, reservation: null };
      q.used += 1;
      await AB.vault.secureStore.set('quota', q);
      return { ok: true, premium: false, remaining: CONFIG.FREE_DAILY_QUOTA - q.used, reservation: { day: q.day } };
    });
  }

  /** Rend une analyse réservée (échec ou annulation). */
  function refund(reservation) {
    if (!reservation) return Promise.resolve();
    return serialized(async () => {
      const q = await readQuota();
      if (q.day !== reservation.day || q.used <= 0) return; // nouveau jour : rien à rendre
      q.used -= 1;
      await AB.vault.secureStore.set('quota', q);
    });
  }

  /** État pour la page d'options et l'infobulle. */
  async function getStatus({ force = false } = {}) {
    const premium = await isPremium({ force });
    const q = await serialized(readQuota);
    return {
      premium,
      used: q.used,
      limit: CONFIG.FREE_DAILY_QUOTA,
      remaining: premium ? null : Math.max(0, CONFIG.FREE_DAILY_QUOTA - q.used),
    };
  }

  AB.premium = Object.freeze({
    isPremium,
    reserve,
    refund,
    getStatus,
    openPaymentPage: () => extpay.openPaymentPage(),
    openLoginPage: () => extpay.openLoginPage(),
  });
})(globalThis);
