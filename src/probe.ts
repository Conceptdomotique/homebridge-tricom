#!/usr/bin/env node
/**
 * tricom-probe — outil de diagnostic en ligne de commande.
 *
 * Interroge directement le serveur « jeedom » d'une centrale Tricom, sans
 * passer par Homebridge. Sert à trouver l'adresse EXO et le numéro de sortie
 * de chaque équipement, à vérifier l'échelle des valeurs d'un variateur, et
 * à produire un bloc de configuration prêt à coller.
 *
 * Usage :
 *   tricom-probe --ip 192.168.1.50 --apikey CLE [--port 9000]
 *   tricom-probe ... --watch          suit les changements en direct
 *   tricom-probe ... --config         génère le bloc "accessories"
 *   tricom-probe ... --set 1:2=255    écrit une valeur sur une sortie
 */

import { TricomClient, ExoValues, TricomServerError, describeErrorCode } from './tricomClient';

interface Options {
  ip: string;
  port: number;
  apikey: string;
  timeout: number;
  watch: boolean;
  config: boolean;
  json: boolean;
  codes: boolean;
  set?: { exo: string; output: string; value: number };
  interval: number;
}

const USAGE = `
tricom-probe — diagnostic d'une centrale Tricom

Usage :
  tricom-probe --ip <adresse> --apikey <cle> [options]

Options :
  --ip <adresse>        Adresse IP de la centrale            (requis)
  --apikey <cle>        Clé API du serveur Tricom            (requis)
  --port <n>            Port du serveur jeedom               (défaut 9000)
  --timeout <s>         Timeout HTTP en secondes             (défaut 5)
  --interval <s>        Intervalle en mode --watch           (défaut 1)
  --watch               Suit les changements en direct (Ctrl+C pour quitter)
  --config              Affiche un bloc "accessories" prêt à coller
  --json                Sort le JSON brut de la centrale
  --codes               Compare les réponses de la centrale à plusieurs clés,
                        pour identifier ce que signifient ses codes ERROR
  --set <exo:sortie=v>  Écrit une valeur, puis relit l'état
  -h, --help            Affiche cette aide

Exemples :
  tricom-probe --ip 192.168.1.50 --apikey ABC123
  tricom-probe --ip 192.168.1.50 --apikey ABC123 --watch
  tricom-probe --ip 192.168.1.50 --apikey ABC123 --codes
  tricom-probe --ip 192.168.1.50 --apikey ABC123 --set 1:2=255
`.trim();

/** Logger minimal compatible avec l'interface Logger de Homebridge. */
const consoleLog = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
  debug: () => undefined,
  log: (m: string) => console.log(m),
  success: (m: string) => console.log(m),
};

export function parseArgs(argv: string[]): Options | 'help' {
  const opts: Options = {
    ip: '', port: 9000, apikey: '', timeout: 5,
    watch: false, config: false, json: false, codes: false, interval: 1,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    switch (arg) {
      case '-h':
      case '--help':
        return 'help';
      case '--ip':
        opts.ip = next();
        break;
      case '--port':
        opts.port = Number(next());
        break;
      case '--apikey':
        opts.apikey = next();
        break;
      case '--timeout':
        opts.timeout = Number(next());
        break;
      case '--interval':
        opts.interval = Number(next());
        break;
      case '--watch':
        opts.watch = true;
        break;
      case '--config':
        opts.config = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--codes':
        opts.codes = true;
        break;
      case '--set': {
        const spec = next();
        const m = /^(\d+)[:.](\d+)=(-?\d+)$/.exec(spec ?? '');
        if (!m) {
          throw new Error(`--set attend la forme exo:sortie=valeur (reçu "${spec}")`);
        }
        opts.set = { exo: m[1], output: m[2], value: Number(m[3]) };
        break;
      }
      default:
        throw new Error(`Option inconnue : ${arg}`);
    }
  }

  if (!opts.ip) {
    throw new Error('--ip est requis');
  }
  if (!opts.apikey) {
    throw new Error('--apikey est requis');
  }
  return opts;
}

/** Aplatit la carte imbriquée en une liste triée de sorties. */
export function flatten(values: ExoValues): { exo: string; output: string; value: number }[] {
  const rows: { exo: string; output: string; value: number }[] = [];
  for (const exo of Object.keys(values).sort((a, b) => Number(a) - Number(b))) {
    const outputs = values[exo] ?? {};
    for (const output of Object.keys(outputs).sort((a, b) => Number(a) - Number(b))) {
      rows.push({ exo, output, value: Number(outputs[output]) });
    }
  }
  return rows;
}

/** Devine le type d'accessoire le plus probable à partir de la valeur lue. */
export function guessType(value: number): 'switch' | 'dimmer' {
  return value > 0 && value !== 255 && value !== 1 ? 'dimmer' : 'switch';
}

export function renderTable(values: ExoValues): string {
  const rows = flatten(values);
  if (rows.length === 0) {
    return 'La centrale n\'a renvoyé aucune sortie.';
  }

  const lines = [
    '  EXO  Sortie   Valeur  État',
    '  ---  ------   ------  ----',
  ];
  for (const r of rows) {
    lines.push(
      '  ' + r.exo.padStart(3) +
      '  ' + r.output.padStart(6) +
      '   ' + String(r.value).padStart(6) +
      '  ' + (r.value > 0 ? 'ON' : 'off'),
    );
  }
  lines.push('');
  lines.push(`  ${rows.length} sortie(s) sur ${Object.keys(values).length} module(s) EXO.`);
  return lines.join('\n');
}

/** Bloc "accessories" prêt à coller dans le config.json de Homebridge. */
export function renderConfig(values: ExoValues): string {
  const accessories = flatten(values).map(r => {
    const type = guessType(r.value);
    const base: Record<string, unknown> = {
      name: `EXO${r.exo} sortie ${r.output}`,
      type,
      exoAddress: Number(r.exo),
      outputNbr: Number(r.output),
    };
    if (type === 'dimmer') {
      base.maxValue = r.value > 100 ? 255 : 100;
    }
    return base;
  });
  return JSON.stringify({ accessories }, null, 2);
}

/** Différences entre deux relevés, pour le mode --watch. */
export function diff(previous: ExoValues, current: ExoValues): string[] {
  const changes: string[] = [];
  const keys = new Set([...flatten(previous), ...flatten(current)].map(r => `${r.exo}:${r.output}`));

  for (const key of [...keys].sort()) {
    const [exo, output] = key.split(':');
    const before = previous[exo]?.[output];
    const after = current[exo]?.[output];
    if (before === after) {
      continue;
    }
    changes.push(
      `EXO ${exo} sortie ${output} : ${before ?? '—'} → ${after ?? '—'}` +
      (after !== undefined ? `  (${Number(after) > 0 ? 'ON' : 'off'})` : ''),
    );
  }
  return changes;
}

/** Une clé factice de longueur donnée, pour distinguer « clé fausse » de « clé trop longue ». */
export function dummyKey(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  while (s.length < length) {
    s += chars[s.length % chars.length];
  }
  return s;
}

/**
 * AnB-Rimex ne publie pas la table des codes ERROR de la TriCom. Ce mode
 * compare les réponses de la centrale à plusieurs clés de longueurs et de
 * validités différentes : si les codes diffèrent, on apprend ce qu'ils
 * distinguent. Lectures uniquement — rien n'est écrit sur la centrale.
 */
export async function probeErrorCodes(
  opts: Pick<Options, 'ip' | 'port' | 'apikey' | 'timeout'>,
): Promise<CodeProbeResult[]> {
  const cases: { label: string; apikey: string; path: string; kind: CodeProbeKind }[] = [
    { label: 'clé fournie', apikey: opts.apikey, path: '/allExosOutputsValues', kind: 'key' },
    { label: 'clé absente (vide)', apikey: '', path: '/allExosOutputsValues', kind: 'key' },
    { label: 'clé courte (4 car.)', apikey: 'test', path: '/allExosOutputsValues', kind: 'key' },
    { label: 'clé fausse, 50 car.', apikey: dummyKey(50), path: '/allExosOutputsValues', kind: 'key' },
    { label: 'clé fausse, 64 car.', apikey: dummyKey(64), path: '/allExosOutputsValues', kind: 'key' },
    // Un endpoint inconnu avec la clé fournie : distingue « clé refusée »
    // de « requête refusée », et prouve que le serveur répond.
    { label: 'endpoint inconnu', apikey: opts.apikey, path: '/endpointInexistant', kind: 'route' },
  ];

  const results: CodeProbeResult[] = [];
  for (const c of cases) {
    const client = new TricomClient(
      opts.ip, opts.port, c.apikey, opts.timeout * 1000, consoleLog as never,
    );
    try {
      results.push({ label: c.label, kind: c.kind, answer: (await client.raw(c.path)).slice(0, 60) });
    } catch (e) {
      results.push({ label: c.label, kind: c.kind, answer: `échec réseau : ${(e as Error).message}` });
    }
  }
  return results;
}

export type CodeProbeKind = 'key' | 'route';

export interface CodeProbeResult {
  label: string;
  kind: CodeProbeKind;
  answer: string;
}

/**
 * Turns the raw table into a conclusion. Three signals matter:
 *  - the unknown route answering something other than ERROR means the HTTP
 *    server is alive and only the keyed endpoints are gated;
 *  - every key variant giving the same code means the central does not
 *    distinguish a missing key from a wrong one, nor by length;
 *  - the supplied key succeeding means there is nothing left to diagnose.
 */
export function interpretErrorCodes(results: CodeProbeResult[]): string[] {
  const keys = results.filter(r => r.kind === 'key');
  const routes = results.filter(r => r.kind === 'route');
  if (keys.length === 0) {
    return [];
  }

  const errorOf = (answer: string) => /ERROR\s+(\d+)/i.exec(answer)?.[1];
  const supplied = keys[0];
  const notes: string[] = [];

  if (!errorOf(supplied.answer) && !supplied.answer.includes('échec réseau')) {
    notes.push('La clé fournie est acceptée : rien à corriger de ce côté.');
    return notes;
  }

  const serverAlive = routes.some(r => !errorOf(r.answer) && !r.answer.includes('échec réseau'));
  if (serverAlive) {
    notes.push(
      'Le serveur HTTP de la centrale est bien actif : un endpoint inconnu répond '
      + 'normalement. Seuls les endpoints protégés refusent la requête.',
    );
  }

  const codes = new Set(keys.map(r => errorOf(r.answer)).filter(Boolean));
  if (codes.size === 1) {
    const [code] = [...codes];
    notes.push(
      `Les cinq clés testées donnent toutes ERROR ${code}, quelle que soit leur `
      + 'longueur : la centrale ne distingue ni l\'absence de clé, ni sa taille. '
      + 'Ce code signifie simplement « clé non reconnue ».',
    );
    notes.push(
      'Il faut donc programmer la clé attendue dans le logiciel TRINITY '
      + 'd\'AnB-Rimex, côté centrale, puis la reporter dans la configuration.',
    );
  } else if (codes.size > 1) {
    notes.push(
      `Les clés testées donnent ${codes.size} codes différents (${[...codes].join(', ')}) : `
      + 'la centrale distingue plusieurs causes de refus — comparez avec les longueurs.',
    );
  }

  return notes;
}

export function renderErrorCodes(results: CodeProbeResult[]): string {
  const lines = [
    '  Cas                    Réponse',
    '  ---                    -------',
  ];
  for (const r of results) {
    lines.push('  ' + r.label.padEnd(22) + ' ' + r.answer);
  }

  lines.push('');
  lines.push('  Chaque ligne montre le code HTTP suivi du corps de la réponse.');
  for (const note of interpretErrorCodes(results)) {
    lines.push('');
    lines.push('  ' + note);
  }
  lines.push('');
  lines.push('  Aucune écriture n\'a été faite sur la centrale.');
  return lines.join('\n');
}

async function main(): Promise<number> {
  let opts: Options | 'help';
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}\n`);
    console.error(USAGE);
    return 2;
  }

  if (opts === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (opts.codes) {
    console.log(`Centrale http://${opts.ip}:${opts.port} — comparaison des réponses\n`);
    console.log(renderErrorCodes(await probeErrorCodes(opts)));
    return 0;
  }

  const client = new TricomClient(
    opts.ip, opts.port, opts.apikey, opts.timeout * 1000, consoleLog as never,
  );

  if (opts.set) {
    const { exo, output, value } = opts.set;
    console.log(`→ écriture EXO ${exo} sortie ${output} = ${value}`);
    await client.setOutput(exo, output, value);
    await new Promise(r => setTimeout(r, 500));
    console.log('← relecture :\n');
    console.log(renderTable(await client.getAllValues()));
    return 0;
  }

  const values = await client.getAllValues();

  if (opts.json) {
    console.log(JSON.stringify(values, null, 2));
    return 0;
  }

  if (opts.config) {
    console.log('// À coller dans la plateforme Tricom de votre config.json :');
    console.log(renderConfig(values));
    return 0;
  }

  console.log(`Centrale http://${opts.ip}:${opts.port}\n`);
  console.log(renderTable(values));

  if (opts.watch) {
    console.log('\nMode suivi — actionnez un équipement pour repérer sa sortie. Ctrl+C pour quitter.\n');
    let previous = values;
    const timer = setInterval(async () => {
      try {
        const current = await client.getAllValues();
        for (const line of diff(previous, current)) {
          console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
        }
        previous = current;
      } catch (e) {
        console.error(`Lecture échouée : ${(e as Error).message}`);
      }
    }, Math.max(0.2, opts.interval) * 1000);

    await new Promise<void>(resolve => {
      process.on('SIGINT', () => {
        clearInterval(timer);
        console.log('\nArrêt.');
        resolve();
      });
    });
  }

  return 0;
}

// Ne s'exécute que lancé directement, pas à l'import (tests).
if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(e => {
      if (e instanceof TricomServerError) {
        console.error(`La centrale a refusé la requête : ERROR ${e.code}`);
        console.error(`→ ${describeErrorCode(e.code)}`);
        console.error('');
        console.error('La clé API se saisit côté centrale, dans le logiciel de');
        console.error('programmation TRINITY d\'AnB-Rimex — ce n\'est pas le plugin qui');
        console.error('la génère. Utilisez --codes pour comparer les réponses de la');
        console.error('centrale à plusieurs clés et cerner ce que le code signifie.');
      } else {
        console.error(`Échec : ${(e as Error).message}`);
        console.error('Vérifiez l\'adresse IP, le port et la clé API.');
      }
      process.exit(1);
    });
}
