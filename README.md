# homebridge-tricom

[![build](https://github.com/Conceptdomotique/homebridge-tricom/actions/workflows/build.yml/badge.svg)](https://github.com/Conceptdomotique/homebridge-tricom/actions/workflows/build.yml)
[![npm](https://img.shields.io/npm/v/homebridge-tricom.svg)](https://www.npmjs.com/package/homebridge-tricom)
[![licence](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](./LICENSE)

Plugin [Homebridge](https://homebridge.io) qui expose dans HomeKit les sorties d'une centrale domotique **Tricom**. Il s'agit d'une réécriture native (Node.js / TypeScript) du plugin Jeedom [`TricomPlugIn`](https://github.com/anb-rimex/TricomPlugIn) : la logique de dialogue avec la centrale est reprise telle quelle, mais l'interface Jeedom (PHP, base de données, widgets) est remplacée par le modèle d'accessoires HomeKit.

## Comment ça marche

Le plugin Jeedom communiquait avec un serveur HTTP « jeedom » exposé par la Tricom via deux appels, que ce plugin reproduit à l'identique :

- **Lecture de l'état de toutes les sorties** : `GET http://<ip>:<port>/jeedom/allExosOutputsValues?apikey=<clé>` qui renvoie un JSON de la forme `{ "<adresseEXO>": { "<numéroSortie>": <valeur> } }`.
- **Écriture d'une sortie** : `GET http://<ip>:<port>/jeedom/exoOutputValue?exo=<adresseEXO>&output=<numéroSortie>&value=<valeur>&apikey=<clé>`.

Chaque équipement du plugin Jeedom correspondait à une sortie d'un module « EXO », identifiée par une adresse EXO et un numéro de sortie. Ici, chaque sortie devient un accessoire HomeKit : un interrupteur (`Switch`), une lumière on/off (`Lightbulb`) ou un variateur (`Lightbulb` + luminosité).

Le plugin interroge la centrale à intervalle régulier (5 s par défaut) pour tenir HomeKit à jour, exactement comme le faisait le `cron` du plugin Jeedom.

## Installation

```bash
npm install -g homebridge-tricom
```

Ou, depuis les sources :

```bash
npm install
npm run build
```

## Trouver ses sorties avec `tricom-probe`

Le plugin ne peut pas découvrir les équipements tout seul : la centrale n'expose pas de liste, il faut déclarer chaque sortie à la main. L'outil `tricom-probe`, installé avec le plugin, sert à repérer quelle sortie correspond à quel équipement.

```bash
# État de toutes les sorties de la centrale
npx tricom-probe --ip 192.168.1.50 --apikey VOTRE_CLE
```

```
Centrale http://192.168.1.50:9000

  EXO  Sortie   Valeur  État
  ---  ------   ------  ----
    1       1        0  off
    1       2      255  ON
    2       1       40  ON

  3 sortie(s) sur 2 module(s) EXO.
```

**Mode suivi** — le plus pratique sur site : lancez le suivi, puis actionnez physiquement un interrupteur. La ligne qui bouge vous donne l'adresse EXO et le numéro de sortie à mettre dans la configuration.

```bash
npx tricom-probe --ip 192.168.1.50 --apikey VOTRE_CLE --watch
```

```
[14:32:07] EXO 1 sortie 2 : 255 → 0  (off)
[14:32:11] EXO 2 sortie 1 : 40 → 80  (ON)
```

**Bloc de configuration** — génère un `accessories` prêt à coller, avec un type deviné d'après les valeurs lues (une sortie à 40 est supposée variable, une sortie à 0/1/255 est supposée tout-ou-rien). À relire et à renommer, évidemment.

```bash
npx tricom-probe --ip 192.168.1.50 --apikey VOTRE_CLE --config
```

**Écrire une valeur** — pour vérifier l'échelle d'un variateur sans passer par HomeKit :

```bash
npx tricom-probe --ip 192.168.1.50 --apikey VOTRE_CLE --set 2:1=128
```

Si la sortie s'allume à mi-puissance, l'échelle est 0–255 (`maxValue: 255`). Si elle est à fond, l'échelle est 0–100 (`maxValue: 100`).

Toutes les options : `npx tricom-probe --help`.

## Configuration

Le plus simple est de passer par l'interface **Homebridge Config UI X** (le formulaire est fourni par `config.schema.json`). Sinon, ajoutez une plateforme dans votre `config.json` (voir aussi [`config.sample.json`](./config.sample.json)) :

```json
{
  "platforms": [
    {
      "platform": "Tricom",
      "name": "Tricom",
      "ip": "192.168.1.50",
      "port": 9000,
      "apikey": "VOTRE_CLE_API",
      "pollInterval": 5,
      "timeout": 5,
      "accessories": [
        {
          "name": "Plafonnier salon",
          "type": "light",
          "exoAddress": 1,
          "outputNbr": 1
        },
        {
          "name": "Prise bureau",
          "type": "switch",
          "exoAddress": 1,
          "outputNbr": 2
        },
        {
          "name": "Éclairage cuisine",
          "type": "dimmer",
          "exoAddress": 2,
          "outputNbr": 1,
          "maxValue": 100
        }
      ]
    }
  ]
}
```

### Paramètres de la plateforme

| Clé | Requis | Défaut | Description |
| --- | --- | --- | --- |
| `ip` | oui | `127.0.0.1` | Adresse IP de la centrale Tricom |
| `port` | oui | `9000` | Port du serveur « jeedom » de la Tricom |
| `apikey` | oui | — | Clé API attendue par le serveur (équivalent de `jeedom::getApiKey()`) |
| `pollInterval` | non | `5` | Intervalle d'interrogation en secondes (min. 2) |
| `timeout` | non | `5` | Timeout des requêtes HTTP en secondes |
| `accessories` | oui | — | Liste des sorties à exposer |

### Paramètres d'un accessoire

| Clé | Requis | Défaut | Description |
| --- | --- | --- | --- |
| `name` | oui | — | Nom affiché dans HomeKit |
| `type` | oui | `switch` | `switch`, `light` ou `dimmer` |
| `exoAddress` | oui | — | Adresse du module EXO |
| `outputNbr` | oui | — | Numéro de la sortie sur ce module |
| `onValue` | non | `255` | Valeur envoyée à l'allumage (interrupteur / lumière). Le template Jeedom utilisait `255`. |
| `maxValue` | non | `100` | Valeur correspondant à 100 % de luminosité (variateur) |

## Note importante sur les valeurs

Dans le plugin Jeedom, l'allumage d'un interrupteur envoyait la valeur `255` et l'extinction `0` ; l'état était considéré « allumé » dès que la valeur lue était supérieure à 0. Ce comportement est repris tel quel.

Pour les **variateurs**, la correspondance entre le pourcentage de luminosité HomeKit (0–100 %) et la valeur brute envoyée à la Tricom dépend de votre matériel. Par défaut, `maxValue` vaut `100` (mapping direct 0–100). Si vos sorties de variation attendent une échelle 0–255, réglez `maxValue` à `255`. Ajustez ce paramètre en observant les valeurs renvoyées par `allExosOutputsValues`.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| Les accessoires restent « Sans réponse » dans HomeKit | La centrale est injoignable ou la clé API est refusée. Vérifiez avec `tricom-probe` : il utilise exactement les mêmes appels que le plugin. |
| Un accessoire ne réagit pas | Mauvais couple adresse EXO / numéro de sortie. Utilisez `--watch` et actionnez l'équipement pour retrouver le bon. |
| Un variateur saute à 100 % dès qu'on le bouge | L'échelle ne correspond pas. Essayez `maxValue: 255` (ou testez avec `--set`). |
| Un interrupteur s'allume mais HomeKit le croit éteint | La centrale renvoie 0 pour cette sortie. Vérifiez la valeur lue avec `tricom-probe`. |
| Journal muet | Activez le mode debug dans Homebridge : le plugin trace chaque écriture et chaque échec d'interrogation. |

## Développement

```bash
npm install          # installe les dépendances
npm run build        # compile TypeScript -> dist/
npm run watch        # recompilation à la volée
npm run lint         # ESLint
npm test             # suite de tests (vitest)
npm run test:coverage  # tests + couverture
npm run check        # lint + build + tests, comme la CI
```

Les tests tournent contre un faux serveur Tricom et un HAP simulé : aucune centrale n'est nécessaire pour les lancer.

## Contribuer

Les rapports de bug et les demandes de fonctionnalité passent par les [issues GitHub](https://github.com/Conceptdomotique/homebridge-tricom/issues). Joignez la sortie de `tricom-probe` : c'est ce qui permet de savoir ce que la centrale renvoie réellement.

## Différences avec le plugin Jeedom

Ce qui a été repris : la couche de communication HTTP avec la centrale, le modèle adresse EXO + numéro de sortie, la sémantique des valeurs (255 / 0, état binaire, niveau de variation), et l'interrogation périodique de l'état.

Ce qui a été abandonné (spécifique à Jeedom, sans équivalent HomeKit) : l'interface web de configuration, la base de données et l'historique, les scénarios, le daemon socket `demond.py` (qui était un simple squelette de template), et toute la couche PHP côté serveur.

## Licence

[AGPL-3.0](./LICENSE), comme le plugin Jeedom d'origine.
