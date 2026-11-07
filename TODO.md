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

> Détail des revues QA × SecOps par tâche : [docs/REVIEWS.md](docs/REVIEWS.md) · Audit final : [docs/SECURITY.md](docs/SECURITY.md)
