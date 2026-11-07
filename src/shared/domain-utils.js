/**
 * Anti-Bait Zéro Clic — Utilitaires de domaines (partagés)
 * =========================================================
 * Chargé dans TROIS contextes différents, d'où le format « script classique »
 * qui s'attache à `globalThis.AntiBait` (pas de module ES) :
 *   1. le service worker (via importScripts),
 *   2. les content scripts (déclarés avant content-script.js),
 *   3. la page d'options (balise <script> classique).
 *
 * Contenu : fonctions PURES (aucun appel chrome.*, aucun accès DOM), donc
 * testables dans Node et sans effet de bord.
 *
 * [SecOps] Ces fonctions sont la première ligne de défense contre les liens
 * piégés (adresses IP privées, localhost, intranet). Le service worker les
 * réapplique systématiquement : on ne fait JAMAIS confiance au content script.
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});
  // Garde anti double-injection : si le fichier est déjà chargé, on ne fait rien.
  if (AB.domain) return;

  /** IPv4 littérale (ex. 192.168.1.1). Les IPv6 littérales commencent par « [ ». */
  const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  /**
   * Nom d'hôte public valide : au moins deux labels, TLD alphabétique (ou punycode).
   * L'API URL convertit déjà les domaines internationaux en punycode (xn--).
   */
  const HOSTNAME_RE =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;

  /** Suffixes réservés aux réseaux locaux : jamais de requête vers eux. */
  const PRIVATE_SUFFIXES = [
    '.local', '.localhost', '.internal', '.intranet', '.lan', '.home', '.corp', '.arpa', '.test', '.invalid',
  ];

  /**
   * Plateformes sociales : leurs liens internes (profils, posts, vidéos) ne sont
   * pas des articles. Les raccourcisseurs t.co et lnkd.in N'Y FIGURENT PAS :
   * ce sont justement les liens sortants vers les articles.
   */
  const SOCIAL_DOMAINS = [
    'x.com', 'twitter.com', 'linkedin.com', 'facebook.com', 'fb.com', 'instagram.com',
    'youtube.com', 'youtu.be', 'tiktok.com', 'threads.net', 'bsky.app', 'reddit.com',
    'whatsapp.com', 'discord.com', 'discord.gg', 'spotify.com', 'twitch.tv',
  ];

  /** Domaines où le content script est déjà injecté statiquement (manifest). */
  const BUILTIN_DOMAINS = ['x.com', 'twitter.com', 'linkedin.com'];

  /** Vrai si `host` est `domain` ou l'un de ses sous-domaines. */
  function hostMatches(host, domain) {
    return host === domain || host.endsWith('.' + domain);
  }

  /** Retire un éventuel « www. » et le point final (FQDN). */
  function bareHost(host) {
    return String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  }

  /**
   * Vrai si le nom d'hôte est un domaine public « normal ».
   * Refuse : IP littérales (v4/v6), localhost, suffixes privés, noms à un seul label.
   */
  function isPublicHostname(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!h || h.startsWith('[') || h.includes(':')) return false; // IPv6 littérale
    if (IPV4_RE.test(h)) return false;
    if (h === 'localhost') return false;
    if (PRIVATE_SUFFIXES.some((s) => h.endsWith(s))) return false;
    return HOSTNAME_RE.test(h);
  }

  /**
   * Normalise une saisie utilisateur (« https://www.LeMonde.fr/xyz ») en domaine
   * nu (« lemonde.fr »). Retourne null si la saisie est invalide ou non publique.
   */
  function normalizeDomain(input) {
    let s = String(input || '').trim().toLowerCase();
    if (!s || s.length > 300) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
    let url;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = bareHost(url.hostname);
    return isPublicHostname(host) ? host : null;
  }

  /** Vrai si l'hôte appartient à une plateforme sociale connue. */
  function isSocialHost(host) {
    const h = bareHost(host);
    return SOCIAL_DOMAINS.some((d) => hostMatches(h, d));
  }

  /** Vrai si l'hôte est couvert par l'injection statique du manifest. */
  function isBuiltinHost(host) {
    const h = bareHost(host);
    return BUILTIN_DOMAINS.some((d) => hostMatches(h, d));
  }

  /**
   * Approximation « même site » sans Public Suffix List : deux hôtes sont du
   * même site si l'un est sous-domaine de l'autre (www./m./amp. compris).
   */
  function isSameSite(hostA, hostB) {
    const a = bareHost(hostA);
    const b = bareHost(hostB);
    return hostMatches(a, b) || hostMatches(b, a);
  }

  /**
   * Déballe les redirecteurs connus pour retrouver la vraie destination :
   *   - LinkedIn : https://www.linkedin.com/redir/redirect?url=...
   *                https://www.linkedin.com/safety/go?url=...   (pages publiques, visiteurs non connectés)
   *   - Facebook : https://l.facebook.com/l.php?u=...
   *   - Google   : https://www.google.com/url?q=...
   * Un seul niveau de déballage (pas de boucle infinie possible).
   * @param {URL} url
   * @returns {URL} la destination réelle, ou l'URL d'origine.
   */
  function unwrapRedirector(url) {
    const host = bareHost(url.hostname);
    let param = null;
    if (hostMatches(host, 'linkedin.com') && (url.pathname.startsWith('/redir/') || url.pathname.startsWith('/safety/go'))) {
      param = url.searchParams.get('url');
    } else if (host === 'l.facebook.com' || host === 'lm.facebook.com') {
      param = url.searchParams.get('u');
    } else if (/^google\.[a-z.]+$/.test(host) && url.pathname === '/url') {
      param = url.searchParams.get('q') || url.searchParams.get('url');
    }
    if (!param) return url;
    try {
      const inner = new URL(param);
      return inner.protocol === 'https:' || inner.protocol === 'http:' ? inner : url;
    } catch {
      return url;
    }
  }

  AB.domain = Object.freeze({
    SOCIAL_DOMAINS,
    BUILTIN_DOMAINS,
    hostMatches,
    bareHost,
    isPublicHostname,
    normalizeDomain,
    isSocialHost,
    isBuiltinHost,
    isSameSite,
    unwrapRedirector,
  });
})(globalThis);
