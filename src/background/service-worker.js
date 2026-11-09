/**
 * Anti-Bait Zéro Clic — Service Worker (gestionnaire de requêtes asynchrones)
 * ============================================================================
 * Point central de l'extension. Il est le SEUL à :
 *   - faire des requêtes réseau (articles + API IA) ;
 *   - manipuler la clé API (déchiffrée juste avant l'appel) ;
 *   - décider du statut Premium et du quota.
 *
 * Canaux de communication :
 *   1. Port « anti-bait-summary » (content script → worker) : une demande
 *      d'analyse en streaming. Fermer le Port = annuler l'analyse.
 *   2. Messages ponctuels (runtime.onMessage) :
 *        - depuis un content script : uniquement ouvrir les réglages / le paiement ;
 *        - depuis une page de l'extension (options) : gestion complète.
 *
 * Cycle de vie MV3 ([QA]) : Chrome arrête le worker après ~30 s d'inactivité.
 *   - tous les écouteurs sont enregistrés de façon SYNCHRONE au chargement
 *     (sinon les événements qui réveillent le worker seraient perdus) ;
 *   - aucun état critique en variable globale (stockage chrome.storage) ;
 *   - pendant une analyse, un battement léger (getPlatformInfo toutes les 20 s)
 *     empêche l'arrêt du worker au milieu d'une réponse IA.
 */
'use strict';

// Le chemin est relatif à ce fichier (src/background/).
importScripts(
  '../../vendor/ExtPay.js',
  '../shared/domain-utils.js',
  'config.js',
  'errors.js',
  'url-guard.js',
  'jobs.js',
  'vault.js',
  'settings.js',
  'cache.js',
  'premium.js',
  'media-sites.js',
  'html-extractor.js',
  'sse.js',
  'scraper.js',
  'ai-connector.js'
);

const AB = globalThis.AntiBait;
const { CONFIG, AppError } = AB;
const EXTENSION_ORIGIN = chrome.runtime.getURL('');
const jobs = new AB.JobRegistry(CONFIG.MAX_CONCURRENT_JOBS);

// ═══════════════════════════════════════════════════════════════════════
// Maintien en vie pendant les analyses
// ═══════════════════════════════════════════════════════════════════════

let keepAliveTimer = null;

function updateKeepAlive() {
  if (jobs.size > 0 && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, CONFIG.KEEPALIVE_INTERVAL_MS);
  } else if (jobs.size === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Pipeline d'analyse : lien → article → IA → infobulle
// ═══════════════════════════════════════════════════════════════════════

/** Envoie un message sur un Port sans jamais lever (le Port a pu être fermé). */
function safePost(port, message) {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

/**
 * Traite une demande d'analyse.
 * @param {chrome.runtime.Port} port
 * @param {{url: string, linkText: string, format?: string}} request
 *   format (v2, optionnel) : envoyé par le sélecteur de l'infobulle pour
 *   réafficher un lien dans un autre format. Absent = réglage de l'utilisateur.
 * @param {AbortSignal} signal
 */
async function runSummary(port, request, signal) {
  let reservation = null;
  let committed = false;
  try {
    // 1. Validation (le content script n'est jamais cru sur parole).
    const url = AB.urlGuard.assertSafe(request.url).href;
    const linkText = typeof request.linkText === 'string' ? request.linkText.slice(0, 300) : '';
    const explicitFormat = request.format !== undefined;
    if (explicitFormat && !CONFIG.FORMATS.includes(request.format)) throw new AppError('BAD_REQUEST');

    const settings = await AB.settings.getSettings();
    if (!settings.enabled) throw new AppError('DISABLED');

    // 2. Langue et format effectifs. [SecOps] Décidés ici, avec le statut Premium
    //    vérifié auprès d'ExtensionPay : les puces restent réservées au Premium,
    //    même si un content script ou un réglage les demande.
    const premium = await AB.premium.isPremium();
    const requestedFormat = explicitFormat ? request.format : settings.format;
    if (explicitFormat && AB.settings.isPremiumFormat(requestedFormat) && !premium) {
      throw new AppError('PREMIUM_REQUIRED');
    }
    const format = AB.settings.effectiveFormat(requestedFormat, premium);
    const variant = { language: AB.ai.resolveLanguage(settings.language).id, format };

    // 3. Cache : réponse instantanée, sans quota ni réseau.
    const cached = await AB.cache.get(url, variant);
    if (cached) {
      safePost(port, { type: 'done', cached: true, text: cached.text, title: cached.title, format });
      return;
    }

    // 4. Clé API (déchiffrée maintenant, oubliée à la fin de la fonction).
    const apiKey = await AB.settings.getApiKey(settings.provider);

    // 5. Quota : réservé avant tout travail coûteux, rendu en cas d'échec.
    //    Règle v2 : changer le format d'un lien DÉJÀ analysé ne consomme pas de
    //    quota. [SecOps] La preuve vient du cache du worker (storage.session,
    //    illisible par les pages), pas d'une affirmation du content script.
    const isReformat = explicitFormat && (await AB.cache.hasAny(url));
    const quota = isReformat
      ? { ok: true, premium, remaining: null, reservation: null }
      : await AB.premium.reserve();
    if (!quota.ok) throw new AppError('QUOTA_EXCEEDED');
    reservation = quota.reservation;
    if (signal.aborted) throw new AppError('ABORTED');

    // 6. Scraping Fantôme.
    safePost(port, { type: 'status', stage: 'fetching' });
    const article = await AB.scraper.fetchArticle(url, signal);

    // 7. IA en streaming.
    safePost(port, { type: 'status', stage: 'thinking' });
    let answer = '';
    const stream = AB.ai.streamAnswer(
      {
        provider: settings.provider,
        model: settings.model,
        apiKey,
        article,
        linkText,
        language: settings.language,
        format,
      },
      signal
    );
    for await (const event of stream) {
      if (event.type === 'reset') {
        answer = '';
        safePost(port, { type: 'reset' });
        continue;
      }
      // [QA] Plafond de longueur : un modèle bavard ne doit pas inonder l'infobulle.
      const room = CONFIG.MAX_ANSWER_CHARS - answer.length;
      if (room <= 0) break;
      const piece = event.text.slice(0, room);
      answer += piece;
      safePost(port, { type: 'chunk', text: piece });
    }

    // Mise en forme définitive (puces « • » normalisées, phrase sur une ligne).
    answer = AB.ai.normalizeAnswer(answer, format);
    if (!answer) throw new AppError('EMPTY_ANSWER');

    // 8. Succès : le quota est définitivement consommé, la réponse mise en cache
    //    (sous l'URL demandée ET l'URL finale, pour les liens raccourcis).
    committed = true;
    const entry = { text: answer, title: article.title, finalUrl: article.finalUrl };
    await AB.cache.set(url, variant, entry);
    if (article.finalUrl !== url) await AB.cache.set(article.finalUrl, variant, entry);
    safePost(port, {
      type: 'done',
      cached: false,
      text: answer,
      title: article.title,
      format,
      quota: { premium: quota.premium, remaining: quota.remaining },
    });
  } catch (err) {
    const error = AB.errors.toAppError(err);
    if (!committed && reservation) await AB.premium.refund(reservation).catch(() => {});
    // Annulation : le content script est déjà parti, inutile de répondre.
    if (error.code !== 'ABORTED' && !signal.aborted) {
      safePost(port, { type: 'error', ...error.toJSON() });
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CONFIG.PORT_NAME) return;
  const sender = port.sender || {};
  // [SecOps] Seuls nos propres content scripts, dans un onglet, peuvent ouvrir ce canal.
  if (sender.id !== chrome.runtime.id || !sender.tab || typeof sender.tab.id !== 'number') {
    port.disconnect();
    return;
  }

  let job = null;

  port.onMessage.addListener((msg) => {
    if (job || !msg || msg.type !== 'summarize' || typeof msg.url !== 'string') return; // une demande par Port
    job = jobs.start(sender.tab.id);
    updateKeepAlive();
    const { id, signal } = job;
    // Si le registre annule l'analyse (nouvelle demande du même onglet / capacité),
    // on ferme le Port pour que l'infobulle obsolète ne reste pas bloquée.
    signal.addEventListener('abort', () => {
      try {
        port.disconnect();
      } catch {
        /* déjà fermé */
      }
    });
    runSummary(port, msg, signal).finally(() => {
      jobs.finish(id);
      updateKeepAlive();
      try {
        port.disconnect();
      } catch {
        /* déjà fermé */
      }
    });
  });

  // Survol abandonné / onglet fermé : on annule fetch + IA immédiatement.
  port.onDisconnect.addListener(() => {
    if (job) jobs.abort(job.id, 'disconnected');
    updateKeepAlive();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Messages ponctuels
// ═══════════════════════════════════════════════════════════════════════

/** Vrai si l'expéditeur est une page de NOTRE extension (options), pas un site web. */
function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(EXTENSION_ORIGIN);
}

/** Vrai si l'expéditeur est l'un de nos content scripts. */
function isOwnContentScript(sender) {
  return sender.id === chrome.runtime.id && Boolean(sender.tab);
}

async function openOptions(section) {
  const allowed = ['access', 'api', 'media', 'premium'];
  const hash = allowed.includes(section) ? '#' + section : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') + hash });
}

async function getState() {
  const [settings, keys, broad, mediaDomains, premium] = await Promise.all([
    AB.settings.getSettings(),
    AB.settings.getKeyHints(),
    chrome.permissions.contains({ origins: [CONFIG.BROAD_ORIGIN] }),
    AB.mediaSites.list(),
    AB.premium.getStatus(),
  ]);
  const providers = {};
  for (const [id, p] of Object.entries(CONFIG.PROVIDERS)) {
    providers[id] = { label: p.label, models: [...p.models], defaultModel: p.defaultModel, keyPrefix: p.keyPrefix };
  }
  return { settings, keys, access: { broad }, mediaDomains, premium, providers };
}

/** Actions réservées aux pages de l'extension. */
const PAGE_HANDLERS = {
  getState: () => getState(),
  saveSettings: async (msg) => {
    // [SecOps] Le format « puces » ne peut être enregistré que par un Premium.
    const wanted = msg.settings && typeof msg.settings === 'object' ? msg.settings : {};
    if (AB.settings.isPremiumFormat(wanted.format) && !(await AB.premium.isPremium())) {
      throw new AppError('PREMIUM_REQUIRED');
    }
    return AB.settings.saveSettings(wanted);
  },
  saveApiKey: async (msg) => ({ hint: await AB.settings.setApiKey(msg.provider, msg.key) }),
  deleteApiKey: (msg) => AB.settings.deleteApiKey(msg.provider),
  testApiKey: async (msg) => {
    const settings = await AB.settings.getSettings();
    const provider = typeof msg.provider === 'string' ? msg.provider : settings.provider;
    const model = provider === settings.provider ? settings.model : CONFIG.PROVIDERS[provider]?.defaultModel;
    const apiKey = await AB.settings.getApiKey(provider);
    return AB.ai.testKey({ provider, model, apiKey });
  },
  addMediaDomain: (msg) => AB.mediaSites.addDomain(msg.domain),
  removeMediaDomain: (msg) => AB.mediaSites.removeDomain(msg.domain),
  syncMediaDomains: () => AB.mediaSites.sync(),
  refreshPremium: () => AB.premium.getStatus({ force: true }),
  openPayment: () => AB.premium.openPaymentPage(),
  openLogin: () => AB.premium.openLoginPage(),
};

/** Actions autorisées aux content scripts (aucune donnée sensible). */
const CONTENT_HANDLERS = {
  openOptions: (msg) => openOptions(msg.section),
  openPayment: () => AB.premium.openPaymentPage(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Les messages texte (ex. « extpay-fetch-user ») appartiennent à ExtPay : on les ignore.
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;

  let handler = null;
  if (isExtensionPage(sender)) handler = PAGE_HANDLERS[msg.type] || CONTENT_HANDLERS[msg.type];
  else if (isOwnContentScript(sender)) handler = CONTENT_HANDLERS[msg.type];
  if (!handler) {
    sendResponse({ ok: false, error: new AppError('FORBIDDEN').toJSON() });
    return false;
  }

  Promise.resolve()
    .then(() => handler(msg))
    .then((data) => sendResponse({ ok: true, data: data === undefined ? null : data }))
    .catch((err) => sendResponse({ ok: false, error: AB.errors.toAppError(err).toJSON() }));
  return true; // réponse asynchrone
});

// ═══════════════════════════════════════════════════════════════════════
// Installation, démarrage, permissions
// ═══════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener((details) => {
  // [SecOps] Le cache de session reste inaccessible aux content scripts.
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  AB.mediaSites.sync().catch((err) => console.warn('[Anti-Bait] Synchronisation des sites :', err));
  if (details.reason === 'install') {
    openOptions('api').catch(() => {}); // page de bienvenue / configuration
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  AB.mediaSites.sync().catch(() => {});
});

// Permission retirée depuis chrome://extensions : on désinscrit les sites concernés.
chrome.permissions.onRemoved.addListener(() => {
  AB.mediaSites.sync().catch(() => {});
});
chrome.permissions.onAdded.addListener(() => {
  AB.mediaSites.sync().catch(() => {});
});

// Clic sur l'icône : ouvre les réglages.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage().catch(() => openOptions());
});
