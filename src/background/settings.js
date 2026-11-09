/**
 * Anti-Bait Zéro Clic — Réglages et clés API
 * ===========================================
 * Disposition de chrome.storage.local :
 *   settings     : { enabled, provider, model, hoverDelayMs, language, format } (clair, non sensible)
 *   apiKeys      : { anthropic?: {v,iv,ct,hint}, openai?: {...} } (CHIFFRÉ via vault)
 *   mediaDomains : ['lemonde.fr', ...]                           (clair)
 *   quota, premiumLastKnown                                      (CHIFFRÉS, voir premium.js)
 *
 * [SecOps]
 *   - la clé API n'est déchiffrée qu'à l'instant de l'appel IA, dans le service
 *     worker, et n'est JAMAIS renvoyée à une page : l'interface ne reçoit
 *     qu'un indice (« …x7Qa ») ;
 *   - toutes les entrées sont validées et bornées (type, longueur, liste blanche).
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  const MODEL_RE = /^[a-z0-9][a-z0-9.\-:_]{1,79}$/i;

  /** Fusionne avec les valeurs par défaut et assainit chaque champ. */
  function sanitizeSettings(raw) {
    const d = CONFIG.DEFAULT_SETTINGS;
    const s = raw && typeof raw === 'object' ? raw : {};
    const provider = Object.prototype.hasOwnProperty.call(CONFIG.PROVIDERS, s.provider) ? s.provider : d.provider;
    const candidate = typeof s.model === 'string' ? s.model.trim() : '';
    // Un modèle Claude n'a de sens qu'avec Anthropic, et inversement.
    const familyOk = provider === 'anthropic' ? /^claude-/.test(candidate) : !/^claude-/.test(candidate);
    const model = MODEL_RE.test(candidate) && familyOk ? candidate : CONFIG.PROVIDERS[provider].defaultModel;
    const delay = Number(s.hoverDelayMs);
    return {
      enabled: s.enabled !== false,
      provider,
      model,
      hoverDelayMs: Number.isFinite(delay) ? Math.round(Math.min(2000, Math.max(200, delay))) : d.hoverDelayMs,
      // v2 : listes fermées uniquement — aucune valeur libre n'atteint le prompt.
      language: CONFIG.LANGUAGES.includes(s.language) ? s.language : d.language,
      format: CONFIG.FORMATS.includes(s.format) ? s.format : d.format,
    };
  }

  /** Vrai si le format exige la version Premium. */
  function isPremiumFormat(format) {
    return CONFIG.PREMIUM_FORMATS.includes(format);
  }

  /**
   * Format réellement appliqué. [SecOps] Seul le service worker l'appelle, avec
   * le statut Premium vérifié auprès d'ExtensionPay : un utilisateur gratuit
   * obtient toujours « sentence », quel que soit le réglage stocké ou demandé.
   * Un Premium remboursé redescend ainsi automatiquement, sans réglage cassé.
   * @param {string} requested Format souhaité (réglage ou demande de l'infobulle).
   * @param {boolean} premium
   */
  function effectiveFormat(requested, premium) {
    const format = CONFIG.FORMATS.includes(requested) ? requested : CONFIG.DEFAULT_SETTINGS.format;
    return isPremiumFormat(format) && !premium ? CONFIG.DEFAULT_SETTINGS.format : format;
  }

  async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return sanitizeSettings(settings);
  }

  /** Mise à jour partielle (seuls les champs connus sont retenus). */
  async function saveSettings(partial) {
    const current = await getSettings();
    const next = sanitizeSettings({ ...current, ...(partial && typeof partial === 'object' ? partial : {}) });
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  function assertProvider(provider) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG.PROVIDERS, provider)) {
      throw new AB.AppError('BAD_REQUEST', 'Fournisseur IA inconnu.');
    }
  }

  /** Valide le format d'une clé avant de la chiffrer. */
  function validateKeyFormat(provider, key) {
    const k = typeof key === 'string' ? key.trim() : '';
    if (k.length < 20 || k.length > 300 || /\s/.test(k)) {
      throw new AB.AppError('BAD_REQUEST', 'Format de clé API invalide.');
    }
    const prefix = CONFIG.PROVIDERS[provider].keyPrefix;
    if (!k.startsWith(prefix)) {
      throw new AB.AppError('BAD_REQUEST', `Une clé ${CONFIG.PROVIDERS[provider].label} commence par « ${prefix} ».`);
    }
    if (provider === 'openai' && k.startsWith('sk-ant-')) {
      throw new AB.AppError('BAD_REQUEST', 'Ceci est une clé Anthropic, pas une clé OpenAI.');
    }
    return k;
  }

  async function setApiKey(provider, key) {
    assertProvider(provider);
    const clean = validateKeyFormat(provider, key);
    const blob = await AB.vault.encrypt(clean, 'apikey:' + provider);
    const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
    apiKeys[provider] = { ...blob, hint: '…' + clean.slice(-4) };
    await chrome.storage.local.set({ apiKeys });
    return apiKeys[provider].hint;
  }

  /**
   * Retourne la clé en clair, ou lève NO_API_KEY / KEY_UNREADABLE.
   * À n'appeler qu'au moment de l'appel réseau, sans jamais stocker le résultat.
   */
  async function getApiKey(provider) {
    assertProvider(provider);
    const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
    const entry = apiKeys[provider];
    if (!entry) throw new AB.AppError('NO_API_KEY');
    try {
      return await AB.vault.decrypt(entry, 'apikey:' + provider);
    } catch {
      throw new AB.AppError('KEY_UNREADABLE');
    }
  }

  async function deleteApiKey(provider) {
    assertProvider(provider);
    const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
    delete apiKeys[provider];
    await chrome.storage.local.set({ apiKeys });
  }

  /** Indices non sensibles pour l'interface : { anthropic: '…x7Qa' | null, ... } */
  async function getKeyHints() {
    const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
    const hints = {};
    for (const p of Object.keys(CONFIG.PROVIDERS)) hints[p] = apiKeys[p] ? apiKeys[p].hint : null;
    return hints;
  }

  AB.settings = Object.freeze({
    sanitizeSettings,
    isPremiumFormat,
    effectiveFormat,
    getSettings,
    saveSettings,
    setApiKey,
    getApiKey,
    deleteApiKey,
    getKeyHints,
  });
})(globalThis);
