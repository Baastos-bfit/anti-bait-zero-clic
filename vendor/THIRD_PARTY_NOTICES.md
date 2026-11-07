# Composants tiers

## ExtPay (ExtensionPay) 3.1.2

- **Fichier** : `vendor/ExtPay.js`, copie **non modifiée** de `dist/ExtPay.js` du paquet npm `extpay@3.1.2`
- **SHA-256** : `ec38f20eeea04502e68e99b939fe0e188045bf68cabe605080cdad79c7fae15a`
- **Source** : https://github.com/Glench/ExtPay
- **Inclut** : `webextension-polyfill` (Mozilla, MPL-2.0), intégré par ExtPay dans son fichier de distribution
- **Licence déclarée** : **LGPL-3.0** (fichier `LICENSE` du dépôt officiel, recopié dans `vendor/ExtPay.LICENSE`)
- **Textes de licence** : `vendor/licenses/LGPL-3.0.txt` et `vendor/licenses/GPL-3.0.txt`

### Conformité LGPL-3.0

ExtPay est utilisé comme **bibliothèque distincte**. Il est chargé tel quel depuis un fichier séparé (`importScripts`) : il n'est ni modifié, ni fusionné, ni minifié avec le code d'Anti-Bait, et l'utilisateur peut le remplacer par une autre version. Cet avis et les textes de licence sont fournis avec l'extension.

### ⚠️ Incohérence à faire lever avant publication

Le dépôt d'ExtPay se contredit :

| Emplacement | Licence indiquée |
|---|---|
| Fichier `LICENSE` du dépôt GitHub | LGPL-3.0 |
| Champ `license` du paquet npm | AGPL-3.0-or-later |
| Commentaire dans `dist/ExtPay.js` | « AGPLv3 licensed » |

Avec la **LGPL-3.0**, l'intégration actuelle est compatible avec une distribution commerciale propriétaire. Avec l'**AGPL-3.0**, l'extension pourrait devoir être distribuée elle-même sous AGPL.

**Action recommandée** : demander à ExtensionPay (via le support de extensionpay.com ou une issue GitHub) une confirmation écrite que la LGPL-3.0 s'applique. Conservez la réponse avec ce fichier.
