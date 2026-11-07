# Revues d'équipe : QA × SecOps

Chaque tâche du [TODO](../TODO.md) a été soumise à la confrontation entre le **[QA Engineer]** (performance, absence de blocage, nettoyage mémoire, cas d'erreur) et le **[SecOps]** (requêtes, clé API, paiements). Ce journal liste, pour chaque tâche, les objections soulevées et leur résolution dans le code final.

---

## Phase 1 : Architecture et squelette MV3

### 1.1 manifest.json → [`manifest.json`](../manifest.json), [MANIFEST.md](MANIFEST.md)
| Qui | Objection | Résolution |
|---|---|---|
| SecOps | `<all_urls>` à l'installation déclenche un avertissement anxiogène et une revue lente sur le Web Store | `https://*/*` en `optional_host_permissions`, demandé par un clic dans les réglages |
| SecOps | Le code distant est interdit en MV3 | CSP `script-src 'self'`, ExtPay embarqué localement (`vendor/`) |
| SecOps | Exposer des fichiers permet aux sites de détecter l'extension (fingerprinting) | Aucune `web_accessible_resources` |
| QA | Injecter le script partout gaspille la RAM | Injection statique sur X/LinkedIn seulement, `all_frames: false` |
| QA | ExtPay n'existe pas en module ES autonome (import nu `webextension-polyfill`) | Worker **classique** + `importScripts` |

### 1.2 Content Script → [`content-script.js`](../src/content/content-script.js), [`hover-intent.js`](../src/content/hover-intent.js)
| Qui | Objection | Résolution |
|---|---|---|
| QA | Un écouteur par lien ou un MutationObserver sur le fil de X coûte cher | **Une** délégation d'événements sur `document` (capture, passive) |
| QA | Faire défiler le fil = dizaines de survols par seconde | Machine à états `HoverIntent` : délai d'arrêt de 600 ms (réglable), une seule attente à la fois |
| QA | X recycle les nœuds `<a>` en changeant leur `href` | Mémo par élément (`WeakMap`), invalidé si le `href` change |
| QA | Après une mise à jour de l'extension, « Extension context invalidated » | Détection `chrome.runtime.id`, puis `teardown()` complet (écouteurs, minuteurs, DOM, Port) |
| QA | Tactile : pas de vrai survol | Filtre `pointerType` (souris et stylet uniquement) |
| SecOps | Le content script subit le CORS de la page et pourrait être leurré | Il ne fait **aucun** `fetch` : tout passe par un Port vers le worker, qui revalide l'URL |
| SecOps | Les liens internes de X ou LinkedIn (profils, posts) ne sont pas des articles | Exclusion des plateformes sociales, déballage des redirecteurs (LinkedIn, Facebook, Google), HTTPS forcé |

### 1.3 Background Script → [`service-worker.js`](../src/background/service-worker.js), [`jobs.js`](../src/background/jobs.js)
| Qui | Objection | Résolution |
|---|---|---|
| QA | Chrome arrête le worker après ~30 s, y compris pendant une réponse IA | Battement `getPlatformInfo` toutes les 20 s, **uniquement** pendant une analyse |
| QA | Des écouteurs enregistrés après un `await` sont perdus au réveil du worker | Tous les écouteurs sont enregistrés de façon synchrone au chargement |
| QA | 50 survols rapides pourraient donner 50 requêtes parallèles | `JobRegistry` : une analyse par onglet, 3 au maximum au total, `AbortSignal` propagé partout |
| QA | Un survol abandonné doit libérer le réseau | Fermeture du Port, puis `abort()` du fetch et du flux IA |
| SecOps | N'importe quel content script pourrait demander la clé ou changer les réglages | Deux listes de gestionnaires : pages de l'extension (`sender.url` = origine de l'extension) et content scripts (seulement ouvrir les réglages ou le paiement) |
| SecOps | Les messages texte d'ExtPay arrivent sur le même canal | Messages non-objets ignorés (`return false`) : aucune interférence |

### 1.4 Revue RAM/CPU (transverse)
- **RAM** : infobulle créée une fois puis réutilisée ; LRU de 40 réponses dans l'onglet ; HTML plafonné à 2 Mo ; cache de session plafonné à 150 entrées avec TTL de 6 h ; un démontage ne laisse aucune référence.
- **CPU** : texte en streaming regroupé par `requestAnimationFrame` (une mise en page par frame) ; positionnement par `transform` ; `contain: layout paint style` ; repositionnement au scroll limité à une fois par frame.
- **Réseau** : réponses en cache instantanées, sans quota ni requête ; statut Premium mis en cache 10 min.

---

## Phase 2 : Moteur d'extraction et connexion IA

### 2.1 Scraping Fantôme → [`scraper.js`](../src/background/scraper.js), [`html-extractor.js`](../src/background/html-extractor.js), [`url-guard.js`](../src/background/url-guard.js)
| Qui | Objection | Résolution |
|---|---|---|
| SecOps | **SSRF** : un lien vers `https://192.168.1.1` ferait lire un contenu privé puis l'enverrait à l'IA | `url-guard` refuse les IP littérales, localhost, `.local`/`.internal`…, les ports non standard et les identifiants dans l'URL. La garde est appliquée à l'URL demandée, à l'URL **finale après redirections** et à chaque saut HTML |
| SecOps | Envoyer les cookies ferait résumer des pages privées (messagerie, compte) | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` |
| SecOps | En HTTP, un attaquant réseau peut modifier le texte | HTTPS uniquement (les redirections `http://` de t.co sont promues en HTTPS) |
| QA | Pas de `DOMParser` dans un service worker | Extraction par regex linéaires : JSON-LD `articleBody` d'abord, puis `<p>` de `<article>`, puis meta description |
| QA | Une page de 50 Mo ferait exploser la mémoire | Lecture en flux plafonnée à 2 Mo, `reader.cancel()` |
| QA | Site lent, lien mort, PDF, paywall | Délai de 8 s, erreurs typées (`FETCH_TIMEOUT`, `FETCH_NOT_FOUND`, `NOT_HTML`, `FETCH_BLOCKED`, `EMPTY_CONTENT`) avec message clair |
| QA | t.co et lnkd.in renvoient une page de redirection, pas l'article | Suivi des `meta refresh`, de `location.replace` et de l'interstitiel lnkd.in (3 sauts au maximum) |
| QA | Sites en Windows-1252 | Décodage selon le charset (en-tête HTTP, puis `<meta charset>`) |

### 2.2 Connecteur IA en streaming → [`ai-connector.js`](../src/background/ai-connector.js), [`sse.js`](../src/background/sse.js)
| Qui | Objection | Résolution |
|---|---|---|
| SecOps | Injection de prompt : l'article peut contenir « ignore tes consignes… » | Contenu encadré par `<article>` (balises internes neutralisées) et consigne système qui le déclare comme données |
| SecOps | Une erreur fournisseur pourrait contenir la clé | `sanitize()` masque les `sk-…` et tronque |
| SecOps | Réponse IA affichée dans la page | `textContent` uniquement, jamais d'HTML |
| QA | Paquets SSE coupés au milieu d'un événement, d'un caractère UTF-8 ou d'un CRLF | Tampon et `TextDecoder` en flux, gestion du `\r` en fin de paquet |
| QA | Coût et latence au survol | Effort `low`, réponse limitée à 60 mots, plafond de 1 200 caractères, annulation immédiate |
| QA | Refus de sécurité côté IA | Repli serveur `fallbacks: "default"` (Opus/Sonnet 5.x) ; refus en cours de flux : `reset` du texte partiel, puis `AI_REFUSED` |
| QA | Tester une clé ne doit rien coûter | `GET /v1/models/{id}` (gratuit) |

### 2.3 Sécurisation des clés API → [`vault.js`](../src/background/vault.js), [`settings.js`](../src/background/settings.js)
| Qui | Objection | Résolution |
|---|---|---|
| SecOps | Clé en clair dans `chrome.storage.local`, lisible par un content script compromis ou sur le disque | AES-GCM 256, clé maître **non extractible** dans l'IndexedDB de l'origine de l'extension |
| SecOps | Rejouer un chiffré dans un autre contexte | AAD par usage (`apikey:anthropic`, `store:quota`…) |
| SecOps | La page d'options ne doit pas détenir le secret | Envoi unique au worker, champ vidé, seul un indice (`…WXYZ`) est affiché |
| QA | Deux ouvertures simultanées pourraient créer deux clés maîtres | Promesse mémorisée et `add()` (pas `put()`) sur IndexedDB |

### 2.4 Test de charge QA → [`tests/hover-load.test.mjs`](../tests/hover-load.test.mjs)
50 survols de 40 ms : **0** analyse. Balayage de 50 liens puis arrêt : **1** analyse. **0** minuteur orphelin. Côté worker, 50 demandes en rafale : 1 analyse vivante par onglet et 3 au maximum au total.

---

## Phase 3 : Interface et monétisation

### 3.1 UI de l'infobulle → [`tooltip-ui.js`](../src/content/tooltip-ui.js)
| Qui | Objection | Résolution |
|---|---|---|
| QA | Le CSS de X ou LinkedIn casse l'infobulle (et inversement) | Élément `<anti-bait-root>`, `all: initial !important` sur l'hôte, **Shadow DOM fermé**, variables CSS redéfinies localement |
| QA | Le DOM des SPA est réécrit | Ré-attachement de l'hôte s'il a été retiré |
| QA | Lien qui défile hors écran ou retiré du DOM | Fermeture automatique (`onAnchorLost`) |
| QA | Accessibilité | `role="dialog"`, `aria-live`, Échap, focus clavier, `prefers-reduced-motion`, thème sombre |
| SecOps | La page hôte ne doit pas lire la réponse | Shadow root `closed` ; le code s'exécute dans le monde isolé (vérifié en E2E) |

### 3.2 ExtensionPay → [`premium.js`](../src/background/premium.js)
| Qui | Objection | Résolution |
|---|---|---|
| SecOps | Un content script compromis pourrait s'octroyer le Premium | Statut décidé dans le worker à partir d'`ExtPay.getUser()` ; le dernier statut connu est **chiffré**, une valeur forgée est ignorée |
| SecOps | Remettre son quota à zéro en écrasant le stockage | Quota chiffré ; une valeur illisible **bloque** le quota pour la journée (refus par défaut) |
| SecOps | Le message `extpay-fetch-user` peut être émis par n'importe quelle page | Il ne déclenche qu'une **re-vérification serveur** |
| QA | Un appel réseau ExtensionPay par survol | Cache de 10 min, délai max de 4 s, repli sur le dernier statut |
| QA | Course entre onglets sur le compteur | File sérialisée : 25 réservations simultanées donnent exactement 10 accordées (testé) |
| QA | Un échec ne doit pas consommer de quota | Réservation remboursée en cas d'erreur ou d'annulation |

### 3.3 Audit SecOps final → [SECURITY.md](SECURITY.md)
