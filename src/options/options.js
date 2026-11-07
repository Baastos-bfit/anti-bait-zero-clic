/**
 * Anti-Bait Zéro Clic — Logique de la page de réglages
 * =====================================================
 * Cette page ne détient AUCUN secret :
 *   - la clé API saisie est transmise une seule fois au service worker (qui la
 *     chiffre), puis le champ est vidé ; elle n'est jamais relue ;
 *   - le statut Premium et le quota sont lus auprès du service worker.
 *
 * [SecOps] Les demandes de permission (chrome.permissions.request) sont
 * appelées DIRECTEMENT dans le gestionnaire de clic, avant tout `await` :
 * Chrome exige un geste utilisateur, ce qui empêche toute élévation de
 * privilèges silencieuse.
 * [QA] Tout l'affichage passe par textContent (pas d'innerHTML), et la page se
 * met à jour seule si un réglage change ailleurs (chrome.storage.onChanged).
 */

const D = globalThis.AntiBait.domain;
const BROAD_ORIGIN = 'https://*/*';

const $ = (id) => document.getElementById(id);
let state = null;

// ── Communication avec le service worker ─────────────────────────────────

/** Envoie une action au service worker ; lève une Error avec le message utilisateur. */
async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error('Le service de l’extension ne répond pas. Rechargez la page.');
  if (!res.ok) throw new Error((res.error && res.error.message) || 'Erreur inattendue.');
  return res.data;
}

/** Affiche un retour (succès/erreur) sous une section. */
function feedback(id, message, kind = 'ok') {
  const el = $(id);
  el.textContent = message;
  el.className = `feedback ${kind}`;
}

/** Désactive un bouton pendant une action asynchrone (évite les doubles clics). */
async function busy(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
}

// ── Rendu ─────────────────────────────────────────────────────────────────

function renderProviders() {
  const select = $('provider');
  if (select.options.length === 0) {
    for (const [id, p] of Object.entries(state.providers)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.label;
      select.appendChild(opt);
    }
  }
  select.value = state.settings.provider;
  renderModels();
}

function renderModels() {
  const provider = $('provider').value;
  const p = state.providers[provider];
  const list = $('model-list');
  list.replaceChildren(
    ...p.models.map((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      return opt;
    })
  );
  if (document.activeElement !== $('model')) {
    $('model').value = provider === state.settings.provider ? state.settings.model : p.defaultModel;
  }
  $('model-hint').textContent =
    provider === 'anthropic'
      ? 'Par défaut : claude-opus-5-5 (le plus fiable). claude-haiku-5-5 répond plus vite et coûte moins cher.'
      : 'Par défaut : gpt-4.1-mini. Vous pouvez saisir tout autre modèle de chat disponible sur votre compte.';
  $('api-key').placeholder = `${p.keyPrefix}…`;

  const hint = state.keys[provider];
  $('key-state').textContent = hint ? `Clé enregistrée : ${hint}` : 'Aucune clé enregistrée pour ce fournisseur.';
  $('test-key').disabled = !hint;
  $('delete-key').disabled = !hint;
}

function renderAccess() {
  const badge = $('access-badge');
  if (state.access.broad) {
    badge.textContent = 'Autorisé';
    badge.className = 'badge ok';
  } else {
    badge.textContent = 'Non autorisé — Anti-Bait ne peut pas lire les articles';
    badge.className = 'badge warn';
  }
  $('grant-access').hidden = state.access.broad;
  $('revoke-access').hidden = !state.access.broad;
}

function renderMedia() {
  const list = $('media-list');
  if (state.mediaDomains.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucun site ajouté.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...state.mediaDomains.map(({ domain, granted }) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'domain';
      name.textContent = domain;
      const badge = document.createElement('span');
      badge.className = granted ? 'badge ok' : 'badge warn';
      badge.textContent = granted ? 'Actif' : 'Permission retirée';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Retirer';
      remove.addEventListener('click', () =>
        busy(remove, async () => {
          try {
            await send('removeMediaDomain', { domain });
            feedback('media-feedback', `${domain} retiré.`);
            await refresh();
          } catch (err) {
            feedback('media-feedback', err.message, 'error');
          }
        })
      );
      li.append(name, badge, remove);
      return li;
    })
  );
}

function renderBehavior() {
  $('enabled').checked = state.settings.enabled;
  $('delay').value = String(state.settings.hoverDelayMs);
  $('delay-value').textContent = `${(state.settings.hoverDelayMs / 1000).toFixed(1)} s`;
}

function renderPremium() {
  const p = state.premium;
  const status = $('premium-status');
  if (p.premium) {
    status.textContent = '★ Premium actif : analyses illimitées. Merci pour votre soutien !';
    $('quota-bar').style.width = '100%';
  } else {
    status.textContent = `Version gratuite : ${p.used} / ${p.limit} analyses utilisées aujourd’hui.`;
    $('quota-bar').style.width = `${Math.min(100, (p.used / p.limit) * 100)}%`;
  }
  $('upgrade').hidden = p.premium;
  $('login').hidden = p.premium;
}

function render() {
  renderProviders();
  renderAccess();
  renderMedia();
  renderBehavior();
  renderPremium();
}

async function refresh() {
  try {
    state = await send('getState');
    render();
  } catch (err) {
    feedback('api-feedback', err.message, 'error');
  }
}

// ── Actions : fournisseur, modèle, clé ────────────────────────────────────

$('provider').addEventListener('change', async () => {
  const provider = $('provider').value;
  try {
    state.settings = await send('saveSettings', {
      settings: { provider, model: state.providers[provider].defaultModel },
    });
    renderModels();
    feedback('api-feedback', `Fournisseur : ${state.providers[provider].label}.`);
  } catch (err) {
    feedback('api-feedback', err.message, 'error');
  }
});

$('model').addEventListener('change', async () => {
  try {
    state.settings = await send('saveSettings', { settings: { model: $('model').value } });
    $('model').value = state.settings.model;
    feedback('api-feedback', `Modèle : ${state.settings.model}.`);
  } catch (err) {
    feedback('api-feedback', err.message, 'error');
  }
});

$('save-key').addEventListener('click', () =>
  busy($('save-key'), async () => {
    const input = $('api-key');
    const key = input.value.trim();
    if (!key) {
      feedback('api-feedback', 'Collez d’abord votre clé API.', 'error');
      return;
    }
    const provider = $('provider').value;
    try {
      const { hint } = await send('saveApiKey', { provider, key });
      input.value = ''; // la clé ne reste pas dans la page
      state.keys[provider] = hint;
      renderModels();
      feedback('api-feedback', 'Clé chiffrée et enregistrée. Cliquez sur « Tester la clé » pour la vérifier.');
    } catch (err) {
      feedback('api-feedback', err.message, 'error');
    }
  })
);

$('api-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('save-key').click();
});

$('test-key').addEventListener('click', () =>
  busy($('test-key'), async () => {
    feedback('api-feedback', 'Vérification en cours…');
    try {
      await send('testApiKey', { provider: $('provider').value });
      feedback('api-feedback', 'Clé valide et modèle disponible. Anti-Bait est prêt.');
    } catch (err) {
      feedback('api-feedback', err.message, 'error');
    }
  })
);

$('delete-key').addEventListener('click', () =>
  busy($('delete-key'), async () => {
    const provider = $('provider').value;
    try {
      await send('deleteApiKey', { provider });
      state.keys[provider] = null;
      renderModels();
      feedback('api-feedback', 'Clé supprimée.');
    } catch (err) {
      feedback('api-feedback', err.message, 'error');
    }
  })
);

// ── Actions : accès aux articles ──────────────────────────────────────────

$('grant-access').addEventListener('click', async () => {
  let granted = false;
  try {
    // Appel IMMÉDIAT dans le geste utilisateur (exigence de Chrome).
    granted = await chrome.permissions.request({ origins: [BROAD_ORIGIN] });
  } catch (err) {
    feedback('access-feedback', err.message, 'error');
    return;
  }
  feedback(
    'access-feedback',
    granted ? 'Autorisation accordée. Survolez un lien sur X ou LinkedIn !' : 'Autorisation refusée.',
    granted ? 'ok' : 'error'
  );
  await refresh();
});

$('revoke-access').addEventListener('click', async () => {
  try {
    await chrome.permissions.remove({ origins: [BROAD_ORIGIN] });
    feedback('access-feedback', 'Autorisation retirée.');
  } catch (err) {
    feedback('access-feedback', err.message, 'error');
  }
  await refresh();
});

// ── Actions : sites de médias ─────────────────────────────────────────────

$('media-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = D.normalizeDomain($('media-input').value);
  if (!domain) {
    feedback('media-feedback', 'Nom de domaine invalide (ex. lemonde.fr).', 'error');
    return;
  }
  if (D.isBuiltinHost(domain)) {
    feedback('media-feedback', 'Ce site est déjà pris en charge.', 'error');
    return;
  }
  let granted = false;
  try {
    // Appel IMMÉDIAT dans le geste utilisateur (exigence de Chrome).
    granted = await chrome.permissions.request({ origins: [`https://${domain}/*`, `https://*.${domain}/*`] });
  } catch (err) {
    feedback('media-feedback', err.message, 'error');
    return;
  }
  if (!granted) {
    feedback('media-feedback', 'Permission refusée : site non ajouté.', 'error');
    return;
  }
  try {
    await send('addMediaDomain', { domain });
    $('media-input').value = '';
    feedback('media-feedback', `${domain} ajouté. Rechargez ses onglets ouverts pour l’activer.`);
    await refresh();
  } catch (err) {
    feedback('media-feedback', err.message, 'error');
  }
});

// ── Actions : comportement ────────────────────────────────────────────────

$('enabled').addEventListener('change', async () => {
  try {
    state.settings = await send('saveSettings', { settings: { enabled: $('enabled').checked } });
    feedback('behavior-feedback', state.settings.enabled ? 'Anti-Bait activé.' : 'Anti-Bait désactivé.');
  } catch (err) {
    feedback('behavior-feedback', err.message, 'error');
  }
});

$('delay').addEventListener('input', () => {
  $('delay-value').textContent = `${(Number($('delay').value) / 1000).toFixed(1)} s`;
});

$('delay').addEventListener('change', async () => {
  try {
    state.settings = await send('saveSettings', { settings: { hoverDelayMs: Number($('delay').value) } });
    feedback('behavior-feedback', 'Délai enregistré.');
  } catch (err) {
    feedback('behavior-feedback', err.message, 'error');
  }
});

// ── Actions : Premium ─────────────────────────────────────────────────────

$('upgrade').addEventListener('click', () =>
  busy($('upgrade'), async () => {
    try {
      await send('openPayment');
    } catch (err) {
      feedback('premium-feedback', err.message, 'error');
    }
  })
);

$('login').addEventListener('click', () =>
  busy($('login'), async () => {
    try {
      await send('openLogin');
    } catch (err) {
      feedback('premium-feedback', err.message, 'error');
    }
  })
);

$('refresh-premium').addEventListener('click', () =>
  busy($('refresh-premium'), async () => {
    try {
      state.premium = await send('refreshPremium');
      renderPremium();
      feedback('premium-feedback', 'Statut actualisé.');
    } catch (err) {
      feedback('premium-feedback', err.message, 'error');
    }
  })
);

// ── Synchronisation automatique ───────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.mediaDomains || changes.quota || changes.premiumLastKnown)) {
    refresh();
  }
});
chrome.permissions.onAdded.addListener(refresh);
chrome.permissions.onRemoved.addListener(refresh);
// Retour sur l'onglet (ex. après paiement) : statut à jour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

refresh();
