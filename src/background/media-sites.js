/**
 * Anti-Bait Zéro Clic — Sites de médias (injection dynamique)
 * ============================================================
 * Le manifest n'injecte le content script que sur X/Twitter et LinkedIn.
 * Les sites de médias choisis par l'utilisateur (lemonde.fr, bfmtv.com…) sont
 * enregistrés À LA DEMANDE via chrome.scripting.registerContentScripts, après
 * que l'utilisateur a accordé la permission d'hôte correspondante.
 *
 * [SecOps] Permissions progressives : aucun site média n'est lu tant que
 * l'utilisateur ne l'a pas ajouté explicitement. Un domaine dont la permission
 * a été retirée (chrome://extensions) est automatiquement désinscrit.
 * [QA] persistAcrossSessions : l'enregistrement survit aux redémarrages,
 * pas besoin de le refaire à chaque réveil du service worker.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;
  const D = AB.domain;

  const MAX_DOMAINS = 100;

  /** Motifs d'hôte couvrant un domaine et ses sous-domaines. */
  function originsFor(domain) {
    return [`https://${domain}/*`, `https://*.${domain}/*`];
  }

  async function getDomains() {
    const { mediaDomains } = await chrome.storage.local.get('mediaDomains');
    return Array.isArray(mediaDomains) ? mediaDomains.filter((d) => D.normalizeDomain(d) === d) : [];
  }

  async function hasPermission(domain) {
    return chrome.permissions.contains({ origins: originsFor(domain) });
  }

  /** Réaligne le script enregistré sur la liste des domaines autorisés. */
  let syncing = Promise.resolve();
  function sync() {
    const run = syncing.then(doSync, doSync);
    syncing = run.catch(() => {});
    return run;
  }

  async function doSync() {
    const domains = await getDomains();
    const matches = [];
    for (const domain of domains) {
      if (await hasPermission(domain)) matches.push(...originsFor(domain));
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONFIG.MEDIA_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONFIG.MEDIA_SCRIPT_ID] });
    if (matches.length === 0) return;
    await chrome.scripting.registerContentScripts([
      {
        id: CONFIG.MEDIA_SCRIPT_ID,
        matches,
        js: [...CONFIG.CONTENT_SCRIPT_FILES],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  }

  /**
   * Ajoute un domaine. La permission doit avoir été accordée AU PRÉALABLE par
   * la page d'options (chrome.permissions.request exige un geste utilisateur).
   */
  async function addDomain(input) {
    const domain = D.normalizeDomain(input);
    if (!domain) throw new AB.AppError('BAD_REQUEST', 'Nom de domaine invalide.');
    if (D.isBuiltinHost(domain)) throw new AB.AppError('BAD_REQUEST', 'Ce site est déjà pris en charge.');
    if (!(await hasPermission(domain))) throw new AB.AppError('PERMISSION_REQUIRED');
    const domains = await getDomains();
    if (!domains.includes(domain)) {
      if (domains.length >= MAX_DOMAINS) throw new AB.AppError('BAD_REQUEST', `Limite de ${MAX_DOMAINS} sites atteinte.`);
      domains.push(domain);
      domains.sort();
      await chrome.storage.local.set({ mediaDomains: domains });
    }
    await sync();
    return domain;
  }

  async function removeDomain(input) {
    const domain = D.normalizeDomain(input);
    if (!domain) throw new AB.AppError('BAD_REQUEST', 'Nom de domaine invalide.');
    const domains = (await getDomains()).filter((d) => d !== domain);
    await chrome.storage.local.set({ mediaDomains: domains });
    try {
      // Rend la permission spécifique (sans effet si l'accès global est accordé).
      await chrome.permissions.remove({ origins: originsFor(domain) });
    } catch {
      /* permission non retirable individuellement : sans conséquence */
    }
    await sync();
  }

  /** État détaillé pour la page d'options. */
  async function list() {
    const domains = await getDomains();
    return Promise.all(domains.map(async (domain) => ({ domain, granted: await hasPermission(domain) })));
  }

  AB.mediaSites = Object.freeze({ originsFor, sync, addDomain, removeDomain, list });
})(globalThis);
