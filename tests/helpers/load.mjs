/**
 * Chargeur de scripts « classiques » de l'extension dans un contexte Node isolé
 * (node:vm), avec des doublures minimales des API chrome.* utilisées.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * @param {string[]} files  Chemins relatifs à la racine du projet.
 * @param {object} [globals] Globals supplémentaires (fetch, chrome, ExtPay…).
 */
export function loadScripts(files, globals = {}) {
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Response,
    Headers,
    ReadableStream,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    crypto: globalThis.crypto,
    btoa,
    atob,
    Intl,
    ...globals,
  });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return context;
}

/** Doublure de chrome.storage (local + session) en mémoire. */
export function fakeStorageArea() {
  const data = new Map();
  return {
    data,
    async get(keys) {
      const list = keys == null ? [...data.keys()] : [].concat(keys);
      const out = {};
      for (const k of list) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) data.delete(k);
    },
  };
}

/** Clé maître AES-GCM en mémoire (remplace IndexedDB, absente de Node). */
export async function memoryKeyProvider() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return () => Promise.resolve(key);
}

/** Construit un Response dont le corps arrive en plusieurs paquets. */
export function chunkedResponse(chunks, init = {}) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(stream, init);
}

/** Horloge simulée pour tester les minuteurs sans attendre. */
export function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = target;
    },
    get pending() {
      return timers.size;
    },
  };
}
