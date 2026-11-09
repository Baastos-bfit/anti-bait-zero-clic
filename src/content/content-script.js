/**
 * Anti-Bait Zéro Clic — Content Script principal
 * ===============================================
 * Rôle : détecter qu'un utilisateur s'ARRÊTE sur un lien d'article, demander
 * le résumé au service worker, et afficher la réponse dans l'infobulle.
 *
 * Ce script ne fait AUCUNE requête réseau (le CORS de la page hôte l'en
 * empêcherait de toute façon) : tout passe par un Port vers le service worker.
 *
 * Ordre de chargement (manifest + enregistrement dynamique) :
 *   domain-utils.js → hover-intent.js → tooltip-ui.js → content-script.js
 *
 * [QA] Performance :
 *   - UNE délégation d'événements sur `document` (pas un écouteur par lien,
 *     pas de MutationObserver) : fonctionne nativement avec les SPA React de
 *     X/LinkedIn qui recyclent le DOM en continu ;
 *   - écouteurs `passive` + AbortController : retrait en une ligne ;
 *   - l'analyse d'un lien est mémorisée par élément (WeakMap → libérée
 *     automatiquement quand X détruit le nœud) ;
 *   - quitter un lien ferme le Port, ce qui annule fetch + IA côté service worker.
 * [QA] Robustesse : après une mise à jour de l'extension, le contexte devient
 *   « invalidated » ; on le détecte et on se démonte proprement au lieu de
 *   lever des erreurs à chaque survol.
 * [SecOps] Le texte reçu de l'IA n'est jamais interprété comme du HTML
 *   (textContent uniquement, dans tooltip-ui.js).
 */
(function () {
  'use strict';

  // ── Garde anti double-injection (static + dynamique, ou réinjection) ──
  if (globalThis.__antiBaitContentActive) return;

  const AB = globalThis.AntiBait;
  const ABC = globalThis.AntiBaitContent;
  if (!AB || !AB.domain || !ABC || !ABC.HoverIntent || !ABC.Tooltip) return;
  globalThis.__antiBaitContentActive = true;

  const D = AB.domain;

  // ── Constantes ─────────────────────────────────────────────────────────
  const PORT_NAME = 'anti-bait-summary';
  const DEFAULT_SETTINGS = { enabled: true, hoverDelayMs: 600, format: 'sentence' };
  const FORMATS = ['sentence', 'bullets'];
  const PREMIUM_NOTICE =
    '🔒 Le format Puces est réservé à la version Premium (3,99 €, paiement unique). La page de paiement s’ouvre dans un nouvel onglet.';
  const GRACE_MS = 350; // temps laissé pour glisser du lien vers l'infobulle
  const CLIENT_CACHE_MAX = 40; // résumés gardés en mémoire dans l'onglet
  const MIN_HEADLINE_CHARS = 15; // texte minimal d'un lien « titre » (sites médias)
  const MAX_LINK_TEXT = 300;
  const NON_ARTICLE_EXT =
    /\.(pdf|jpe?g|png|gif|webp|avif|svg|mp4|webm|mov|mp3|wav|ogg|zip|rar|7z|gz|exe|msi|dmg|apk|docx?|xlsx?|pptx?|csv)$/i;

  /** Libellés des boutons d'action selon le code renvoyé par le service worker. */
  const ACTIONS = {
    'open-options': { label: 'Ouvrir les réglages', message: { type: 'openOptions' } },
    'grant-access': { label: 'Autoriser', message: { type: 'openOptions', section: 'access' } },
    upgrade: { label: 'Passer Premium', message: { type: 'openPayment' } },
  };

  // Plateforme sociale (X, LinkedIn) ou site média : les règles d'éligibilité diffèrent.
  const pageHost = D.bareHost(location.hostname);
  const onSocialPlatform = D.isSocialHost(pageHost);

  // ── État ───────────────────────────────────────────────────────────────
  const lifecycle = new AbortController(); // retire TOUS les écouteurs DOM d'un coup
  let settings = { ...DEFAULT_SETTINGS };
  /**
   * LRU des résumés déjà reçus, par lien puis par format (v2) : rebasculer vers
   * un format déjà affiché est instantané, sans requête.
   * @type {Map<string, {byFormat: Object<string, string>}>}
   */
  const clientCache = new Map();
  /**
   * Dernier statut Premium communiqué par le service worker (v2). Sert
   * uniquement à l'AFFICHAGE du cadenas : le verrou réel est dans le worker.
   */
  let lastPremium = false;
  let paymentOpenedAt = 0; // anti double-clic sur le cadenas
  /** @type {WeakMap<HTMLAnchorElement, {href: string, target: object|null}>} */
  const linkAnalysis = new WeakMap();
  /** Requête en cours (une seule à la fois par onglet). */
  let job = null;
  let tornDown = false;

  // ── Briques UI ─────────────────────────────────────────────────────────
  const hoverIntent = new ABC.HoverIntent({
    delayMs: settings.hoverDelayMs,
    graceMs: GRACE_MS,
    onIntent: handleIntent,
    onAbandon: handleAbandon,
  });

  const tooltip = new ABC.Tooltip({
    onPointerEnter: () => hoverIntent.enterTooltip(),
    onPointerLeave: () => hoverIntent.leaveTooltip(),
    onClose: () => hoverIntent.dismiss(),
    onAnchorLost: () => hoverIntent.dismiss(),
  });

  // ── Contexte d'extension ───────────────────────────────────────────────

  /** Faux quand l'extension a été rechargée/désinstallée (contexte invalidé). */
  function isContextAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  /** Démontage complet : écouteurs, minuteurs, DOM, Port. Idempotent. */
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    lifecycle.abort();
    hoverIntent.destroy();
    cancelJob();
    tooltip.destroy();
    clientCache.clear();
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      /* contexte déjà invalidé : rien à retirer */
    }
    globalThis.__antiBaitContentActive = false;
  }

  /** Envoi d'un message ponctuel au service worker, sans jamais lever d'erreur. */
  function sendToBackground(message) {
    if (!isContextAlive()) return teardown();
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      teardown();
    }
  }

  // ── Réglages (lecture seule ; non sensibles) ───────────────────────────

  function applySettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    settings = {
      enabled: s.enabled !== false,
      hoverDelayMs: Number.isFinite(s.hoverDelayMs)
        ? Math.min(2000, Math.max(200, s.hoverDelayMs))
        : DEFAULT_SETTINGS.hoverDelayMs,
      format: FORMATS.includes(s.format) ? s.format : 'sentence',
    };
    hoverIntent.setDelay(settings.hoverDelayMs);
    if (!settings.enabled) hoverIntent.dismiss();
  }

  function onStorageChanged(changes, area) {
    if (area === 'local' && changes.settings) {
      applySettings(changes.settings.newValue);
      // v2 : la langue ou le format a pu changer — les réponses mémorisées
      // dans l'onglet ne correspondent plus au réglage.
      clientCache.clear();
    }
  }

  try {
    chrome.storage.local
      .get('settings')
      .then((data) => applySettings(data.settings))
      .catch(() => {});
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {
    teardown();
    return;
  }

  // ── Éligibilité d'un lien ──────────────────────────────────────────────

  /** Remonte de la cible d'un événement jusqu'au lien HTML <a href>. */
  function findLink(node) {
    if (!(node instanceof Element)) return null;
    const a = node.closest('a[href]');
    return a instanceof HTMLAnchorElement ? a : null;
  }

  /** Chemin qui ressemble à un article (slug ou arborescence), pas à une rubrique. */
  function looksLikeArticlePath(pathname) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return false;
    const last = segments[segments.length - 1];
    return segments.length >= 3 || (last.includes('-') && last.length >= 12) || /\d{5,}/.test(last);
  }

  /** Texte lisible du lien (les cartes de X portent le titre en aria-label). */
  function linkText(a) {
    const raw = a.getAttribute('aria-label') || a.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TEXT);
  }

  /**
   * Analyse un lien et retourne la cible à résumer, ou null s'il n'est pas éligible.
   * Résultat mémorisé par élément et invalidé si le href change (X recycle les nœuds).
   */
  function resolveTarget(a) {
    const href = a.href;
    const memo = linkAnalysis.get(a);
    if (memo && memo.href === href) return memo.target;
    const target = computeTarget(a, href);
    linkAnalysis.set(a, { href, target });
    return target;
  }

  function computeTarget(a, href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null; // mailto:, javascript:…
    url = D.unwrapRedirector(url);
    url.protocol = 'https:'; // [SecOps] HTTPS uniquement (le service worker refuse le HTTP)
    url.hash = '';
    const host = D.bareHost(url.hostname);
    if (!D.isPublicHostname(host)) return null;
    if (D.isSocialHost(host)) return null; // profils, posts, vidéos : pas des articles
    if (NON_ARTICLE_EXT.test(url.pathname)) return null;

    const text = linkText(a);
    if (D.isSameSite(host, pageHost)) {
      // Sur X/LinkedIn, un lien interne n'est jamais un article externe.
      if (onSocialPlatform) return null;
      // Sur un site média : on ne garde que les titres d'articles internes.
      if (!looksLikeArticlePath(url.pathname) || text.length < MIN_HEADLINE_CHARS) return null;
    }
    return { url: url.href, text, host };
  }

  // ── Écouteurs DOM (délégation unique) ──────────────────────────────────

  const passiveOpts = { capture: true, passive: true, signal: lifecycle.signal };

  document.addEventListener(
    'pointerover',
    (e) => {
      // [QA] Tactile : pas de « survol » réel, on ignore pour ne pas gêner le scroll.
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      if (!settings.enabled) return;
      const link = findLink(e.target);
      if (link && resolveTarget(link)) hoverIntent.enterLink(link);
    },
    passiveOpts
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      const link = findLink(e.target);
      if (!link) return;
      // Déplacement entre deux enfants du même lien : ce n'est pas une sortie.
      if (e.relatedTarget instanceof Node && link.contains(e.relatedTarget)) return;
      hoverIntent.leaveLink(link);
    },
    passiveOpts
  );

  // Accessibilité : la navigation au clavier (Tab) déclenche aussi l'analyse.
  document.addEventListener(
    'focusin',
    (e) => {
      if (!settings.enabled) return;
      const link = findLink(e.target);
      if (link && link.matches(':focus-visible') && resolveTarget(link)) hoverIntent.enterLink(link);
    },
    passiveOpts
  );
  document.addEventListener(
    'focusout',
    (e) => {
      const link = findLink(e.target);
      if (link) hoverIntent.leaveLink(link);
    },
    passiveOpts
  );

  // L'utilisateur clique quand même : l'infobulle n'a plus lieu d'être.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (findLink(e.target)) hoverIntent.dismiss();
    },
    passiveOpts
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && tooltip.visible) hoverIntent.dismiss();
    },
    { capture: true, signal: lifecycle.signal }
  );

  // Défilement : l'infobulle suit le lien (repositionnement limité à 1 fois par frame).
  window.addEventListener('scroll', () => tooltip.scheduleReposition(), passiveOpts);
  window.addEventListener('resize', () => tooltip.scheduleReposition(), passiveOpts);

  // Onglet masqué : on annule l'analyse EN COURS (économie de quota et de CPU).
  // v2 : une infobulle terminée (statique, sans coût) reste affichée — le clic
  // sur « 🔒 Puces » ouvre un onglet de paiement, et l'utilisateur doit retrouver
  // sa réponse et le message d'incitation en revenant.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden' && job) hoverIntent.dismiss();
    },
    { signal: lifecycle.signal }
  );

  // ── Cycle de vie d'une demande de résumé ───────────────────────────────

  function handleIntent(link) {
    if (!isContextAlive()) return teardown();
    const target = resolveTarget(link);
    if (!target) return;

    tooltip.show(link, { domain: D.bareHost(new URL(target.url).hostname) });

    const format = preferredFormat();
    const entry = clientCache.get(target.url);
    if (entry && entry.byFormat[format]) {
      // Rafraîchit la position LRU.
      clientCache.delete(target.url);
      clientCache.set(target.url, entry);
      tooltip.setFinal({ text: entry.byFormat[format], cached: true, format });
      showFormatSelector(link, target, format);
      return;
    }
    startJob(link, target);
  }

  /** Format attendu par défaut (le worker reste seul juge du format réel). */
  function preferredFormat() {
    return settings.format === 'bullets' && lastPremium ? 'bullets' : 'sentence';
  }

  // ── v2 : sélecteur de format ───────────────────────────────────────────

  function showFormatSelector(link, target, current) {
    tooltip.setFormatOptions({
      current,
      premium: lastPremium,
      onSelect: (format) => selectFormat(link, target, current, format),
    });
  }

  /**
   * Clic sur un format dans l'infobulle. Ne ferme jamais l'infobulle : le clic
   * a lieu dans la carte (Shadow DOM), qui n'est pas un lien.
   */
  function selectFormat(link, target, current, format) {
    if (format === current || !FORMATS.includes(format)) return;
    if (!tooltip.visible || tooltip.anchor !== link) return; // infobulle déjà passée à un autre lien
    // La carte ne doit plus bouger sous la souris posée sur le sélecteur.
    tooltip.lockPosition();

    // Compte gratuit : incitation Premium, la réponse actuelle reste affichée.
    if (format === 'bullets' && !lastPremium) {
      tooltip.setNotice(PREMIUM_NOTICE);
      if (Date.now() - paymentOpenedAt > 3000) {
        paymentOpenedAt = Date.now();
        sendToBackground({ type: 'openPayment' });
      }
      return;
    }

    // Format déjà reçu pour ce lien : affichage instantané.
    const entry = clientCache.get(target.url);
    if (entry && entry.byFormat[format]) {
      tooltip.setFinal({ text: entry.byFormat[format], cached: true, format });
      showFormatSelector(link, target, format);
      return;
    }

    // Sinon : nouvelle demande au worker (sans quota, lien déjà analysé).
    tooltip.showReformatting();
    startJob(link, target, format);
  }

  function handleAbandon(link) {
    if (job && job.link === link) cancelJob();
    tooltip.hide();
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {{url: string, text: string}} target
   * @param {string} [format] v2 : format explicite demandé depuis le sélecteur.
   */
  function startJob(link, target, format) {
    cancelJob();
    let port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      teardown(); // contexte invalidé
      return;
    }
    const current = { link, target, url: target.url, port, text: '', finished: false };
    job = current;

    port.onMessage.addListener((msg) => {
      if (job !== current || !msg || typeof msg !== 'object') return;
      handlePortMessage(current, msg);
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // évite l'avertissement « Unchecked runtime.lastError »
      if (job !== current) return;
      job = null;
      if (!current.finished) {
        if (!isContextAlive()) return teardown();
        tooltip.setError({ message: 'Connexion avec l’extension interrompue. Survolez à nouveau le lien.' });
      }
    });

    const request = { type: 'summarize', url: target.url, linkText: target.text };
    if (format) request.format = format;
    port.postMessage(request);
  }

  function handlePortMessage(current, msg) {
    switch (msg.type) {
      case 'status':
        tooltip.setStatus(msg.stage);
        break;
      case 'reset': // l'IA a changé de réponse (repli serveur) : on efface le partiel
        current.text = '';
        tooltip.resetText();
        break;
      case 'chunk':
        if (typeof msg.text === 'string') {
          current.text += msg.text;
          tooltip.appendText(msg.text);
        }
        break;
      case 'done': {
        current.finished = true;
        const text = typeof msg.text === 'string' ? msg.text : current.text;
        const format = FORMATS.includes(msg.format) ? msg.format : 'sentence';
        lastPremium = msg.premium === true;
        remember(current.url, format, text);
        // Le texte final (mis en forme par le worker) remplace le flux brut.
        tooltip.setFinal({ text, cached: Boolean(msg.cached), quota: msg.quota, format });
        showFormatSelector(current.link, current.target, format);
        closeJob(current);
        break;
      }
      case 'error': {
        current.finished = true;
        const action = ACTIONS[msg.action];
        tooltip.setError({
          message: typeof msg.message === 'string' ? msg.message : 'Erreur inattendue.',
          actionLabel: action ? action.label : undefined,
          onAction: action ? () => sendToBackground(action.message) : undefined,
        });
        closeJob(current);
        break;
      }
      default:
        break;
    }
  }

  function remember(url, format, text) {
    if (!text) return;
    const entry = clientCache.get(url) || { byFormat: {} };
    entry.byFormat[format] = text;
    clientCache.delete(url); // position LRU la plus récente
    clientCache.set(url, entry);
    while (clientCache.size > CLIENT_CACHE_MAX) {
      clientCache.delete(clientCache.keys().next().value);
    }
  }

  /** Ferme le Port d'une demande terminée. */
  function closeJob(current) {
    if (job === current) job = null;
    try {
      current.port.disconnect();
    } catch {
      /* déjà fermé */
    }
  }

  /** Annule la demande en cours : la déconnexion déclenche l'abort côté service worker. */
  function cancelJob() {
    if (!job) return;
    const current = job;
    job = null;
    current.finished = true;
    try {
      current.port.disconnect();
    } catch {
      /* déjà fermé */
    }
  }
})();
