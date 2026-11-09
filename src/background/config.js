/**
 * Anti-Bait Zéro Clic — Configuration centrale du service worker
 * ===============================================================
 * Toutes les limites (temps, tailles, quotas) sont regroupées ici pour être
 * auditées d'un coup d'œil par [QA] (performance) et [SecOps] (surface d'attaque).
 *
 * Format : script classique chargé par importScripts() — ExtPay.js n'existe
 * pas en module ES autonome, le service worker est donc un worker « classique ».
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  AB.CONFIG = Object.freeze({
    /**
     * Identifiant de l'extension sur https://extensionpay.com.
     * Doit correspondre EXACTEMENT à l'ID créé dans le tableau de bord ExtensionPay.
     */
    EXTPAY_ID: 'anti-bait-zero-clic',

    /** Analyses IA gratuites par jour (les réponses en cache ne comptent pas). */
    FREE_DAILY_QUOTA: 10,

    // ── Scraping Fantôme ──────────────────────────────────────────────────
    FETCH_TIMEOUT_MS: 8000, // [QA] un site lent ne doit pas bloquer l'infobulle
    MAX_HTML_BYTES: 2 * 1024 * 1024, // [QA] au-delà, on tronque (le texte utile est en tête)
    MAX_REDIRECT_HOPS: 3, // redirections HTML (meta refresh de t.co, interstitiel lnkd.in)
    MAX_ARTICLE_CHARS: 12000, // texte envoyé à l'IA (≈ 3 000 jetons)
    MIN_ARTICLE_CHARS: 280, // en dessous : page vide, paywall ou page de redirection

    // ── IA ────────────────────────────────────────────────────────────────
    AI_TIMEOUT_MS: 45000,
    MAX_ANSWER_CHARS: 1200, // [QA] garde-fou si le modèle ignore la consigne de concision

    // ── Caches ────────────────────────────────────────────────────────────
    CACHE_TTL_MS: 6 * 60 * 60 * 1000, // 6 h
    CACHE_MAX_ENTRIES: 150,
    PREMIUM_CHECK_TTL_MS: 10 * 60 * 1000, // 10 min entre deux vérifications ExtensionPay
    PREMIUM_CHECK_TIMEOUT_MS: 4000,

    // ── Concurrence / cycle de vie ────────────────────────────────────────
    MAX_CONCURRENT_JOBS: 3, // tous onglets confondus
    KEEPALIVE_INTERVAL_MS: 20000, // < 30 s : empêche Chrome de tuer le worker en pleine analyse

    PORT_NAME: 'anti-bait-summary',
    MEDIA_SCRIPT_ID: 'anti-bait-media-sites',
    BROAD_ORIGIN: 'https://*/*',

    /** Fichiers injectés sur les sites de médias ajoutés par l'utilisateur. */
    CONTENT_SCRIPT_FILES: Object.freeze([
      'src/shared/domain-utils.js',
      'src/content/hover-intent.js',
      'src/content/tooltip-ui.js',
      'src/content/content-script.js',
    ]),

    DEFAULT_SETTINGS: Object.freeze({
      enabled: true,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      hoverDelayMs: 600,
      language: 'browser',
      format: 'sentence',
    }),

    // ── v2 : langue et format des réponses ────────────────────────────────
    /**
     * Langue des réponses :
     *   browser : langue de l'interface du navigateur (comportement v1) ;
     *   fr      : toujours en français (traduction des articles étrangers) ;
     *   article : langue d'origine de l'article.
     */
    LANGUAGES: Object.freeze(['browser', 'fr', 'article']),
    /** Formats de réponse. « bullets » (3 puces max) est réservé au Premium. */
    FORMATS: Object.freeze(['sentence', 'bullets']),
    PREMIUM_FORMATS: Object.freeze(['bullets']),

    /** Statistiques (Premium) : temps estimé gagné par clic évité. */
    MINUTES_SAVED_PER_CLICK: 2,

    /** Fournisseurs IA pris en charge (BYOK : l'utilisateur fournit sa clé). */
    PROVIDERS: Object.freeze({
      anthropic: Object.freeze({
        label: 'Anthropic (Claude)',
        keyPrefix: 'sk-ant-',
        defaultModel: 'claude-opus-5-5',
        models: Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']),
      }),
      openai: Object.freeze({
        label: 'OpenAI',
        keyPrefix: 'sk-',
        defaultModel: 'gpt-4.1-mini',
        models: Object.freeze(['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini']),
      }),
    }),
  });
})(globalThis);
