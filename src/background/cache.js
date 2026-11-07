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
 * Clés : « sum:<sha256(url)> » (l'URL en clair n'apparaît pas dans les clés).
 * Éviction : TTL + plafond d'entrées (les plus anciennes partent en premier).
 * [QA] Les écritures sont sérialisées dans une file pour éviter que deux
 * analyses simultanées corrompent l'index.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  const INDEX_KEY = 'sumIndex'; // [[key, timestamp], ...] du plus ancien au plus récent
  let queue = Promise.resolve();

  /** Exécute les opérations d'écriture l'une après l'autre. */
  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function keyFor(url) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return 'sum:' + hex;
  }

  /** @returns {Promise<{text: string, title: string, finalUrl: string} | null>} */
  async function get(url) {
    const key = await keyFor(url);
    const data = await chrome.storage.session.get(key);
    const entry = data[key];
    if (!entry || typeof entry.text !== 'string') return null;
    if (Date.now() - entry.ts > CONFIG.CACHE_TTL_MS) return null;
    return entry;
  }

  function set(url, value) {
    return serialized(async () => {
      const key = await keyFor(url);
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
      index.push([key, now]);
      while (index.length > CONFIG.CACHE_MAX_ENTRIES) evicted.push(index.shift()[0]);
      await chrome.storage.session.set({
        [key]: { text: value.text, title: value.title || '', finalUrl: value.finalUrl || '', ts: now },
        [INDEX_KEY]: index,
      });
      if (evicted.length) await chrome.storage.session.remove(evicted);
    });
  }

  AB.cache = Object.freeze({ get, set });
})(globalThis);
