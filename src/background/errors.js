/**
 * Anti-Bait Zéro Clic — Erreurs applicatives
 * ===========================================
 * Chaque échec possible du pipeline a un CODE stable, un message utilisateur
 * en français et, si pertinent, une ACTION que l'infobulle propose en bouton.
 *
 * [SecOps] Les messages bruts des fournisseurs IA sont nettoyés (sanitize)
 * avant affichage : on retire tout ce qui ressemble à une clé API et on tronque.
 * Une erreur interne ne remonte JAMAIS sa pile d'appels vers la page web.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  /** Catalogue : code → { message, action? } */
  const CATALOG = Object.freeze({
    INVALID_URL: { message: 'Ce lien ne peut pas être analysé.' },
    BLOCKED_HOST: { message: 'Lien vers une adresse locale ou privée : analyse refusée par sécurité.' },
    INSECURE_URL: { message: 'Ce site n’est pas sécurisé (HTTP) : analyse refusée par sécurité.' },
    PERMISSION_REQUIRED: {
      message: 'Autorisez Anti-Bait à lire les articles pour obtenir la réponse.',
      action: 'grant-access',
    },
    DISABLED: { message: 'Anti-Bait est désactivé dans les réglages.', action: 'open-options' },
    NO_API_KEY: { message: 'Ajoutez votre clé API pour activer Anti-Bait.', action: 'open-options' },
    KEY_UNREADABLE: {
      message: 'Votre clé API ne peut plus être déchiffrée. Saisissez-la à nouveau.',
      action: 'open-options',
    },
    INVALID_API_KEY: {
      message: 'Clé API refusée par le fournisseur. Vérifiez-la dans les réglages.',
      action: 'open-options',
    },
    QUOTA_EXCEEDED: {
      message: 'Limite gratuite du jour atteinte. Passez Premium pour des analyses illimitées.',
      action: 'upgrade',
    },
    FETCH_TIMEOUT: { message: 'Le site met trop de temps à répondre.' },
    FETCH_BLOCKED: { message: 'Ce site bloque la lecture automatique (paywall ou anti-robot).' },
    FETCH_NOT_FOUND: { message: 'Page introuvable : le lien semble mort.' },
    FETCH_RATE_LIMITED: { message: 'Le site limite les accès. Réessayez dans un instant.' },
    FETCH_FAILED: { message: 'Impossible de charger la page.' },
    NOT_HTML: { message: 'Ce lien ne mène pas à un article (fichier, image ou vidéo).' },
    EMPTY_CONTENT: { message: 'Aucun texte lisible sur cette page (paywall ou contenu dynamique).' },
    TOO_MANY_REDIRECTS: { message: 'Trop de redirections : analyse abandonnée.' },
    AI_RATE_LIMITED: { message: 'Le fournisseur IA limite vos requêtes. Réessayez dans un instant.' },
    AI_UNAVAILABLE: { message: 'Le service IA est temporairement indisponible.' },
    AI_TIMEOUT: { message: 'L’IA a mis trop de temps à répondre.' },
    AI_REFUSED: { message: 'L’IA a refusé de traiter ce contenu.' },
    AI_ERROR: { message: 'Erreur du fournisseur IA.' },
    EMPTY_ANSWER: { message: 'L’IA n’a renvoyé aucune réponse.' },
    ABORTED: { message: 'Analyse annulée.' },
    FORBIDDEN: { message: 'Action non autorisée depuis ce contexte.' },
    BAD_REQUEST: { message: 'Requête invalide.' },
    INTERNAL: { message: 'Erreur interne inattendue.' },
  });

  class AppError extends Error {
    /**
     * @param {keyof CATALOG} code
     * @param {string} [message] Message spécifique (sinon celui du catalogue).
     */
    constructor(code, message) {
      const entry = CATALOG[code] || CATALOG.INTERNAL;
      super(message || entry.message);
      this.name = 'AppError';
      this.code = CATALOG[code] ? code : 'INTERNAL';
      this.action = entry.action;
    }

    /** Forme sérialisable envoyée au content script / à la page d'options. */
    toJSON() {
      return { code: this.code, message: this.message, action: this.action };
    }
  }

  /** Convertit n'importe quelle exception en AppError sans fuite d'information. */
  function toAppError(err) {
    if (err instanceof AppError) return err;
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return new AppError(err.name === 'TimeoutError' ? 'FETCH_TIMEOUT' : 'ABORTED');
    }
    console.error('[Anti-Bait] Erreur interne :', err);
    return new AppError('INTERNAL');
  }

  /**
   * Nettoie un message provenant d'un service tiers avant de l'afficher :
   * masque les clés API éventuelles et tronque à 200 caractères.
   */
  function sanitize(text) {
    return String(text || '')
      .replace(/\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  AB.AppError = AppError;
  AB.errors = Object.freeze({ CATALOG, toAppError, sanitize });
})(globalThis);
