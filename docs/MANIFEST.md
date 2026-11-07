# manifest.json : notes d'architecture

> Le format JSON n'accepte pas les commentaires : un `//` dans `manifest.json` empêche Chrome de charger l'extension. Chaque choix est donc documenté ici.

## Identité

| Champ | Valeur | Pourquoi |
|---|---|---|
| `manifest_version` | `3` | MV2 n'est plus accepté par Chrome ni par le Web Store |
| `minimum_chrome_version` | `120` | `AbortSignal.any`, `registerContentScripts` persistant, `optional_host_permissions` |
| `version` | `1.0.0` | SemVer, à incrémenter à chaque soumission |

## Background (`src/background/service-worker.js`)

- **Worker classique (pas `type: module`)** : le SDK ExtensionPay n'est distribué qu'en IIFE (`dist/ExtPay.js`) ou en module ES avec un import nu (`webextension-polyfill`) que Chrome ne sait pas résoudre sans bundler. Les fichiers sont donc chargés par `importScripts`, chacun s'attachant à l'espace de noms `globalThis.AntiBait`.
- **Éphémère** : Chrome l'arrête après environ 30 s d'inactivité. L'état vit dans `chrome.storage`, et un battement est actif uniquement pendant une analyse.
- **Seul point de sortie réseau** : c'est le seul contexte qui contourne le CORS grâce aux `host_permissions`.

## Content scripts

1. **X/Twitter et LinkedIn** (statique) : `domain-utils.js` → `hover-intent.js` → `tooltip-ui.js` → `content-script.js`, `document_idle`, sans iframes. Les quatre fichiers partagent le monde isolé, dans cet ordre.
2. **Sites de médias** (dynamique) : les mêmes fichiers, enregistrés via `chrome.scripting.registerContentScripts` pour les domaines que l'utilisateur ajoute et autorise (d'où la permission `scripting`). Un test vérifie que les deux listes restent identiques.
3. **extensionpay.com** : `vendor/ExtPay.js` à `document_start`, exigé par ExtensionPay pour signaler un paiement réussi (`onPaid`).

## Permissions

| Permission | Avertissement | Usage |
|---|---|---|
| `storage` | aucun | Réglages, clé chiffrée, quota chiffré, cache de session. Requise aussi par ExtPay |
| `scripting` | aucun | Injection sur les sites de médias choisis |
| `host_permissions` : API Anthropic et OpenAI, extensionpay.com | aucun | Appels IA et vérification Premium depuis le worker |
| `optional_host_permissions` : `https://*/*` | **à la demande** | « Scraping Fantôme ». Demandée dans les réglages via `chrome.permissions.request()` sur un clic |

**Volontairement absents :** `<all_urls>`, `http://*/*`, `tabs`, `activeTab`, `webRequest`, `cookies`, `web_accessible_resources`.

## CSP

`script-src 'self'; object-src 'none'; base-uri 'none'` : aucun script distant ni inline, aucun `eval`, aucun plugin.

## Pages

- `options_ui` → `src/options/options.html` (ouverte dans un onglet). Elle s'ouvre aussi au clic sur l'icône et automatiquement à l'installation.
