/**
 * Anti-Bait Zéro Clic — Détecteur d'intention de survol (HoverIntent)
 * ====================================================================
 * Machine à états PURE (aucun accès DOM, aucun appel chrome.*) qui transforme
 * un flot brut d'événements « entre / sort d'un lien » en deux signaux :
 *   - onIntent(link)  : l'utilisateur s'est ARRÊTÉ sur ce lien (délai écoulé) ;
 *   - onAbandon(link) : l'utilisateur a quitté le lien ET l'infobulle.
 *
 * [QA] Pourquoi c'est critique : sur X/LinkedIn, faire défiler le fil fait
 * passer la souris sur des dizaines de liens par seconde. Sans ce filtre, chaque
 * survol déclencherait un fetch + un appel IA (coût, CPU, quota).
 * Garanties :
 *   - au plus UN minuteur « en attente » et UN minuteur « de grâce » à la fois ;
 *   - un survol plus court que `delayMs` ne déclenche JAMAIS onIntent ;
 *   - destroy() annule tout : aucune fuite de minuteur après nettoyage.
 *
 * Les fonctions de minuterie sont injectables pour les tests (horloge simulée).
 * États :  idle → pending(lien, minuteur) → active(lien) → grace(lien, minuteur) → idle
 */
(function (root) {
  'use strict';

  const NS = (root.AntiBaitContent = root.AntiBaitContent || {});
  if (NS.HoverIntent) return;

  class HoverIntent {
    /**
     * @param {object} opts
     * @param {number} opts.delayMs   Temps d'arrêt requis avant de déclencher (ms).
     * @param {number} opts.graceMs   Délai de grâce pour rejoindre l'infobulle (ms).
     * @param {(link: any) => void} opts.onIntent
     * @param {(link: any) => void} opts.onAbandon
     * @param {Function} [opts.setTimer]   Injectable (tests). Par défaut setTimeout.
     * @param {Function} [opts.clearTimer] Injectable (tests). Par défaut clearTimeout.
     */
    constructor({ delayMs, graceMs, onIntent, onAbandon, setTimer, clearTimer }) {
      this.delayMs = delayMs;
      this.graceMs = graceMs;
      this.onIntent = onIntent;
      this.onAbandon = onAbandon;
      this.setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
      this.clearTimer = clearTimer || ((id) => clearTimeout(id));

      this.pendingLink = null; // lien survolé, délai en cours
      this.pendingTimer = null;
      this.activeLink = null; // lien dont l'infobulle est affichée
      this.graceTimer = null;
      this.destroyed = false;
    }

    /** Met à jour le délai (réglage utilisateur modifié à chaud). */
    setDelay(ms) {
      this.delayMs = ms;
    }

    /** Le pointeur (ou le focus clavier) entre sur un lien éligible. */
    enterLink(link) {
      if (this.destroyed) return;
      if (link === this.activeLink) {
        // Retour sur le lien actif pendant la grâce : on garde l'infobulle.
        this._clearGrace();
        return;
      }
      if (link === this.pendingLink) return; // déjà en attente sur ce lien
      this._clearPending();
      this.pendingLink = link;
      this.pendingTimer = this.setTimer(() => this._fire(link), this.delayMs);
    }

    /** Le pointeur quitte un lien. */
    leaveLink(link) {
      if (this.destroyed) return;
      if (link === this.pendingLink) this._clearPending();
      if (link === this.activeLink) this._startGrace();
    }

    /** Le pointeur entre dans l'infobulle : on annule la fermeture programmée. */
    enterTooltip() {
      if (this.destroyed) return;
      this._clearGrace();
    }

    /** Le pointeur quitte l'infobulle. */
    leaveTooltip() {
      if (this.destroyed) return;
      if (this.activeLink) this._startGrace();
    }

    /** Fermeture immédiate (Échap, clic, onglet masqué, ancre disparue). */
    dismiss() {
      if (this.destroyed) return;
      this._clearPending();
      this._clearGrace();
      if (this.activeLink) {
        const link = this.activeLink;
        this.activeLink = null;
        this.onAbandon(link);
      }
    }

    /** Nombre de minuteurs vivants (exposé pour les tests de fuite). */
    get liveTimers() {
      return (this.pendingTimer !== null ? 1 : 0) + (this.graceTimer !== null ? 1 : 0);
    }

    /** Libère tout, sans déclencher de callback. Idempotent. */
    destroy() {
      this._clearPending();
      this._clearGrace();
      this.activeLink = null;
      this.destroyed = true;
    }

    // ── Interne ──────────────────────────────────────────────────────────

    _fire(link) {
      this.pendingTimer = null;
      this.pendingLink = null;
      if (this.destroyed) return;
      // Un nouveau lien remplace l'ancien : on abandonne proprement le précédent.
      if (this.activeLink && this.activeLink !== link) {
        const previous = this.activeLink;
        this._clearGrace();
        this.activeLink = null;
        this.onAbandon(previous);
      }
      this.activeLink = link;
      this.onIntent(link);
    }

    _startGrace() {
      this._clearGrace();
      this.graceTimer = this.setTimer(() => {
        this.graceTimer = null;
        const link = this.activeLink;
        this.activeLink = null;
        if (link && !this.destroyed) this.onAbandon(link);
      }, this.graceMs);
    }

    _clearPending() {
      if (this.pendingTimer !== null) this.clearTimer(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingLink = null;
    }

    _clearGrace() {
      if (this.graceTimer !== null) this.clearTimer(this.graceTimer);
      this.graceTimer = null;
    }
  }

  NS.HoverIntent = HoverIntent;
})(globalThis);
