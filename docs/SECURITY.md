# Audit SecOps final : Anti-Bait Zéro Clic 1.0.0

## Surface d'exposition

| Élément | Valeur | Justification |
|---|---|---|
| Permissions | `storage`, `scripting` | Aucune ne déclenche d'avertissement à l'installation |
| Hôtes requis | `api.anthropic.com`, `api.openai.com`, `extensionpay.com` | API IA et paiement uniquement |
| Hôtes optionnels | `https://*/*` | Lecture des articles, demandée par un clic explicite de l'utilisateur |
| Content scripts | X/Twitter, LinkedIn (statique) ; sites de médias (dynamique, sur accord) ; extensionpay.com (ExtPay) | Monde isolé, pas d'iframes |
| Ressources web exposées | aucune | Pas de détection de l'extension par les sites |
| CSP des pages | `script-src 'self'; object-src 'none'; base-uri 'none'` | Pas de code distant, pas d'`eval` |

## Flux de données

```
Page (x.com)                 Service worker                         Extérieur
────────────                 ──────────────                         ─────────
survol ≥ 600 ms ──Port──▶ valide l'URL (anti-SSRF)
                          cache ? ──oui──▶ réponse
                          déchiffre la clé (vault)
                          réserve le quota (chiffré)
                          fetch article ─── sans cookies ──────────▶ site HTTPS public
                          extrait le texte (≤ 12 000 car.)
                          flux IA ─────────── clé en en-tête ──────▶ Anthropic / OpenAI
infobulle ◀──Port── fragments de texte (textContent)
```

Ce qui quitte le navigateur : l'URL de l'article (vers le site), le texte de l'article et le titre du lien (vers le fournisseur IA choisi par l'utilisateur), et l'identifiant ExtensionPay (vers extensionpay.com). Ni l'historique ni les cookies ne sont transmis.

## Contrôles vérifiés

- [x] Aucune requête réseau depuis un content script.
- [x] URL validée trois fois : à la demande, après les redirections HTTP et à chaque saut HTML. IP, localhost, suffixes privés, ports non standard, identifiants et HTTP sont refusés (tests `url-guard`, `scraper`).
- [x] Fetch sans cookies (`credentials: 'omit'`) ni referrer.
- [x] Clé API chiffrée AES-GCM 256 ; clé maître non extractible ; AAD par usage ; aucune trace en clair dans `chrome.storage` (test `settings`).
- [x] La clé n'est jamais renvoyée à une page, seul un indice l'est ; les messages d'erreur sont nettoyés (`sanitize`).
- [x] Actions sensibles réservées aux pages de l'extension (vérification de `sender.url`).
- [x] Premium décidé par ExtensionPay côté worker ; statut et quota chiffrés ; une falsification est refusée par défaut (tests `Premium`, `quota`).
- [x] Réponse IA affichée en texte brut dans un Shadow DOM fermé (E2E : `shadowRoot === null` côté page).
- [x] Injection de prompt atténuée : contenu délimité et déclaré comme données.
- [x] Cache des réponses dans `storage.session` (`TRUSTED_CONTEXTS`), effacé à la fermeture du navigateur.
- [x] Aucun `eval`, `innerHTML`, `document.write` ni script distant (test statique).

## Limites connues (risque accepté)

1. **Compromission de la machine** : un logiciel malveillant exécuté avec les droits de l'utilisateur, ou une personne ayant accès aux DevTools du service worker, peut utiliser la clé. Aucune extension ne peut s'en protéger. La clé reste celle de l'utilisateur : recommandez une clé dédiée avec un plafond de dépenses chez le fournisseur.
2. **Requête GET vers une adresse privée via redirection** : si un site public redirige (HTTP 30x) vers une IP privée, le navigateur suit la redirection avant que l'URL finale puisse être contrôlée. La réponse est **rejetée** et n'est jamais lue ni envoyée à l'IA, mais la requête GET a été émise. Le risque est faible : aucun cookie, et un GET n'a normalement pas d'effet de bord.
3. **Injection de prompt** : elle est atténuée, pas éliminée. Une page piégée peut produire un résumé trompeur. L'impact se limite au texte affiché : l'IA n'a aucun outil ni action.
4. **Fraude au Premium** : un utilisateur peut forcer le statut via les DevTools du service worker. Le préjudice est faible (l'utilisateur paie déjà son propre usage IA) ; une protection forte exigerait un serveur.
5. **Licence ExtPay** : le dépôt officiel déclare la LGPL-3.0, mais le paquet npm et le code indiquent l'AGPL-3.0. L'intégration est conforme à la LGPL (fichier séparé non modifié, textes de licence fournis). Une confirmation écrite d'ExtensionPay reste nécessaire : voir [vendor/THIRD_PARTY_NOTICES.md](../vendor/THIRD_PARTY_NOTICES.md). Le code d'Anti-Bait lui-même est propriétaire (`LICENSE`, `"license": "UNLICENSED"`).

## Avant publication sur le Web Store

- [ ] Créer l'extension sur extensionpay.com avec l'ID `anti-bait-zero-clic` (ou modifier `EXTPAY_ID` dans `src/background/config.js`) et y configurer le prix.
- [ ] Rédiger la politique de confidentialité (données envoyées au fournisseur IA, à ExtensionPay) et remplir le formulaire « Pratiques de confidentialité » du Web Store.
- [ ] Justifier `scripting` et l'hôte optionnel `https://*/*` dans le formulaire de soumission.
