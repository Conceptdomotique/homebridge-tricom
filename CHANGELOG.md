# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [1.0.0] - 2026-09-14

Première version publiée.

### Le plugin
- Réécriture native en plugin Homebridge du plugin Jeedom `TricomPlugIn`.
- Plateforme dynamique `Tricom` exposant chaque sortie EXO comme un accessoire HomeKit.
- Types d'accessoires : interrupteur (`switch`), lumière on/off (`light`) et variateur (`dimmer`).
- Client HTTP reproduisant les appels `allExosOutputsValues` (lecture) et `exoOutputValue` (écriture).
- Interrogation périodique de l'état de la centrale (intervalle configurable), tolérante à une centrale momentanément injoignable.
- Schéma de configuration `config.schema.json` pour Homebridge Config UI X.
- Compatible Homebridge 1.8+ et 2.x, Node 18 / 20 / 22.

### L'outil de diagnostic
- Commande `tricom-probe` livrée avec le plugin, pour interroger une centrale sans passer par Homebridge :
  - état de toutes les sorties sous forme de tableau ;
  - mode suivi (`--watch`) : affiche les changements en direct, pour repérer une sortie en actionnant l'équipement ;
  - génération d'un bloc `accessories` prêt à coller (`--config`), avec type deviné d'après les valeurs lues ;
  - écriture d'une valeur de test (`--set 2:1=128`), pour déterminer l'échelle d'un variateur ;
  - sortie JSON brute (`--json`).

### Qualité et outillage
- Suite de tests (vitest) couvrant le client HTTP, la plateforme, les accessoires et l'outil de diagnostic, avec un faux serveur Tricom et un HAP simulé — aucune centrale requise pour les lancer.
- ESLint (configuration plate, typescript-eslint) et script `npm run check` reproduisant la CI en local.
- CI GitHub Actions : lint, build et tests sur Node 18 / 20 / 22, plus vérification du contenu du paquet npm.
- Workflow de publication npm déclenché par un tag `v*`, avec contrôle de cohérence entre le tag et `package.json`.
- Modèles d'issues GitHub (bug, fonctionnalité).
