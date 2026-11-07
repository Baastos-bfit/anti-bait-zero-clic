/**
 * Anti-Bait Zéro Clic — « Scraping Fantôme »
 * ===========================================
 * Télécharge discrètement la page cible depuis le service worker, sans
 * l'ouvrir dans un onglet, puis en extrait le texte éditorial.
 *
 * Discrétion et vie privée ([SecOps]) :
 *   - credentials: 'omit'   → AUCUN cookie envoyé : le site ne sait pas qui
 *                             vous êtes, et on n'envoie jamais à l'IA le contenu
 *                             d'une session connectée (messagerie, compte…) ;
 *   - referrerPolicy: 'no-referrer' → le site ne sait pas d'où vient le lien ;
 *   - permission d'hôte vérifiée AVANT chaque requête (accès progressif) ;
 *   - garde anti-SSRF sur l'URL initiale, l'URL finale après redirections HTTP
 *     et chaque redirection HTML.
 * Robustesse ([QA]) :
 *   - délai maximal par requête (AbortSignal.timeout) combiné à l'annulation
 *     utilisateur (AbortSignal.any) ;
 *   - lecture en flux plafonnée à MAX_HTML_BYTES (une page de 50 Mo ne fait
 *     pas exploser la mémoire du worker) ;
 *   - refus des contenus non HTML (PDF, vidéos, images) dès les en-têtes ;
 *   - décodage selon le charset déclaré (sites en ISO-8859-1 / Windows-1252).
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const { CONFIG } = AB;

  const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;

  /** Vérifie que l'utilisateur a autorisé la lecture de ce site. */
  async function ensureHostPermission(url) {
    const granted = await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
    if (!granted) throw new AB.AppError('PERMISSION_REQUIRED');
  }

  /** Correspondance statut HTTP → erreur explicite. */
  function httpError(status) {
    if (status === 404 || status === 410) return new AB.AppError('FETCH_NOT_FOUND');
    if (status === 401 || status === 402 || status === 403 || status === 451) return new AB.AppError('FETCH_BLOCKED');
    if (status === 429) return new AB.AppError('FETCH_RATE_LIMITED');
    return new AB.AppError('FETCH_FAILED');
  }

  /** Lit le corps en flux, en s'arrêtant à `maxBytes` (le début suffit). */
  async function readCapped(response, maxBytes) {
    if (!response.body) return new Uint8Array(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const room = maxBytes - total;
        if (value.byteLength >= room) {
          chunks.push(value.subarray(0, room));
          total += room;
          await reader.cancel(); // libère la connexion immédiatement
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* déjà libéré */
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  /** Décode les octets selon le charset (en-tête HTTP, sinon <meta charset>, sinon UTF-8). */
  function decodeHtml(bytes, contentType) {
    let charset = (/charset\s*=\s*["']?([A-Za-z0-9_\-:.]+)/i.exec(contentType || '') || [])[1];
    if (!charset) {
      const sample = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
      charset = AB.extractor.sniffCharset(sample) || 'utf-8';
    }
    try {
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // charset inconnu
    }
  }

  /** Une requête HTTP unique, avec délai et annulation. */
  async function fetchOnce(url, signal) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(CONFIG.FETCH_TIMEOUT_MS)]);
    let response;
    try {
      response = await fetch(url.href, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        cache: 'default',
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
        signal: combined,
      });
    } catch (err) {
      if (signal.aborted) throw new AB.AppError('ABORTED');
      if (err && err.name === 'TimeoutError') throw new AB.AppError('FETCH_TIMEOUT');
      throw new AB.AppError('FETCH_FAILED');
    }

    // Une redirection HTTP a pu nous emmener vers une adresse interdite.
    const finalCheck = AB.urlGuard.validate(response.url || url.href);
    if (!finalCheck.ok) {
      response.body?.cancel().catch(() => {});
      throw new AB.AppError(finalCheck.code);
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw httpError(response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !HTML_TYPES.test(contentType)) {
      response.body?.cancel().catch(() => {});
      throw new AB.AppError('NOT_HTML');
    }

    let bytes;
    try {
      bytes = await readCapped(response, CONFIG.MAX_HTML_BYTES);
    } catch (err) {
      if (signal.aborted) throw new AB.AppError('ABORTED');
      if (err && err.name === 'TimeoutError') throw new AB.AppError('FETCH_TIMEOUT');
      throw new AB.AppError('FETCH_FAILED');
    }
    return { finalUrl: finalCheck.url, html: decodeHtml(bytes, contentType) };
  }

  /**
   * Télécharge et extrait un article, en suivant les redirections HTML.
   * @param {string} rawUrl
   * @param {AbortSignal} signal
   * @returns {Promise<{finalUrl: string, title: string, description: string, text: string, source: string}>}
   */
  async function fetchArticle(rawUrl, signal) {
    let target = rawUrl;
    for (let hop = 0; hop <= CONFIG.MAX_REDIRECT_HOPS; hop++) {
      const url = AB.urlGuard.assertSafe(target);
      await ensureHostPermission(url);
      const { finalUrl, html } = await fetchOnce(url, signal);
      const article = AB.extractor.extractArticle(html, {
        maxChars: CONFIG.MAX_ARTICLE_CHARS,
        minChars: CONFIG.MIN_ARTICLE_CHARS,
      });
      if (article.redirectUrl) {
        let next;
        try {
          const u = new URL(article.redirectUrl, finalUrl);
          if (u.protocol === 'http:') u.protocol = 'https:'; // t.co pointe parfois en HTTP
          next = u.href;
        } catch {
          next = null;
        }
        if (next && next !== finalUrl.href) {
          target = next;
          continue;
        }
      }
      if (!article.text) throw new AB.AppError('EMPTY_CONTENT');
      return { finalUrl: finalUrl.href, ...article };
    }
    throw new AB.AppError('TOO_MANY_REDIRECTS');
  }

  AB.scraper = Object.freeze({ fetchArticle, decodeHtml, readCapped });
})(globalThis);
