# Tableau de Bord de l'Équipe Évolutive - Extension Anti-Bait

## [x] Phase 1 : Architecture & Squelette MV3

- [x] Initialiser le manifest.json conforme aux normes de sécurité 2026.
- [x] Créer le Content Script (Détection intelligente du survol sur X et médias).
- [x] Créer le Background Script (Gestionnaire de requêtes asynchrones).
- [x] Revue QA & SecOps sur la consommation RAM et CPU.

## [x] Phase 2 : Moteur d'Extraction & Connexion IA

- [x] Développer l'algorithme de "Scraping Fantôme" (Fetch discret de la page).
- [x] Intégrer le connecteur API (Anthropic/OpenAI) avec gestion du streaming.
- [x] Sécuriser les clés API (Chiffrement local via `chrome.storage.local`).
- [x] Test de charge QA (Simulation de 50 survols rapides de liens).

## [x] Phase 3 : Interface Utilisateur & Monétisation

- [x] Coder l'UI du Tooltip (CSS injecté sans casser le style du site hôte).
- [x] Intégrer le SDK ExtensionPay (Logique de blocage Premium).
- [x] Audit SecOps final avant déploiement.

## [ ] Phase 4 : Version 2.0.0

- [x] Intégrer une option dans la page de configuration pour traduire automatiquement en français les résumés d'articles étrangers.
- [x] Ajouter un sélecteur de format dans l'infobulle (Mode "Une phrase" vs Mode "Bullet Points").
- [x] Mettre en place un compteur local (`chrome.storage.local`) du nombre total de clics évités et du temps estimé gagné (ex : 2 minutes par clic évité) pour l'afficher sur la page des options.

**Arbitrages produit :** langue à 3 choix (navigateur / toujours français / langue de l'article) · un changement de format sur un lien déjà analysé ne consomme pas de quota · format « Bullet Points » (3 puces max) et statistiques **réservés au Premium**.

**Avancement (branche `v2`) :**
- [x] 4.1 Modèle de réglages : `language`, `format`, verrou Premium côté worker (`config.js`, `settings.js`, `errors.js`)
- [x] 4.2 Connecteur IA : prompt conditionnel langue × format, mise en forme des puces (`ai-connector.js`)
- [x] 4.3 Cache par variante (langue × format) et règle « changement de format sans quota » prouvée côté worker (`cache.js`, `service-worker.js`)
- [x] 4.4 Infobulle : sélecteur de format (puces verrouillées 🔒 pour les comptes gratuits, avec incitation Premium) (`tooltip-ui.js`, `content-script.js`) — validé en E2E : `tests/e2e/tooltip-format.mjs` (17/17)
- [x] 4.5 Compteur de clics évités et de temps gagné (`stats.js`, `service-worker.js`) — 1 clic évité max par article et par jour, stockage `chrome.storage.local` sans URL en clair, API `getStats` / `resetStats` prête pour la page d'options ; validé en E2E (21/21)
- [x] 4.6 Page d'options : langue (3 choix), format par défaut (🔒 Premium), carte « Vos statistiques » (verrouillée pour les gratuits, remise à zéro avec confirmation pour les Premium), thèmes clair/sombre (`options.*`) — validé en E2E : `tests/e2e/options-v2.mjs` (21/21)
- [ ] 4.7 Documentation (README, fiche Store, politique de confidentialité — **ajouter le compteur local et le registre d'empreintes du jour**), version 2.0.0, paquet

> Détail des revues QA × SecOps par tâche : [docs/REVIEWS.md](docs/REVIEWS.md) · Audit final : [docs/SECURITY.md](docs/SECURITY.md)
