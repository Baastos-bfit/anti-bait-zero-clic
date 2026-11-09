# Fiche Chrome Web Store : Anti-Bait Zéro Clic

Ce fichier contient les textes à copier dans le [tableau de bord développeur Chrome](https://chrome.google.com/webstore/devconsole). Le Web Store n'affiche pas le Markdown : copiez le contenu des blocs de texte tel quel.

---

## 1. Onglet « Fiche Play Store » (Store listing)

### Nom
```
Anti-Bait Zéro Clic
```

### Résumé (132 caractères max ; repris du manifest)
```
Survolez un lien putaclic : l'IA vous révèle la réponse sans que vous ayez à cliquer.
```

### Description
```
Marre des titres qui cachent la réponse pour vous faire cliquer ?

« Vous ne devinerez jamais qui… », « Ce chiffre va vous surprendre », « La raison est incroyable »…
Anti-Bait Zéro Clic lit l'article à votre place et vous donne directement la réponse, en une ou deux phrases, dans une petite bulle au survol du lien.

★ COMMENT ÇA MARCHE
Posez simplement votre souris une demi-seconde sur un lien d'article. Une bulle s'affiche avec la réponse que le titre cache : le nom, le chiffre, le fait. Pas de clic, pas de page chargée, pas de publicité.

★ OÙ ÇA FONCTIONNE
• X (Twitter)
• LinkedIn
• Les sites d'actualité de votre choix (Le Monde, 20 Minutes, Le Figaro…), ajoutés en un clic

★ RESPECT DE VOTRE VIE PRIVÉE
• Aucun serveur intermédiaire : l'extension fonctionne dans votre navigateur
• Les articles sont lus sans vos cookies : les sites ne savent pas qui vous êtes
• Votre clé API est chiffrée sur votre appareil
• Aucun pistage, aucune publicité, aucune revente de données
• Les réponses mémorisées sont effacées à la fermeture du navigateur

★ PENSÉE POUR NE PAS VOUS GÊNER
• Rien ne s'affiche quand vous faites défiler votre fil : seulement quand vous vous arrêtez sur un lien
• La bulle s'adapte au thème clair ou sombre et ne modifie pas l'apparence des sites
• Réponse instantanée quand vous survolez un lien déjà analysé
• Délai de survol réglable, désactivation en un clic

★ VOTRE IA, VOTRE CLÉ
Anti-Bait utilise le service d'IA de votre choix, Anthropic (Claude) ou OpenAI, avec votre propre clé API. Vous gardez le contrôle de vos données et de vos dépenses : selon le modèle choisi, une analyse coûte de l'ordre d'un centime, voire bien moins avec les modèles les plus économiques.

★ GRATUIT OU PREMIUM
• Gratuit : 10 analyses par jour (les réponses déjà obtenues ne comptent pas)
• Premium : analyses illimitées, 3,99 € en paiement unique (pas d'abonnement)

Pour commencer : installez l'extension, collez votre clé API dans la page de réglages qui s'ouvre automatiquement, autorisez la lecture des articles… et survolez !

Une clé API Anthropic ou OpenAI est nécessaire. Elle se crée en quelques minutes sur console.anthropic.com ou platform.openai.com.
```

### Catégorie
```
Productivité
```

### Langue
```
Français
```

### Éléments graphiques à fournir
- **Icône 128×128** : `icons/icon-128.png` (déjà incluse dans le paquet)
- **Captures d'écran** (au moins 1, 1280×800 ou 640×400) : l'infobulle avec une réponse sur un article, la page de réglages, l'infobulle sur un post LinkedIn
- **Petite vignette promotionnelle** (440×280), facultative mais recommandée

---

## 2. Onglet « Pratiques de confidentialité » (Privacy practices)

### Objectif unique (Single purpose)
```
Afficher, au survol d'un lien d'article, une réponse courte générée par IA qui révèle l'information cachée par un titre racoleur, sans que l'utilisateur ait à ouvrir la page.
```

### Justification des autorisations

**storage**
```
Enregistrer localement les réglages de l'utilisateur, sa clé API chiffrée, la liste des sites d'actualité activés, le compteur d'analyses gratuites et un cache temporaire des réponses (effacé à la fermeture du navigateur).
```

**scripting**
```
Activer la détection du survol des liens uniquement sur les sites d'actualité que l'utilisateur ajoute lui-même dans les réglages (enregistrement dynamique du script de contenu, après son autorisation explicite pour chaque site).
```

**Autorisations d'hôte : x.com, twitter.com, linkedin.com**
```
Détecter le survol des liens d'articles partagés sur ces plateformes et y afficher l'infobulle de réponse. Le script lit uniquement l'adresse et le texte du lien survolé ; il ne lit pas le reste des publications et n'effectue aucune action sur ces sites.
```

**Autorisations d'hôte : api.anthropic.com, api.openai.com**
```
Envoyer le texte de l'article survolé au fournisseur d'IA choisi par l'utilisateur, avec sa propre clé API, pour obtenir la réponse affichée dans l'infobulle.
```

**Autorisation d'hôte : extensionpay.com**
```
Vérifier si l'utilisateur a acheté la version Premium et afficher la page de paiement via ExtensionPay (paiement traité par Stripe ; aucune donnée bancaire ne transite par l'extension).
```

**Autorisation d'hôte facultative : https://*/***
```
Demandée uniquement par un clic de l'utilisateur dans les réglages. Elle permet de télécharger la page de l'article derrière le lien survolé, quel que soit le site d'actualité, afin d'en extraire le texte. Les requêtes sont envoyées sans cookies ni référent, uniquement pour les liens survolés ; les liens vers des adresses de réseaux privés ou locaux sont refusés.
```

### Code distant
```
Non, je n'utilise pas de code distant. Tout le code JavaScript, y compris la bibliothèque ExtensionPay, est inclus dans le paquet.
```

### Utilisation des données : cases à cocher recommandées

Cochez les catégories suivantes : elles sont transmises hors de l'appareil, vers le fournisseur d'IA choisi par l'utilisateur.

- [x] **Contenu des sites web** : texte et titre des articles survolés, envoyés au fournisseur d'IA
- [x] **Informations d'authentification** : clé API de l'utilisateur, envoyée uniquement à son fournisseur d'IA

Laissez **non cochées** : informations permettant d'identifier personnellement l'utilisateur, informations de santé, informations financières et de paiement (traitées par ExtensionPay/Stripe hors de l'extension), communications personnelles, position, historique Web, activité de l'utilisateur.

Cochez ensuite les trois certifications :
- [x] Je ne vends ni ne transfère les données utilisateur à des tiers, en dehors des cas d'utilisation approuvés
- [x] Je n'utilise ni ne transfère les données utilisateur à des fins sans rapport avec l'objectif unique de mon article
- [x] Je n'utilise ni ne transfère les données utilisateur pour déterminer la solvabilité ou à des fins de prêt

### URL de la politique de confidentialité
```
https://baastos-bfit.github.io/anti-bait-zero-clic/marketing/PRIVACY_POLICY.html
```
Le Web Store exige une URL accessible publiquement. Options simples : une page Google Sites, Notion publique ou GitHub Pages.

---

## 3. Onglet « Distribution »

- **Tarification** : gratuite (le Premium est vendu dans l'extension via ExtensionPay)
- **Visibilité** : publique
- **Régions** : toutes, ou au minimum les pays francophones (la description et l'interface sont en français)
