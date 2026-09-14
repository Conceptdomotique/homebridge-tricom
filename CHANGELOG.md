# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Corrigé
- Les erreurs applicatives de la centrale sont enfin détectées. La TriCom répond `HTTP 200` avec un corps texte `ERROR <code>` — jamais un 401 ou un 403 — si bien qu'une clé API refusée se manifestait par un obscur « Invalid JSON from Tricom ». Le client lève désormais une `TricomServerError` typée portant le code, et le message cite l'opération en échec. (Le plugin Jeedom d'origine ne testait pas ce cas non plus : sa garde `is_json` était inopérante et la clé refusée finissait en erreur PHP dans la boucle cron.)
- Une écriture refusée par la centrale remonte maintenant comme un échec à HomeKit, au lieu d'être silencieusement ignorée.

### Ajouté
- `tricom-probe --watch` construit la configuration à l'arrêt. La centrale expose tout son espace d'adressage (16 modules EXO × 8 sorties) qu'un équipement soit câblé ou non, si bien qu'une lecture simple ne dit pas quelles sorties existent. Le mode suivi enregistre désormais les valeurs prises par chaque sortie qui bouge et, à la sortie par Ctrl+C, produit un bloc `accessories` limité à celles-ci. Les types ne sont plus devinés mais déduits : deux états observés donnent un interrupteur — avec son `onValue` réel s'il ne vaut pas 255 —, plusieurs niveaux donnent un variateur dont l'échelle se déduit des valeurs atteintes.
- `--config` prévient quand toutes les sorties lues sont à 0 : le bloc produit ne distingue alors ni les sorties existantes ni leur type, et `--watch` est la bonne méthode.
- `tricom-probe --codes` : compare les réponses de la centrale à plusieurs clés (fournie, absente, trop courte, fausse en 50 et 64 caractères) et à un endpoint inconnu, pour déterminer empiriquement ce que ses codes `ERROR` distinguent — AnB-Rimex n'en publie pas la table. Lectures seules, aucune écriture.
- `--codes` interprète le tableau au lieu de le laisser brut : il conclut si le serveur HTTP est actif, si la centrale distingue plusieurs causes de refus, et ce qu'il reste à faire.
- Section « La clé API » dans le README : d'où vient la clé, pourquoi elle se saisit dans le logiciel TRINITY d'AnB-Rimex, la limite historique de 50 caractères, et ce qu'on a pu établir de `ERROR 9001` en le mesurant sur une centrale réelle (clé absente, trop courte, fausse en 50 ou en 64 caractères : même code — il signifie « clé non reconnue », sans distinction de longueur). Un endpoint inconnu renvoie la page d'accueil du serveur sans vérifier la clé, ce qui donne un test de vie sans clé.

### Modifié
- Le premier échec d'interrogation est journalisé en `warn` (et en `error` avec l'explication du code quand la centrale refuse la requête) plutôt qu'en `debug` : une erreur de configuration est visible sans activer le mode debug. Les échecs suivants retombent en `debug` pour ne pas inonder le journal, et le retour de la centrale est signalé.

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
