/**
 * Anti-Bait Zéro Clic — Lecteur Server-Sent Events
 * =================================================
 * Les API Anthropic et OpenAI diffusent leurs réponses en SSE. Ce lecteur
 * transforme un ReadableStream d'octets en événements { event, data }.
 *
 * [QA] Robustesse réseau :
 *   - un événement peut être coupé n'importe où entre deux paquets TCP
 *     (y compris au milieu d'un caractère UTF-8 ou entre \r et \n) : tampon
 *     + TextDecoder en mode stream ;
 *   - si le consommateur s'arrête (annulation, erreur), le flux est annulé
 *     dans le `finally` : la connexion HTTP est libérée immédiatement.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  /** Analyse un bloc d'événement brut (lignes séparées par \n). */
  function parseEvent(raw) {
    let event = 'message';
    const data = [];
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue; // ligne vide ou commentaire (ping)
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
  }

  /**
   * @param {ReadableStream<Uint8Array>} body
   * @returns {AsyncGenerator<{event: string, data: string}>}
   */
  async function* readSse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingCR = false; // \r reçu en fin de paquet : peut être suivi d'un \n
    let finished = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let chunk = decoder.decode(value, { stream: true });
        if (pendingCR) {
          chunk = '\r' + chunk;
          pendingCR = false;
        }
        if (chunk.endsWith('\r')) {
          pendingCR = true;
          chunk = chunk.slice(0, -1);
        }
        buffer += chunk.replace(/\r\n?/g, '\n');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const evt = parseEvent(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          if (evt) yield evt;
        }
      }
      buffer += decoder.decode() + (pendingCR ? '\n' : '');
      const last = parseEvent(buffer.replace(/\r\n?/g, '\n').trim());
      finished = true;
      if (last) yield last;
    } finally {
      if (!finished) {
        // Arrêt anticipé : on coupe la connexion au lieu de la laisser pendre.
        reader.cancel().catch(() => {});
      }
      try {
        reader.releaseLock();
      } catch {
        /* déjà libéré */
      }
    }
  }

  AB.sse = Object.freeze({ readSse, parseEvent });
})(globalThis);
