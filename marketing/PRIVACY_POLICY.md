# Politique de confidentialité : Anti-Bait Zéro Clic

**Dernière mise à jour : 7 novembre 2026**

Anti-Bait Zéro Clic (« l'extension ») est une extension pour Google Chrome éditée par **[NOM DE L'ÉDITEUR]** (« nous »). Cette politique explique quelles données l'extension traite, où elles vont et comment vous gardez le contrôle.

**En résumé :** nous n'avons aucun serveur et nous ne recevons aucune de vos données. L'extension fonctionne dans votre navigateur. Elle envoie le texte d'un article au fournisseur d'intelligence artificielle que **vous** avez choisi, avec **votre** clé API, et seulement quand vous survolez un lien. Nous ne faisons ni publicité, ni pistage, ni revente de données.

---

## 1. Ce que fait l'extension

Quand vous laissez le pointeur de la souris environ une demi-seconde sur un lien d'article, sur X/Twitter, LinkedIn ou un site d'actualité que vous avez activé, l'extension :

1. télécharge la page de l'article, sans vos cookies ;
2. en extrait le texte ;
3. demande à un service d'IA de résumer en une ou deux phrases la réponse que le titre cache ;
4. affiche cette réponse dans une infobulle.

L'extension n'agit **que** sur les liens que vous survolez, et uniquement sur les sites où elle est activée.

## 2. Données stockées sur votre appareil

Ces données restent dans votre navigateur. Nous n'y avons pas accès.

| Donnée | Pourquoi | Protection | Durée |
|---|---|---|---|
| Clé API de votre fournisseur d'IA | Appeler le service d'IA en votre nom | Chiffrée (AES-GCM 256 bits) ; jamais réaffichée en entier | Jusqu'à sa suppression ou la désinstallation |
| Réglages (fournisseur, modèle, délai de survol, activation) | Fonctionnement de l'extension | - | Jusqu'à la désinstallation |
| Liste des sites d'actualité que vous avez ajoutés | Activer l'extension sur ces sites | - | Jusqu'à leur retrait ou la désinstallation |
| Compteur d'analyses du jour et statut Premium | Appliquer la limite de la version gratuite | Chiffrés | Renouvelé chaque jour |
| Réponses déjà obtenues (réponse, titre et adresse de l'article) | Réafficher instantanément une réponse sans nouvel appel | Gardées en mémoire, jamais écrites sur le disque, inaccessibles aux sites web | **Effacées à la fermeture du navigateur** |

L'extension ne conserve **aucun historique de navigation**.

## 3. Données transmises à des tiers

L'extension communique directement avec les services ci-dessous, sans passer par nous.

### a) Le site de l'article
Pour lire un article, l'extension télécharge sa page. Comme pour toute visite, le site reçoit votre adresse IP et des informations techniques de connexion. L'extension n'envoie **ni vos cookies, ni la page d'où vient le lien** : le site ne sait pas qui vous êtes, même si vous y avez un compte.

### b) Votre fournisseur d'intelligence artificielle
Selon votre choix dans les réglages, il s'agit d'**Anthropic** (Claude) ou d'**OpenAI**. À chaque analyse, l'extension lui envoie :
- le texte de l'article (12 000 caractères au maximum), son titre, sa description et son adresse ;
- le texte du lien survolé ;
- votre clé API, qui sert à vous authentifier auprès de ce fournisseur.

Ces données sont traitées selon la politique de confidentialité du fournisseur que vous avez choisi, avec lequel vous avez un compte :
- Anthropic : https://www.anthropic.com/legal/privacy
- OpenAI : https://openai.com/policies/privacy-policy

Aucune donnée personnelle vous concernant n'est ajoutée à ces requêtes par l'extension.

### c) ExtensionPay (abonnement Premium)
L'abonnement Premium est géré par **ExtensionPay** (extensionpay.com), et le paiement par **Stripe**. À l'installation, la date d'installation est enregistrée dans le stockage synchronisé de Chrome. Quand vous ouvrez la page Premium pour la première fois, un identifiant aléatoire est créé auprès d'ExtensionPay et enregistré au même endroit. À partir de là, l'extension interroge ExtensionPay (au plus toutes les 10 minutes) pour savoir si vous êtes abonné. Si vous souscrivez, ExtensionPay et Stripe reçoivent les informations que vous saisissez sur leur page de paiement (adresse e-mail, moyen de paiement). **Ces informations ne transitent jamais par l'extension** et nous ne les voyons pas.
- ExtensionPay : https://extensionpay.com/privacy
- Stripe : https://stripe.com/privacy

## 4. Ce que nous ne faisons pas

- Nous ne collectons, ne recevons et ne stockons aucune donnée sur nos propres serveurs : nous n'en avons pas.
- Nous ne vendons et ne louons aucune donnée.
- Nous n'utilisons aucun outil de statistiques, de publicité ou de pistage.
- Nous n'utilisons pas vos données pour évaluer votre solvabilité ou à toute autre fin que la fonction de l'extension.
- Nous ne lisons pas vos courriels, messages ou formulaires, ni le contenu des pages où vous êtes connecté.

## 5. Autorisations demandées par l'extension

| Autorisation | Usage |
|---|---|
| Stockage | Enregistrer vos réglages, votre clé chiffrée et le cache des réponses |
| Scripts sur les sites d'actualité ajoutés | Détecter le survol des liens sur les sites que **vous** avez choisis |
| Accès à X/Twitter et LinkedIn | Détecter le survol des liens sur ces plateformes |
| Accès aux sites HTTPS (facultatif, demandé par un clic) | Télécharger l'article derrière le lien survolé |
| Accès aux API d'Anthropic, d'OpenAI et d'ExtensionPay | Obtenir la réponse de l'IA et vérifier l'abonnement |

Vous pouvez retirer l'accès aux sites à tout moment, depuis les réglages de l'extension ou depuis `chrome://extensions`.

## 6. Vos droits et votre contrôle

- **Supprimer votre clé API** : bouton « Supprimer la clé » dans les réglages.
- **Désactiver l'extension** : interrupteur « Activer Anti-Bait » dans les réglages.
- **Tout effacer** : désinstaller l'extension supprime toutes les données stockées sur votre appareil. Le cache des réponses est de toute façon effacé à la fermeture du navigateur.
- **Données détenues par des tiers** : pour les données traitées par Anthropic, OpenAI, ExtensionPay ou Stripe, adressez-vous à eux (liens ci-dessus).

Si vous résidez dans l'Union européenne, vous disposez des droits prévus par le RGPD : accès, rectification, effacement, opposition, et réclamation auprès de la CNIL (www.cnil.fr). Nous ne détenons aucune donnée vous concernant, mais nous répondrons à toute question à l'adresse ci-dessous.

## 7. Sécurité

La clé API est chiffrée avec une clé que le navigateur interdit d'exporter. Les échanges avec les services tiers passent exclusivement par HTTPS. L'extension refuse de lire les adresses de réseaux locaux ou privés. Aucune méthode n'est infaillible : nous vous recommandons de créer une clé API réservée à l'extension, avec un plafond de dépenses chez votre fournisseur.

## 8. Mineurs

L'extension ne s'adresse pas aux enfants de moins de 15 ans et ne collecte sciemment aucune donnée les concernant.

## 9. Conformité au Chrome Web Store

L'utilisation des données par l'extension respecte la politique relative aux données utilisateur du Chrome Web Store, y compris ses exigences d'utilisation limitée (« Limited Use »). Les données servent uniquement à la fonction unique de l'extension : afficher la réponse cachée derrière un titre d'article survolé.

## 10. Modifications

Toute modification de cette politique sera publiée sur cette page, avec une nouvelle date de mise à jour. Si un changement important modifie l'usage de vos données, il sera signalé dans la description de l'extension sur le Chrome Web Store.

## 11. Contact

**[NOM DE L'ÉDITEUR]** : [ADRESSE E-MAIL DE CONTACT]
