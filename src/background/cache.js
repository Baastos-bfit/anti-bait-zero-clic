/**
 * Anti-Bait Zéro Clic — Cache des réponses
 * =========================================
 * Survoler deux fois le même lien (ou le même article partagé par 20 comptes)
 * ne doit coûter qu'UN appel IA et aucun quota supplémentaire.
 *
 * Stockage : chrome.storage.session
 *   - en mémoire uniquement, vidé à la fermeture du navigateur : aucun
 *     historique de navigation ne persiste sur disque ([SecOps] vie privée) ;
 *   - survit aux redémarrages du service worker (contrairement à une variable) ;
 *   - niveau d'accès TRUSTED_CONTEXTS : illisible par les content scripts.
 *
 * Clés (v2) : « sum:<sha256(url)>:<variante> », où la variante combine la langue
 * et le format de la réponse (ex. « ui-fr|sentence »). [QA] Sans elle, une
 * réponse en anglais ou en phrase serait resservie après un changement de réglage.
 * L'URL en clair n'apparaît pas dans les clés.
 *
 * hasAny(url) indique si le lien a déjà été analysé dans N'IMPORTE QUELLE
 * variante : c'est la preuve, côté worker, qu'une demande est un simple
 * changement de format (non décompté du quota). [SecOps] Ce registre vit dans
 * storage.session, inaccessible aux pages : un content script ne peut pas
 * prétendre qu'un lien a déjà été analysé.
 *
 * Éviction : TTL + plafond d'entrées (les plus anciennes partent en premier).
 * [QA] Les écritures sont sérialisées dans une file pour éviter que deux
 * analyses simultanées corrompent l'index.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  const INDEX_KEY = 'sumIndex'; // [[key, timestamp, urlHash], ...] du plus ancien au plus récent
  let queue = Promise.resolve();

  /** Exécute les opérations d'écriture l'une après l'autre. */
  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function hashUrl(url) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Identifiant de variante, ex. « ui-fr|sentence ». */
  function variantId({ language, format }) {
    return `${language}|${format}`;
  }

  async function keyFor(url, variant) {
    return `sum:${await hashUrl(url)}:${variantId(variant)}`;
  }

  /**
   * @param {string} url
   * @param {{language: string, format: string}} variant
   * @returns {Promise<{text: string, title: string, finalUrl: string} | null>}
   */
  async function get(url, variant) {
    const key = await keyFor(url, variant);
    const data = await chrome.storage.session.get(key);
    const entry = data[key];
    if (!entry || typeof entry.text !== 'string') return null;
    if (Date.now() - entry.ts > CONFIG.CACHE_TTL_MS) return null;
    return entry;
  }

  /** Vrai si le lien a une réponse valide en cache, quelle que soit sa variante. */
  async function hasAny(url) {
    const urlHash = await hashUrl(url);
    const data = await chrome.storage.session.get(INDEX_KEY);
    const index = Array.isArray(data[INDEX_KEY]) ? data[INDEX_KEY] : [];
    const now = Date.now();
    return index.some(([, ts, h]) => h === urlHash && now - ts <= CONFIG.CACHE_TTL_MS);
  }

  function set(url, variant, value) {
    return serialized(async () => {
      const urlHash = await hashUrl(url);
      const key = `sum:${urlHash}:${variantId(variant)}`;
      const now = Date.now();
      const data = await chrome.storage.session.get(INDEX_KEY);
      let index = Array.isArray(data[INDEX_KEY]) ? data[INDEX_KEY] : [];
      const evicted = [];
      index = index.filter(([k, ts]) => {
        if (k === key) return false; // ré-inséré en fin de liste ci-dessous
        if (now - ts > CONFIG.CACHE_TTL_MS) {
          evicted.push(k); // expiré : supprimé du stockage aussi
          return false;
        }
        return true;
      });
      index.push([key, now, urlHash]);
      while (index.length > CONFIG.CACHE_MAX_ENTRIES) evicted.push(index.shift()[0]);
      await chrome.storage.session.set({
        [key]: { text: value.text, title: value.title || '', finalUrl: value.finalUrl || '', ts: now },
        [INDEX_KEY]: index,
      });
      if (evicted.length) await chrome.storage.session.remove(evicted);
    });
  }

  AB.cache = Object.freeze({ get, set, hasAny });
})(globalThis);
