<p align="center">
  <img src="icons/icon-128.png" alt="Logo Anti-Bait Zéro Clic" width="96" height="96">
</p>

<h1 align="center">Anti-Bait Zéro Clic</h1>

<p align="center">
  <strong>Survolez un titre putaclic. Obtenez la réponse. Sans cliquer.</strong><br>
  Extension pour Google Chrome · X (Twitter) · LinkedIn · sites d'actualité
</p>

<p align="center">
  <a href="#-installation">Installation</a> ·
  <a href="#-configurer-votre-clé-api">Clé API</a> ·
  <a href="#-gratuit-ou-premium">Tarifs</a> ·
  <a href="marketing/PRIVACY_POLICY.md">Confidentialité</a> ·
  <a href="#-questions-fréquentes">FAQ</a>
</p>

---

## 🎣 Le problème

> *« Vous ne devinerez jamais quel aliment les médecins déconseillent… »*
> *« Ce chiffre va vous surprendre »*
> *« La raison est incroyable »*

Ces titres cachent volontairement l'information pour vous faire cliquer, charger une page remplie de publicités et faire défiler dix paragraphes avant d'obtenir… une seule phrase.

## ✨ La solution

**Anti-Bait Zéro Clic lit l'article à votre place.** Posez votre souris une demi-seconde sur un lien : une petite bulle affiche la réponse que le titre cache, en une ou deux phrases.

```
┌──────────────────────────────────────────────────────────────┐
│  Vous ne devinerez jamais quel aliment les médecins…         │  ← le lien survolé
└──────────────────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────────┐
   │ ● Anti-Bait   lemonde.fr                          ×  │
   │                                                      │
   │ Les charcuteries industrielles, en raison des        │  ← la réponse, en direct
   │ nitrites ajoutés, selon une étude de l'Inserm.       │
   └──────────────────────────────────────────────────────┘
```

Pas de clic, pas de page chargée, pas de publicité.

## 🚀 Fonctionnalités

| | |
|---|---|
| ⚡ **Zéro clic** | La réponse apparaît au survol et s'écrit en direct |
| 🧠 **Intelligente** | Rien ne s'affiche quand vous faites défiler votre fil : seulement quand vous vous **arrêtez** sur un lien |
| 🌍 **Partout où vous lisez** | X (Twitter), LinkedIn, et les sites d'actualité de votre choix (Le Monde, 20 Minutes, Le Figaro…) |
| 🔁 **Instantanée** | Un lien déjà analysé s'affiche immédiatement, sans nouvelle requête |
| 🎨 **Discrète** | S'adapte au thème clair ou sombre, sans jamais modifier l'apparence des sites |
| 🔒 **Respectueuse** | Aucun serveur intermédiaire, aucun pistage, clé API chiffrée sur votre appareil |
| 🤖 **Votre IA** | Anthropic (Claude) ou OpenAI, avec votre propre clé |

---

## 📦 Installation

> L'extension sera bientôt disponible sur le Chrome Web Store. En attendant, voici l'installation manuelle (2 minutes).

### 1. Télécharger l'extension

**Option A : version prête à l'emploi (recommandée)**
1. Ouvrez la page **[Releases](../../releases)** de ce dépôt.
2. Téléchargez le fichier `anti-bait-<version>.zip` de la dernière version.
3. Faites un clic droit sur le fichier, puis **Extraire tout…**.

**Option B : depuis le code source**
1. En haut de cette page, cliquez sur le bouton vert **Code**, puis **Download ZIP**.
2. Faites un clic droit sur le fichier, puis **Extraire tout…**.

### 2. Charger l'extension dans Chrome

1. Ouvrez Chrome et tapez dans la barre d'adresse : `chrome://extensions`
2. En haut à droite, activez le **Mode développeur**.
3. Cliquez sur **Charger l'extension non empaquetée**.
4. Sélectionnez le dossier extrait, **celui qui contient le fichier `manifest.json`**.
5. L'icône Anti-Bait apparaît dans la barre d'outils (pensez à l'épingler 📌 via l'icône en forme de puzzle). La page de réglages s'ouvre automatiquement.

> Fonctionne aussi sur Microsoft Edge, Brave et Opera, via leur page d'extensions équivalente. Chrome 120 ou plus récent est requis.

---

## 🔑 Configurer votre clé API

Anti-Bait utilise un service d'intelligence artificielle pour lire les articles. Vous utilisez **votre propre clé** : vous gardez le contrôle de vos données et de vos dépenses.

> 💡 Un abonnement Claude Pro ou ChatGPT Plus **ne suffit pas** : l'accès API est un service distinct, facturé à l'usage (quelques euros suffisent pour des centaines d'analyses avec un modèle économique).

### Option 1 : Anthropic (Claude), recommandé

1. Créez un compte sur **[console.anthropic.com](https://console.anthropic.com)**.
2. Dans **Billing**, ajoutez un moyen de paiement et un peu de crédit (5 $ suffisent pour commencer).
3. Dans **API Keys**, cliquez sur **Create Key** et nommez-la « Anti-Bait ».
4. Copiez la clé : elle commence par `sk-ant-…` et n'est affichée qu'**une seule fois**.

### Option 2 : OpenAI

1. Créez un compte sur **[platform.openai.com](https://platform.openai.com)**.
2. Dans **Billing**, ajoutez du crédit.
3. Ouvrez **[API keys](https://platform.openai.com/api-keys)**, cliquez sur **Create new secret key**, puis copiez la clé (elle commence par `sk-…`).

### Enregistrer la clé dans Anti-Bait

1. Cliquez sur l'icône Anti-Bait pour ouvrir les **réglages**.
2. Dans la section **1 – Fournisseur IA et clé API** :
   - choisissez votre **fournisseur** ;
   - collez votre clé dans **Clé API** et cliquez sur **Enregistrer** ;
   - cliquez sur **Tester la clé** : le message « Clé valide et modèle disponible » confirme que tout est prêt.
3. Dans la section **2 – Lecture des articles**, cliquez sur **Autoriser la lecture des articles** et acceptez la demande de Chrome.

**Choisir son modèle** (champ « Modèle ») :

| Fournisseur | Modèle | Profil |
|---|---|---|
| Anthropic | `claude-opus-5-5` (par défaut) | Le plus fiable |
| Anthropic | `claude-haiku-5-5` | Le plus rapide et le plus économique, idéal pour un usage quotidien |
| OpenAI | `gpt-4.1-mini` (par défaut) | Rapide et économique |

> 🛡️ **Bon réflexe :** créez une clé réservée à Anti-Bait et fixez un plafond de dépenses mensuel dans la console de votre fournisseur. Ne partagez jamais votre clé.

---

## 🖱️ Utilisation

1. Ouvrez **X**, **LinkedIn** ou un site d'actualité que vous avez ajouté.
2. Laissez votre souris **environ une demi-seconde** sur un lien d'article.
3. La bulle affiche « Lecture de l'article… », puis la réponse.

**Ajouter un site d'actualité :** dans les réglages, section **3 – Sites de médias**, tapez par exemple `lemonde.fr`, cliquez sur **Ajouter**, puis rechargez la page du site.

**Raccourcis :** `Échap` ferme la bulle. Le délai de survol se règle dans la section **4 – Comportement**.

---

## 💎 Gratuit ou Premium

| | Gratuit | Premium |
|---|:---:|:---:|
| Analyses par jour | 10 | **Illimitées** |
| Réponses déjà analysées | ✅ illimitées | ✅ illimitées |
| X, LinkedIn, sites d'actualité | ✅ | ✅ |
| Choix du fournisseur et du modèle d'IA | ✅ | ✅ |

L'abonnement Premium se souscrit depuis les réglages (bouton **Passer Premium**). Le paiement est sécurisé par **ExtensionPay** et **Stripe** : aucune donnée bancaire ne transite par l'extension.

---

## 🔒 Confidentialité et sécurité

- **Aucun serveur intermédiaire** : l'extension fonctionne entièrement dans votre navigateur.
- **Lecture anonyme** : les articles sont téléchargés **sans vos cookies**, donc les sites ne savent pas qui vous êtes.
- **Clé API chiffrée** (AES-GCM 256 bits) sur votre appareil, jamais réaffichée en entier.
- **Aucun pistage**, aucune publicité, aucune revente de données.
- **Mémoire courte** : les réponses mémorisées sont effacées à la fermeture du navigateur.
- **Permissions minimales** : l'accès aux sites n'est demandé que lorsque vous cliquez sur « Autoriser ».

📄 [Politique de confidentialité complète](marketing/PRIVACY_POLICY.md) · 🛡️ [Audit de sécurité](docs/SECURITY.md)

---

## ❓ Questions fréquentes

<details>
<summary><strong>Rien ne s'affiche quand je survole un lien.</strong></summary>

- Vérifiez dans les réglages que la clé est enregistrée et que la lecture des articles est **Autorisée**.
- Sur un site d'actualité, ajoutez-le dans « Sites de médias » puis **rechargez la page** (F5).
- Restez immobile environ une demi-seconde : un simple passage de souris est volontairement ignoré.
- Les liens internes (menus, profils, hashtags) ne déclenchent rien : seuls les liens d'articles sont analysés.
</details>

<details>
<summary><strong>« Ce site bloque la lecture automatique » ou réponse incomplète.</strong></summary>

Certains articles sont réservés aux abonnés (paywall). Anti-Bait lit les pages sans vos cookies, donc sans votre abonnement. Pour ces articles, seul le début est accessible.
</details>

<details>
<summary><strong>Combien coûte une analyse ?</strong></summary>

Cela dépend du modèle : de l'ordre d'un centime avec `claude-opus-5-5`, et bien moins avec `claude-haiku-5-5` ou `gpt-4.1-mini`. Les liens déjà analysés ne coûtent rien.
</details>

<details>
<summary><strong>Mes données sont-elles envoyées quelque part ?</strong></summary>

Uniquement le texte de l'article survolé, envoyé au fournisseur d'IA que vous avez choisi, avec votre clé. L'éditeur d'Anti-Bait ne reçoit aucune donnée. Détails dans la [politique de confidentialité](marketing/PRIVACY_POLICY.md).
</details>

<details>
<summary><strong>Fonctionne-t-il sur mobile ?</strong></summary>

Non. Le principe repose sur le survol à la souris, qui n'existe pas sur un écran tactile. L'extension est conçue pour Chrome sur ordinateur.
</details>

---

## 🛠️ Pour les développeurs

Extension **Manifest V3**, sans framework ni étape de build. Seul Node.js 22 ou plus récent est nécessaire, pour les tests et l'empaquetage.

```bash
npm test          # tests unitaires, de sécurité et de charge
npm run pack      # crée dist/anti-bait-<version>.zip pour le Chrome Web Store
npm run icons     # régénère les icônes
```

| Dossier | Contenu |
|---|---|
| `src/content/` | Détection du survol et infobulle (Shadow DOM fermé) |
| `src/background/` | Service worker : lecture des articles, IA en streaming, chiffrement, Premium |
| `src/options/` | Page de réglages |
| `vendor/` | SDK ExtensionPay et licences tierces |
| `docs/` | [Architecture du manifest](docs/MANIFEST.md) · [Revues QA/Sécurité](docs/REVIEWS.md) · [Audit de sécurité](docs/SECURITY.md) |
| `tests/` | Tests `node:test` et test de bout en bout headless |

---

## 📜 Licence

© 2026 — Tous droits réservés. Le code source est consultable mais **n'est pas sous licence libre** : voir [LICENSE](LICENSE).
Composants tiers : voir [vendor/THIRD_PARTY_NOTICES.md](vendor/THIRD_PARTY_NOTICES.md).
