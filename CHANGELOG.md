# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] - 2026-09-14

Première version publiée. Numérotée en `0.x` volontairement : la lecture est
vérifiée contre une centrale réelle, l'écriture et la sémantique des valeurs ne
le sont pas encore (voir « État du projet » dans le README). La forme de la
configuration peut donc encore évoluer sans passage en version majeure.

### Le plugin
- Réécriture native en plugin Homebridge du plugin Jeedom `TricomPlugIn`.
- Plateforme dynamique `Tricom` exposant chaque sortie EXO comme un accessoire HomeKit.
- Types d'accessoires : interrupteur (`switch`), lumière on/off (`light`) et variateur (`dimmer`).
- Client HTTP reproduisant les appels `allExosOutputsValues` (lecture) et `exoOutputValue` (écriture).
- Interrogation périodique de l'état de la centrale (intervalle configurable), tolérante à une centrale momentanément injoignable.
- Détection des erreurs applicatives de la centrale : la TriCom répond `HTTP 200` avec un corps texte `ERROR <code>` — jamais un 401 ou un 403. Le client lève une `TricomServerError` typée portant le code et l'opération en échec, et une écriture refusée remonte comme un échec à HomeKit. Le plugin Jeedom d'origine ne testait pas ce cas : sa garde `is_json` était inopérante et une clé refusée finissait en erreur PHP dans sa boucle cron.
- Journalisation utile sans mode debug : le premier échec d'interrogation passe en `warn` — ou en `error` avec l'explication du code quand la centrale refuse la requête — puis retombe en `debug` pour ne pas inonder le journal ; le retour de la centrale est signalé.
- Schéma de configuration `config.schema.json` pour Homebridge Config UI X.
- Compatible Homebridge 1.8+ et 2.x, Node 18 / 20 / 22 / 24.

### L'outil de diagnostic
- Commande `tricom-probe` livrée avec le plugin, pour interroger une centrale sans passer par Homebridge :
  - état de toutes les sorties sous forme de tableau ;
  - `--watch` : suit les changements en direct et, à l'arrêt par Ctrl+C, produit un bloc `accessories` limité aux sorties ayant bougé. Les types sont déduits de l'observation et non devinés — deux états donnent un interrupteur avec son `onValue` réel, plusieurs niveaux donnent un variateur dont l'échelle se déduit des valeurs atteintes. C'est la méthode recommandée, la centrale exposant tout son espace d'adressage (16 modules EXO × 8 sorties) qu'un équipement soit câblé ou non ;
  - `--config` : bloc déduit d'une lecture simple, avec un avertissement quand toutes les sorties sont à 0 ;
  - `--codes` : compare les réponses de la centrale à plusieurs clés et à un endpoint inconnu, puis conclut — AnB-Rimex ne publiant pas la table de ses codes `ERROR`. Lectures seules ;
  - `--set 2:1=128` : écriture d'une valeur de test, pour déterminer l'échelle d'un variateur ;
  - `--json` : sortie JSON brute.

### Documentation
- Section « La clé API » : d'où vient la clé, pourquoi elle se saisit dans le logiciel TRINITY d'AnB-Rimex, la limite historique de 50 caractères, et ce qu'on a pu établir de `ERROR 9001` en le mesurant sur une centrale réelle — clé absente, trop courte, fausse en 50 ou en 64 caractères donnent toutes le même code, qui signifie donc « clé non reconnue » sans distinction de longueur. Un endpoint inconnu renvoie la page d'accueil du serveur sans vérifier la clé, ce qui donne un test de vie sans clé.
- Sections « État du projet », « Trouver ses sorties », « Dépannage » et « Contribuer ».

### Qualité et outillage
- 118 tests (vitest) couvrant le client HTTP, la plateforme, les accessoires et l'outil de diagnostic, avec un faux serveur Tricom et un HAP simulé — aucune centrale requise pour les lancer.
- ESLint (configuration plate, typescript-eslint) et script `npm run check` reproduisant la CI en local.
- CI GitHub Actions : lint, build et tests sur Node 18 / 20 / 22 / 24, plus vérification du contenu du paquet npm.
- Workflow de publication npm déclenché par un tag `v*`, avec contrôle de cohérence entre le tag et `package.json`.
- Modèles d'issues GitHub (bug, fonctionnalité).
