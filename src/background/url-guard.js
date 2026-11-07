/**
 * Anti-Bait Zéro Clic — Garde d'URL (anti-SSRF)
 * ==============================================
 * [SecOps] Le service worker possède (après accord) la permission d'accéder à
 * TOUT site HTTPS. Une page malveillante pourrait donc afficher un lien vers
 * https://192.168.1.1/admin ou https://intranet.corp/ et espérer que notre
 * extension aille lire ce contenu privé puis l'envoie à un fournisseur IA.
 *
 * Cette garde est appliquée :
 *   1. à l'URL reçue du content script (jamais digne de confiance) ;
 *   2. à l'URL FINALE après redirections HTTP (une redirection peut viser une IP privée) ;
 *   3. à chaque saut de redirection HTML (meta refresh, interstitiel).
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  const MAX_URL_LENGTH = 2048;

  /**
   * @param {string} raw
   * @returns {{ok: true, url: URL} | {ok: false, code: 'INVALID_URL' | 'INSECURE_URL' | 'BLOCKED_HOST'}}
   */
  function validate(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
      return { ok: false, code: 'INVALID_URL' };
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, code: 'INVALID_URL' };
    }
    // HTTPS uniquement : en HTTP, un attaquant réseau pourrait modifier le texte envoyé à l'IA.
    if (url.protocol === 'http:') return { ok: false, code: 'INSECURE_URL' };
    if (url.protocol !== 'https:') return { ok: false, code: 'INVALID_URL' };
    // Identifiants dans l'URL (https://user:pass@host) : refus net.
    if (url.username || url.password) return { ok: false, code: 'INVALID_URL' };
    // Port non standard : typique des services internes (admin, bases de données…).
    if (url.port !== '') return { ok: false, code: 'BLOCKED_HOST' };
    if (!AB.domain.isPublicHostname(url.hostname)) return { ok: false, code: 'BLOCKED_HOST' };
    url.hash = '';
    return { ok: true, url };
  }

  /** Variante qui lève une AppError (utilisée dans le pipeline). */
  function assertSafe(raw) {
    const result = validate(raw);
    if (!result.ok) throw new AB.AppError(result.code);
    return result.url;
  }

  AB.urlGuard = Object.freeze({ validate, assertSafe });
})(globalThis);
