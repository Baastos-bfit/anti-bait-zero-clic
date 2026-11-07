/**
 * Anti-Bait Zéro Clic — Registre des analyses en cours
 * =====================================================
 * [QA] Garantit qu'un utilisateur qui survole 50 liens d'affilée ne génère pas
 * 50 fetch + 50 appels IA en parallèle :
 *   - UNE seule analyse par onglet : une nouvelle demande annule la précédente ;
 *   - MAX_CONCURRENT_JOBS au total : au-delà, la plus ancienne est annulée.
 * Chaque analyse reçoit un AbortSignal propagé jusqu'au fetch et au flux IA :
 * annuler = libérer immédiatement le réseau et la mémoire.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  class JobRegistry {
    /** @param {number} maxConcurrent */
    constructor(maxConcurrent) {
      this.maxConcurrent = maxConcurrent;
      /** @type {Map<number, {tabId: number, controller: AbortController}>} ordre d'insertion = ancienneté */
      this.jobs = new Map();
      this.seq = 0;
    }

    /**
     * Démarre une analyse pour un onglet.
     * @param {number} tabId
     * @returns {{id: number, signal: AbortSignal}}
     */
    start(tabId) {
      for (const [id, job] of this.jobs) {
        if (job.tabId === tabId) this.abort(id, 'superseded');
      }
      while (this.jobs.size >= this.maxConcurrent) {
        const oldestId = this.jobs.keys().next().value;
        this.abort(oldestId, 'capacity');
      }
      const id = ++this.seq;
      const controller = new AbortController();
      this.jobs.set(id, { tabId, controller });
      return { id, signal: controller.signal };
    }

    /** Annule une analyse (idempotent). */
    abort(id, reason) {
      const job = this.jobs.get(id);
      if (!job) return;
      this.jobs.delete(id);
      job.controller.abort(new DOMException(`Analyse annulée (${reason})`, 'AbortError'));
    }

    /** Marque une analyse comme terminée (sans l'annuler). */
    finish(id) {
      this.jobs.delete(id);
    }

    get size() {
      return this.jobs.size;
    }
  }

  AB.JobRegistry = JobRegistry;
})(globalThis);
