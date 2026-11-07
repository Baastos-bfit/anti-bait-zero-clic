/**
 * Anti-Bait Zéro Clic — Infobulle (Tooltip UI)
 * =============================================
 * Composant d'affichage injecté dans la page hôte SANS interférer avec elle :
 *
 * [Isolation CSS]
 *   - Hôte = élément personnalisé <anti-bait-root> (nom inexistant côté site,
 *     donc aucune règle CSS du site ne le cible par nom de balise) ;
 *   - styles inline `all: initial !important` sur l'hôte : remet à zéro tout
 *     ce que le site pourrait hériter ou forcer ;
 *   - Shadow DOM FERMÉ : les feuilles de style du site ne traversent pas la
 *     frontière, et les scripts du site ne peuvent pas lire notre contenu ;
 *   - variables CSS redéfinies sur .card : une variable `--bg` du site ne
 *     « fuit » pas dans notre thème.
 *
 * [QA] Performance :
 *   - DOM créé UNE fois (paresseusement) puis réutilisé ;
 *   - le texte en streaming est regroupé par frame (requestAnimationFrame) :
 *     1 seule mise en page par frame même si l'IA envoie 50 jetons/s ;
 *   - positionnement par `transform` (pas de reflow de la page hôte) et
 *     `contain: layout paint style` sur la carte.
 * [SecOps] Tout texte (IA, domaine, erreurs) passe par textContent/appendData :
 *   aucune injection HTML possible, même si l'article contient du code piégé.
 */
(function (root) {
  'use strict';

  const NS = (root.AntiBaitContent = root.AntiBaitContent || {});
  if (NS.Tooltip) return;

  const GAP = 8; // espace entre le lien et la carte (px)
  const MARGIN = 8; // marge minimale avec les bords de la fenêtre (px)

  const STAGE_LABELS = {
    fetching: 'Lecture de l’article…',
    thinking: 'L’IA cherche la réponse…',
  };

  /** Styles de l'hôte : neutralise tout CSS hérité ou forcé par le site. */
  const HOST_STYLE = [
    'all: initial !important',
    'position: fixed !important',
    'top: 0 !important',
    'left: 0 !important',
    'width: 0 !important',
    'height: 0 !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: 0 !important',
    'display: block !important',
    'visibility: visible !important',
    'opacity: 1 !important',
    'transform: none !important',
    'filter: none !important',
    'z-index: 2147483647 !important',
    'pointer-events: none !important',
  ].join(';');

  /** Feuille de style interne au Shadow DOM. */
  const STYLE = `
    .card {
      --ab-bg: #ffffff;
      --ab-fg: #0f1419;
      --ab-muted: #536471;
      --ab-border: rgba(15, 20, 25, 0.12);
      --ab-accent: #e8452c;
      --ab-accent-fg: #ffffff;
      --ab-error-bg: #fff1ee;
      --ab-error-fg: #a1260f;
      position: fixed;
      top: 0;
      left: 0;
      box-sizing: border-box;
      width: max-content;
      min-width: 240px;
      max-width: min(380px, calc(100vw - 16px));
      max-height: min(60vh, 420px);
      overflow: auto;
      padding: 12px 14px 10px;
      border-radius: 14px;
      border: 1px solid var(--ab-border);
      background: var(--ab-bg);
      color: var(--ab-fg);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
      font: 400 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      text-align: left;
      direction: ltr;
      letter-spacing: normal;
      word-break: normal;
      overflow-wrap: anywhere;
      pointer-events: auto;
      contain: layout paint style;
      will-change: transform;
      animation: ab-in 120ms ease-out;
    }
    .card[hidden] { display: none; }
    @media (prefers-color-scheme: dark) {
      .card {
        --ab-bg: #16181c;
        --ab-fg: #e7e9ea;
        --ab-muted: #8b98a5;
        --ab-border: rgba(255, 255, 255, 0.14);
        --ab-error-bg: #3a1d17;
        --ab-error-fg: #ffb4a3;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
      }
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 6px;
      font-size: 12px;
      color: var(--ab-muted);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: var(--ab-accent);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ab-accent);
    }
    .domain {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close {
      all: unset;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      text-align: center;
      line-height: 22px;
      font-size: 16px;
      color: var(--ab-muted);
      cursor: pointer;
    }
    .close:hover, .close:focus-visible { background: var(--ab-border); color: var(--ab-fg); }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--ab-muted);
      font-size: 13px;
    }
    .status[hidden], .answer[hidden], .error[hidden], .footer[hidden], .action[hidden] { display: none; }
    .spinner {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid var(--ab-border);
      border-top-color: var(--ab-accent);
      animation: ab-spin 700ms linear infinite;
    }
    .answer {
      margin: 0;
      font-size: 15px;
      font-weight: 500;
      white-space: pre-wrap;
    }
    .answer.streaming::after {
      content: "▍";
      margin-left: 1px;
      color: var(--ab-accent);
      animation: ab-blink 900ms steps(1) infinite;
    }
    .error {
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--ab-error-bg);
      color: var(--ab-error-fg);
      font-size: 13px;
    }
    .error p { margin: 0; }
    .action {
      all: unset;
      display: inline-block;
      margin-top: 8px;
      padding: 5px 12px;
      border-radius: 999px;
      background: var(--ab-accent);
      color: var(--ab-accent-fg);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .action:hover { filter: brightness(1.08); }
    .action:focus-visible { outline: 2px solid var(--ab-fg); outline-offset: 2px; }
    .footer {
      margin-top: 8px;
      font-size: 11px;
      color: var(--ab-muted);
    }
    @keyframes ab-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ab-spin { to { transform: rotate(360deg); } }
    @keyframes ab-blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .card, .spinner, .answer.streaming::after { animation: none; }
    }
  `;

  /** Petit utilitaire de création d'élément avec classe. */
  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  class Tooltip {
    /**
     * @param {object} callbacks
     * @param {() => void} callbacks.onPointerEnter
     * @param {() => void} callbacks.onPointerLeave
     * @param {() => void} callbacks.onClose
     * @param {() => void} callbacks.onAnchorLost  Lien sorti de l'écran ou retiré du DOM.
     */
    constructor(callbacks) {
      this.cb = callbacks;
      this.host = null;
      this.anchor = null;
      this.visible = false;
      this.pendingText = '';
      this.flushRaf = 0;
      this.positionRaf = 0;
      this.ui = null;
      this.destroyed = false;
    }

    // ── API publique ──────────────────────────────────────────────────────

    /** Affiche l'infobulle (état « chargement ») près du lien. */
    show(anchor, { domain }) {
      if (this.destroyed) return;
      this._ensureDom();
      this.anchor = anchor;
      this._resetContent();
      this.ui.domain.textContent = domain || '';
      this.setStatus('fetching');
      this.ui.card.hidden = false;
      this.visible = true;
      this.scheduleReposition();
    }

    /** Étape intermédiaire (« fetching » → « thinking »). */
    setStatus(stage) {
      if (!this.visible) return;
      const label = STAGE_LABELS[stage];
      if (!label || this.ui.textNode.length > 0) return; // le texte a déjà commencé
      this.ui.statusLabel.textContent = label;
      this.ui.status.hidden = false;
    }

    /** Ajoute un fragment de réponse (regroupé par frame). */
    appendText(chunk) {
      if (!this.visible || !chunk) return;
      this.pendingText += chunk;
      if (!this.flushRaf) this.flushRaf = requestAnimationFrame(() => this._flush());
    }

    /** Efface la réponse partielle (repli serveur de l'IA). */
    resetText() {
      if (!this.visible) return;
      this.pendingText = '';
      this.ui.textNode.data = '';
      this.ui.answer.hidden = true;
    }

    /**
     * État final.
     * @param {{text?: string, cached?: boolean, quota?: {premium: boolean, remaining: number}}} p
     */
    setFinal({ text, cached, quota } = {}) {
      if (!this.visible) return;
      this._flush();
      if (typeof text === 'string') this.ui.textNode.data = text;
      if (this.ui.textNode.length === 0) {
        this.setError({ message: 'Aucune réponse obtenue pour ce lien.' });
        return;
      }
      this.ui.status.hidden = true;
      this.ui.answer.hidden = false;
      this.ui.answer.classList.remove('streaming');
      let footer = '';
      if (cached) footer = 'Réponse instantanée (déjà analysée)';
      else if (quota && !quota.premium && Number.isFinite(quota.remaining)) {
        footer = `${quota.remaining} analyse${quota.remaining > 1 ? 's' : ''} gratuite${quota.remaining > 1 ? 's' : ''} restante${quota.remaining > 1 ? 's' : ''} aujourd’hui`;
      }
      this.ui.footer.textContent = footer;
      this.ui.footer.hidden = !footer;
      this.scheduleReposition();
    }

    /** Affiche une erreur, avec un bouton d'action optionnel. */
    setError({ message, actionLabel, onAction }) {
      if (!this.visible) return;
      this._cancelFlush();
      this.ui.status.hidden = true;
      this.ui.answer.hidden = true;
      this.ui.footer.hidden = true;
      this.ui.errorMsg.textContent = message;
      this.ui.error.hidden = false;
      this.onAction = typeof onAction === 'function' ? onAction : null;
      this.ui.action.textContent = actionLabel || '';
      this.ui.action.hidden = !(actionLabel && this.onAction);
      this.scheduleReposition();
    }

    /** Masque l'infobulle (le DOM est conservé pour réutilisation). */
    hide() {
      this.visible = false;
      this.anchor = null;
      this._cancelFlush();
      if (this.positionRaf) cancelAnimationFrame(this.positionRaf);
      this.positionRaf = 0;
      if (this.ui) {
        this.ui.card.hidden = true;
        this._resetContent();
      }
    }

    /** Repositionnement limité à une fois par frame (scroll, resize, contenu). */
    scheduleReposition() {
      if (!this.visible || this.positionRaf) return;
      this.positionRaf = requestAnimationFrame(() => {
        this.positionRaf = 0;
        this._position();
      });
    }

    /** Retire complètement le composant de la page. */
    destroy() {
      this.hide();
      this.destroyed = true;
      if (this.host) this.host.remove();
      this.host = null;
      this.ui = null;
    }

    // ── Interne ───────────────────────────────────────────────────────────

    _ensureDom() {
      if (this.host) {
        // Les SPA peuvent réécrire <html> : on se réattache si besoin.
        if (!this.host.isConnected) document.documentElement.appendChild(this.host);
        return;
      }
      const host = document.createElement('anti-bait-root');
      host.setAttribute('style', HOST_STYLE);
      const shadow = host.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = STYLE;
      shadow.appendChild(style);

      const card = el('div', 'card');
      card.hidden = true;
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Anti-Bait : réponse au titre');

      const header = el('div', 'header');
      const brand = el('span', 'brand');
      brand.append(el('span', 'dot'), document.createTextNode('Anti-Bait'));
      const domain = el('span', 'domain');
      const close = el('button', 'close');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Fermer');
      header.append(brand, domain, close);

      const status = el('div', 'status');
      status.setAttribute('role', 'status');
      const statusLabel = el('span');
      status.append(el('span', 'spinner'), statusLabel);

      const answer = el('p', 'answer');
      answer.setAttribute('aria-live', 'polite');
      const textNode = document.createTextNode('');
      answer.appendChild(textNode);

      const error = el('div', 'error');
      error.setAttribute('role', 'alert');
      const errorMsg = el('p');
      const action = el('button', 'action');
      action.type = 'button';
      error.append(errorMsg, action);

      const footer = el('div', 'footer');

      card.append(header, status, answer, error, footer);
      shadow.appendChild(card);

      card.addEventListener('pointerenter', () => this.cb.onPointerEnter());
      card.addEventListener('pointerleave', () => this.cb.onPointerLeave());
      close.addEventListener('click', () => this.cb.onClose());
      action.addEventListener('click', () => {
        if (this.onAction) this.onAction();
        this.cb.onClose();
      });

      this.host = host;
      this.ui = { card, domain, status, statusLabel, answer, textNode, error, errorMsg, action, footer };
      document.documentElement.appendChild(host);
    }

    _resetContent() {
      this.pendingText = '';
      this.onAction = null;
      const ui = this.ui;
      // Aucun texte périmé ne reste dans le DOM une fois l'infobulle masquée.
      ui.textNode.data = '';
      ui.answer.hidden = true;
      ui.answer.classList.remove('streaming');
      ui.status.hidden = true;
      ui.error.hidden = true;
      ui.errorMsg.textContent = '';
      ui.action.textContent = '';
      ui.action.hidden = true;
      ui.domain.textContent = '';
      ui.footer.hidden = true;
      ui.footer.textContent = '';
      ui.card.style.transform = 'translate(-9999px, -9999px)'; // hors écran avant 1er positionnement
    }

    _flush() {
      this._cancelFlush();
      if (!this.visible || !this.pendingText) return;
      const ui = this.ui;
      ui.textNode.appendData(this.pendingText);
      this.pendingText = '';
      ui.status.hidden = true;
      ui.error.hidden = true;
      ui.answer.hidden = false;
      ui.answer.classList.add('streaming');
      this.scheduleReposition();
    }

    _cancelFlush() {
      if (this.flushRaf) cancelAnimationFrame(this.flushRaf);
      this.flushRaf = 0;
    }

    _position() {
      if (!this.visible || !this.anchor) return;
      const anchor = this.anchor;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const rect = anchor.getBoundingClientRect();

      // Ancre retirée du DOM (SPA) ou sortie de l'écran : on ferme.
      const gone = !anchor.isConnected || (rect.width === 0 && rect.height === 0);
      if (gone || rect.bottom < 0 || rect.top > vh) {
        this.cb.onAnchorLost();
        return;
      }

      const card = this.ui.card;
      const w = card.offsetWidth;
      const h = card.offsetHeight;

      // Sous le lien par défaut ; au-dessus s'il n'y a pas la place.
      let top = rect.bottom + GAP;
      if (top + h > vh - MARGIN && rect.top - GAP - h >= MARGIN) top = rect.top - GAP - h;
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - h - MARGIN));
      const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, vw - w - MARGIN));

      card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
  }

  NS.Tooltip = Tooltip;
})(globalThis);
