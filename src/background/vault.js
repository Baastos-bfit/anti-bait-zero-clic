/**
 * Anti-Bait Zéro Clic — Coffre chiffré (Vault)
 * =============================================
 * Chiffre les secrets (clés API) et les états anti-fraude (quota, statut
 * Premium) avant leur écriture dans chrome.storage.local.
 *
 * Schéma :
 *   - une CLÉ MAÎTRE AES-GCM 256 bits est générée UNE fois avec
 *     `extractable: false` : le navigateur refuse d'en exporter les octets,
 *     même au code de l'extension ;
 *   - cet objet CryptoKey est conservé dans l'IndexedDB de l'ORIGINE DE
 *     L'EXTENSION (chrome-extension://<id>), inaccessible aux pages web ET aux
 *     content scripts (qui utilisent l'IndexedDB de la page hôte) ;
 *   - chaque valeur est chiffrée avec un IV aléatoire de 96 bits et des
 *     « données associées » (AAD) qui lient le chiffré à son usage : un
 *     chiffré de clé « openai » ne peut pas être rejoué comme clé « anthropic »,
 *     ni comme compteur de quota.
 *
 * [SecOps] Ce qui est protégé : lecture du profil Chrome sur disque (les clés
 * n'y figurent pas en clair), synchronisation accidentelle, contenu lu ou
 * falsifié via chrome.storage.local depuis un content script compromis.
 * Ce qui NE l'est PAS (limite inhérente à toute extension) : un logiciel
 * malveillant exécuté avec les droits de l'utilisateur, ou un accès DevTools
 * au service worker. C'est documenté dans docs/SECURITY.md.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  const DB_NAME = 'anti-bait-vault';
  const STORE = 'keys';
  const MASTER_ID = 'master-v1';
  const FORMAT_VERSION = 1;

  // ── IndexedDB (promesses) ───────────────────────────────────────────────

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
  }

  function idbRequest(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Charge la clé maître, ou la crée au premier lancement. */
  async function loadOrCreateMasterKey() {
    const db = await idbOpen();
    try {
      const existing = await idbRequest(db, 'readonly', (s) => s.get(MASTER_ID));
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      try {
        // add() (et non put()) : si une autre exécution a créé la clé entre-temps,
        // on échoue proprement au lieu d'écraser la clé déjà utilisée.
        await idbRequest(db, 'readwrite', (s) => s.add(key, MASTER_ID));
        return key;
      } catch {
        const winner = await idbRequest(db, 'readonly', (s) => s.get(MASTER_ID));
        if (winner) return winner;
        throw new Error('Impossible de créer la clé maître');
      }
    } finally {
      db.close();
    }
  }

  // Mémorisation : une seule ouverture IndexedDB par vie du service worker.
  let masterKeyPromise = null;
  let keyProvider = () => {
    if (!masterKeyPromise) {
      masterKeyPromise = loadOrCreateMasterKey().catch((err) => {
        masterKeyPromise = null; // nouvel essai au prochain appel
        throw err;
      });
    }
    return masterKeyPromise;
  };

  // ── Encodage ────────────────────────────────────────────────────────────

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // ── API ─────────────────────────────────────────────────────────────────

  /**
   * Chiffre une chaîne.
   * @param {string} plaintext
   * @param {string} purpose  Contexte lié au chiffré (AAD), ex. « apikey:openai ».
   * @returns {Promise<{v: number, iv: string, ct: string}>}
   */
  async function encrypt(plaintext, purpose) {
    const key = await keyProvider();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) },
      key,
      encoder.encode(plaintext)
    );
    return { v: FORMAT_VERSION, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
  }

  /**
   * Déchiffre une valeur produite par encrypt(). Lève une erreur si le chiffré
   * a été modifié, si l'usage (AAD) ne correspond pas ou si la clé maître a changé.
   */
  async function decrypt(blob, purpose) {
    if (!blob || blob.v !== FORMAT_VERSION || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') {
      throw new Error('Format chiffré invalide');
    }
    const key = await keyProvider();
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: encoder.encode(purpose) },
      key,
      fromBase64(blob.ct)
    );
    return decoder.decode(pt);
  }

  /**
   * Remplace la source de la clé maître (tests unitaires sous Node, où
   * IndexedDB n'existe pas). Jamais appelé par l'extension elle-même.
   */
  function useKeyProvider(provider) {
    keyProvider = provider;
  }

  /**
   * Stockage chiffré clé/valeur JSON dans chrome.storage.local.
   */
  const secureStore = Object.freeze({
    /**
     * Lecture détaillée : distingue « absent » de « présent mais illisible »
     * (falsifié), pour que l'appelant puisse refuser par défaut dans ce dernier cas.
     * @returns {Promise<{status: 'absent'|'ok'|'invalid', value: any}>}
     */
    async read(name) {
      const data = await chrome.storage.local.get(name);
      if (data[name] === undefined) return { status: 'absent', value: null };
      try {
        return { status: 'ok', value: JSON.parse(await decrypt(data[name], 'store:' + name)) };
      } catch {
        return { status: 'invalid', value: null };
      }
    },
    /** Lecture simple : une valeur illisible est traitée comme absente. */
    async get(name) {
      const { value } = await this.read(name);
      return value;
    },
    async set(name, value) {
      const blob = await encrypt(JSON.stringify(value), 'store:' + name);
      await chrome.storage.local.set({ [name]: blob });
    },
  });

  AB.vault = Object.freeze({ encrypt, decrypt, useKeyProvider, secureStore });
})(globalThis);
