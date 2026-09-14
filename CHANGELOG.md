# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [1.0.0] - 2026-09-14

### Ajouté
- Première version : réécriture native en plugin Homebridge du plugin Jeedom `TricomPlugIn`.
- Plateforme dynamique `Tricom` exposant chaque sortie EXO comme un accessoire HomeKit.
- Types d'accessoires : interrupteur (`switch`), lumière on/off (`light`) et variateur (`dimmer`).
- Client HTTP reproduisant les appels `allExosOutputsValues` (lecture) et `exoOutputValue` (écriture).
- Interrogation périodique de l'état de la centrale (intervalle configurable).
- Schéma de configuration `config.schema.json` pour Homebridge Config UI X.
