/**
 * Anti-Bait Zéro Clic — Extracteur d'article (sans DOM)
 * ======================================================
 * Un service worker MV3 n'a pas de DOMParser. Plutôt que d'ouvrir un document
 * « offscreen » (coûteux en RAM et en latence), on extrait le texte avec des
 * expressions régulières ciblées, dans cet ordre de fiabilité :
 *
 *   1. JSON-LD `articleBody` (schema.org NewsArticle/Article/BlogPosting) :
 *      présent sur la grande majorité des sites de presse, texte intégral propre ;
 *   2. paragraphes <p> de la zone <article> (ou <main>, sinon la page) après
 *      suppression du bruit (scripts, styles, menus, pieds de page, formulaires) ;
 *   3. à défaut, la meta description (og:description).
 *
 * Gère aussi les pages de redirection HTML :
 *   - <meta http-equiv="refresh" content="0;URL=...">  (t.co pour les navigateurs)
 *   - location.replace("...")                          (t.co)
 *   - interstitiel lnkd.in « Ce lien vous emmène hors de LinkedIn ».
 *
 * [QA] Toutes les regex sont linéaires (pas d'imbrication de quantificateurs)
 * et travaillent sur un HTML déjà plafonné à 2 Mo par le scraper.
 * Fonctions PURES : testées sous Node (tests/html-extractor.test.mjs).
 */
(function (root) {
  'use strict';

  const AB = (root.AntiBait = root.AntiBait || {});

  /** Entités nommées courantes (le reste est presque toujours en UTF-8 brut). */
  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
    hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', euro: '€', pound: '£', copy: '©', reg: '®',
    trade: '™', deg: '°', middot: '·', bull: '•', times: '×', thinsp: ' ', ensp: ' ',
    emsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', aacute: 'á',
    acirc: 'â', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï', iacute: 'í', ocirc: 'ô', ouml: 'ö',
    oacute: 'ó', ugrave: 'ù', ucirc: 'û', uuml: 'ü', uacute: 'ú', ntilde: 'ñ', oelig: 'œ', aelig: 'æ',
    szlig: 'ß', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Ccedil: 'Ç',
    Ocirc: 'Ô', Icirc: 'Î', Ucirc: 'Û', OElig: 'Œ', AElig: 'Æ',
  };

  function decodeEntities(s) {
    return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (match, ent) => {
      if (ent[0] === '#') {
        const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
        return valid ? String.fromCodePoint(cp) : '';
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : match;
    });
  }

  /** Fragment HTML → texte brut sur une ligne. */
  function cleanText(fragment) {
    return decodeEntities(
      String(fragment)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
    )
      .replace(/[\s ]+/g, ' ')
      .trim();
  }

  /** Valeur d'un attribut dans le texte d'une balise ouvrante. */
  function getAttr(tag, name) {
    const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
    const m = re.exec(tag);
    return m ? m[1] ?? m[2] ?? m[3] ?? '' : null;
  }

  /** En-tête du document (meta, title) — borné pour la performance. */
  function headOf(html) {
    const end = html.search(/<\/head\s*>/i);
    return end === -1 ? html.slice(0, 200000) : html.slice(0, end);
  }

  /** Toutes les balises <meta> du <head> : clé (property/name/http-equiv) → content. */
  function readMetas(head) {
    const metas = {};
    const re = /<meta\b[^>]*>/gi;
    let m;
    while ((m = re.exec(head))) {
      const tag = m[0];
      const key = (getAttr(tag, 'property') || getAttr(tag, 'name') || getAttr(tag, 'http-equiv') || '').toLowerCase();
      const content = getAttr(tag, 'content');
      if (key && content !== null && !(key in metas)) metas[key] = content;
    }
    return metas;
  }

  /** Jeu de caractères déclaré dans le HTML (<meta charset> ou http-equiv). */
  function sniffCharset(headSample) {
    const m =
      /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)/i.exec(headSample);
    return m ? m[1].toLowerCase() : null;
  }

  // ── JSON-LD ─────────────────────────────────────────────────────────────

  const ARTICLE_TYPE_RE = /(Article|BlogPosting|Report|NewsArticle|LiveBlogPosting)$/i;

  function readJsonLd(html) {
    const best = { body: '', headline: '' };
    const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
      let data;
      try {
        data = JSON.parse(m[1].trim());
      } catch {
        continue; // JSON-LD malformé : fréquent, on ignore ce bloc
      }
      walkJsonLd(data, best, 0);
    }
    return best;
  }

  function walkJsonLd(node, best, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walkJsonLd(item, best, depth + 1);
      return;
    }
    const types = [].concat(node['@type'] || []).map(String);
    if (types.some((t) => ARTICLE_TYPE_RE.test(t))) {
      const body = typeof node.articleBody === 'string' ? cleanText(node.articleBody) : '';
      if (body.length > best.body.length) best.body = body;
      if (!best.headline && typeof node.headline === 'string') best.headline = cleanText(node.headline);
    }
    if (node['@graph']) walkJsonLd(node['@graph'], best, depth + 1);
    if (node.mainEntity) walkJsonLd(node.mainEntity, best, depth + 1);
  }

  // ── Paragraphes ─────────────────────────────────────────────────────────

  /** Supprime commentaires et blocs non éditoriaux. */
  function stripNoise(html) {
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<(script|style|noscript|svg|template|iframe|form|nav|footer|aside|button|select|figure|figcaption)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        ' '
      );
  }

  /** Zone éditoriale : l'<article> le plus riche en <p>, sinon <main>, sinon la page. */
  function pickRegion(html) {
    let best = null;
    let bestCount = 0;
    const re = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const count = (m[1].match(/<p\b/gi) || []).length;
      if (count > bestCount) {
        best = m[1];
        bestCount = count;
      }
    }
    if (best) return best;
    const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html);
    return main ? main[1] : html;
  }

  function readParagraphs(html) {
    const region = pickRegion(stripNoise(html));
    const seen = new Set();
    const out = [];
    const re = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
    let m;
    while ((m = re.exec(region))) {
      const text = cleanText(m[1]);
      if (text.length < 40 || seen.has(text)) continue; // légendes, crédits, doublons
      seen.add(text);
      out.push(text);
    }
    return out.join('\n');
  }

  // ── Redirections HTML ───────────────────────────────────────────────────

  function findRedirect(html, metas) {
    const refresh = metas['refresh'];
    if (refresh) {
      const m = /url\s*=\s*['"]?([^'";\s]+)/i.exec(refresh);
      if (m) return decodeEntities(m[1]);
    }
    const js = /location\.replace\(\s*["']([^"']+)["']\s*\)/.exec(html);
    if (js) return js[1].replace(/\\\//g, '/');
    // Interstitiel lnkd.in : lien sortant marqué « external_url_click ».
    const lnkd = /<a\b[^>]*data-tracking-control-name\s*=\s*["']external_url_click["'][^>]*>/i.exec(html);
    if (lnkd) {
      const href = getAttr(lnkd[0], 'href');
      if (href) return decodeEntities(href);
    }
    return null;
  }

  // ── Assemblage ──────────────────────────────────────────────────────────

  /** Coupe proprement en fin de phrase quand c'est possible. */
  function truncate(text, max) {
    if (text.length <= max) return text;
    const slice = text.slice(0, max);
    const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
    return (cut > max * 0.7 ? slice.slice(0, cut + 1) : slice) + ' […]';
  }

  /**
   * @param {string} html
   * @param {{maxChars: number, minChars: number}} limits
   * @returns {{title: string, description: string, text: string, source: string, redirectUrl: string|null}}
   */
  function extractArticle(html, { maxChars, minChars }) {
    const head = headOf(html);
    const metas = readMetas(head);
    const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
    const ld = readJsonLd(html);

    const title = cleanText(metas['og:title'] || metas['twitter:title'] || ld.headline || (titleTag ? titleTag[1] : '')).slice(0, 300);
    const description = cleanText(metas['og:description'] || metas['description'] || metas['twitter:description'] || '').slice(0, 600);

    let text = '';
    let source = 'none';
    if (ld.body.length >= minChars) {
      text = ld.body;
      source = 'jsonld';
    } else {
      const paragraphs = readParagraphs(html);
      if (paragraphs.length >= minChars || paragraphs.length > ld.body.length) {
        text = paragraphs;
        source = 'paragraphs';
      } else if (ld.body) {
        text = ld.body;
        source = 'jsonld';
      }
    }
    if (text.length < minChars && description.length > text.length) {
      text = description;
      source = 'meta';
    }

    // Une page quasi vide qui redirige (t.co, lnkd.in) : on suivra la redirection.
    const redirectUrl = text.length < minChars ? findRedirect(html, metas) : null;

    return { title, description, text: truncate(text, maxChars), source, redirectUrl };
  }

  AB.extractor = Object.freeze({ decodeEntities, cleanText, sniffCharset, extractArticle, truncate });
})(globalThis);
