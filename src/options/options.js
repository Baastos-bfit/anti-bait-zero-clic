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
  if (!res.ok) {
    const err = new Error((res.error && res.error.message) || 'Erreur inattendue.');
    err.code = res.error && res.error.code; // ex. PREMIUM_REQUIRED (v2)
    throw err;
  }
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

// ── v2 : réponses de l'IA (langue, format par défaut) ─────────────────────

const LANGUAGE_FEEDBACK = {
  browser: 'Les réponses suivront la langue de votre navigateur.',
  fr: 'Les réponses seront toujours en français, y compris pour les articles étrangers.',
  article: 'Les réponses garderont la langue d’origine de l’article.',
};
const PREMIUM_FORMAT_NOTICE = '🔒 Le format Puces est réservé à la version Premium (3,99 €, paiement unique).';

/**
 * [SecOps] Affichage uniquement : le statut Premium vient du service worker,
 * qui refuse de toute façon d'enregistrer « Puces » pour un compte gratuit.
 */
function renderAnswers() {
  const premium = state.premium.premium;
  const { language, format } = state.settings;
  for (const radio of document.querySelectorAll('input[name="language"]')) radio.checked = radio.value === language;
  // Un compte gratuit voit toujours le format réellement appliqué : « Une phrase ».
  const effective = premium ? format : 'sentence';
  for (const radio of document.querySelectorAll('input[name="format"]')) radio.checked = radio.value === effective;
  $('bullets-badge').hidden = premium;
  $('format-bullets-choice').classList.toggle('locked', !premium);
  $('format-bullets-choice').title = premium ? '' : 'Réservé à la version Premium';
  if (premium) $('answers-upgrade').hidden = true;
}

function showFormatLocked() {
  renderAnswers(); // la sélection revient sur « Une phrase »
  feedback('answers-feedback', PREMIUM_FORMAT_NOTICE, 'premium');
  $('answers-upgrade').hidden = false;
}

// ── v2 : statistiques ─────────────────────────────────────────────────────

/** Carte « Vos statistiques » : chiffres (Premium) ou état verrouillé (gratuit). */
function renderStats() {
  const s = state.stats || { locked: true };
  const locked = s.locked !== false;
  $('stats-locked').hidden = !locked;
  $('stats-unlocked').hidden = locked;
  if (locked) return;
  $('stats-time').textContent = s.timeSavedLabel;
  $('stats-clicks').textContent = new Intl.NumberFormat('fr-FR').format(s.clicksAvoided);
  $('stats-clicks-label').textContent = s.clicksAvoided > 1 ? 'clics évités' : 'clic évité';
  $('stats-since').textContent =
    `Depuis le ${s.sinceLabel} · estimation : ${s.minutesPerClick} min gagnées par clic évité ` +
    '(un même article compte une seule fois par jour).';
  $('stats-reset').disabled = s.clicksAvoided === 0;
}

async function refreshStats() {
  try {
    state.stats = await send('getStats');
    renderStats();
  } catch {
    /* le prochain refresh() réessaiera */
  }
}

/**
 * Boîte de confirmation (élément <dialog> natif : Échap = annuler, focus piégé,
 * thème clair/sombre). Résout vrai uniquement sur « confirmer ».
 */
function confirmDialog({ title, description, confirmLabel }) {
  const dialog = $('reset-dialog');
  $('reset-title').textContent = title;
  $('reset-desc').textContent = description;
  $('reset-confirm').textContent = confirmLabel;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

function render() {
  renderProviders();
  renderAccess();
  renderMedia();
  renderAnswers();
  renderBehavior();
  renderStats();
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

// ── Actions v2 : réponses de l'IA ─────────────────────────────────────────

for (const radio of document.querySelectorAll('input[name="language"]')) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    try {
      state.settings = await send('saveSettings', { settings: { language: radio.value } });
      feedback('answers-feedback', LANGUAGE_FEEDBACK[state.settings.language]);
      $('answers-upgrade').hidden = true;
    } catch (err) {
      feedback('answers-feedback', err.message, 'error');
      renderAnswers();
    }
  });
}

for (const radio of document.querySelectorAll('input[name="format"]')) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    if (radio.value === 'bullets' && !state.premium.premium) {
      showFormatLocked();
      return;
    }
    try {
      state.settings = await send('saveSettings', { settings: { format: radio.value } });
      feedback(
        'answers-feedback',
        state.settings.format === 'bullets' ? 'Format par défaut : puces (3 points maximum).' : 'Format par défaut : une phrase.'
      );
    } catch (err) {
      // Le worker a le dernier mot (ex. Premium expiré ou remboursé).
      if (err.code === 'PREMIUM_REQUIRED') showFormatLocked();
      else {
        feedback('answers-feedback', err.message, 'error');
        renderAnswers();
      }
    }
  });
}

$('answers-upgrade').addEventListener('click', () =>
  busy($('answers-upgrade'), async () => {
    try {
      await send('openPayment');
    } catch (err) {
      feedback('answers-feedback', err.message, 'error');
    }
  })
);

// ── Actions v2 : statistiques ─────────────────────────────────────────────

$('stats-reset').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'Remettre vos statistiques à zéro ?',
    description: 'Le compteur de clics évités et le temps gagné repartiront de zéro. Cette action est définitive.',
    confirmLabel: 'Remettre à zéro',
  });
  if (!confirmed) return;
  await busy($('stats-reset'), async () => {
    try {
      state.stats = await send('resetStats');
      renderStats();
      feedback('stats-feedback', 'Statistiques remises à zéro.');
    } catch (err) {
      feedback('stats-feedback', err.message, 'error');
    }
  });
  renderStats(); // busy() réactive le bouton : on réapplique l'état (désactivé à 0)
});

$('stats-erase').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'Effacer les données de statistiques ?',
    description: 'Le compteur tenu sur votre appareil sera supprimé. Cette action est définitive.',
    confirmLabel: 'Effacer',
  });
  if (!confirmed) return;
  try {
    state.stats = await send('resetStats');
    renderStats();
    feedback('stats-feedback', 'Données de statistiques effacées.');
  } catch (err) {
    feedback('stats-feedback', err.message, 'error');
  }
});

$('stats-upgrade').addEventListener('click', () =>
  busy($('stats-upgrade'), async () => {
    try {
      await send('openPayment');
    } catch (err) {
      feedback('stats-feedback', err.message, 'error');
    }
  })
);

// ── Synchronisation automatique ───────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings || changes.mediaDomains || changes.quota || changes.premiumLastKnown) {
    refresh();
  } else if (changes.stats) {
    refreshStats(); // un lien vient d'être analysé dans un autre onglet
  }
});
chrome.permissions.onAdded.addListener(refresh);
chrome.permissions.onRemoved.addListener(refresh);
// Retour sur l'onglet (ex. après paiement) : statut à jour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

refresh();
