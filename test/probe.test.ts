import { afterEach, describe, expect, it } from 'vitest';

import {
  CodeProbeResult, Observations, configAdvice, describeObserved, diff, dummyKey,
  flatten, guessType, interpretErrorCodes, observedConfig, parseArgs,
  probeErrorCodes, recordChanges, renderConfig, renderErrorCodes, renderTable,
} from '../src/probe';
import { startMockTricom, MockTricomServer } from './helpers/tricomServer';

describe('parseArgs', () => {
  it('reads the required connection options', () => {
    const o = parseArgs(['--ip', '192.168.1.50', '--apikey', 'ABC']);
    expect(o).toMatchObject({ ip: '192.168.1.50', apikey: 'ABC', port: 9000, timeout: 5 });
  });

  it('accepts an explicit port and timeout', () => {
    const o = parseArgs(['--ip', '10.0.0.1', '--apikey', 'k', '--port', '8080', '--timeout', '2']);
    expect(o).toMatchObject({ port: 8080, timeout: 2 });
  });

  it('recognises the flag options', () => {
    const o = parseArgs(['--ip', '1.2.3.4', '--apikey', 'k', '--watch', '--json']);
    expect(o).toMatchObject({ watch: true, json: true, config: false, codes: false });
  });

  it('recognises the error-code mapping mode', () => {
    const o = parseArgs(['--ip', '1.2.3.4', '--apikey', 'k', '--codes']);
    expect(o).toMatchObject({ codes: true });
  });

  it('returns help for -h and --help', () => {
    expect(parseArgs(['-h'])).toBe('help');
    expect(parseArgs(['--help'])).toBe('help');
  });

  it('parses a --set specification', () => {
    const o = parseArgs(['--ip', '1.2.3.4', '--apikey', 'k', '--set', '2:3=128']);
    expect(o).toMatchObject({ set: { exo: '2', output: '3', value: 128 } });
  });

  it('rejects a malformed --set specification', () => {
    expect(() => parseArgs(['--ip', '1.2.3.4', '--apikey', 'k', '--set', 'oops']))
      .toThrow(/exo:sortie=valeur/);
  });

  it('requires an ip and an apikey', () => {
    expect(() => parseArgs(['--apikey', 'k'])).toThrow(/--ip/);
    expect(() => parseArgs(['--ip', '1.2.3.4'])).toThrow(/--apikey/);
  });

  it('rejects an unknown option', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Option inconnue/);
  });
});

describe('flatten', () => {
  it('sorts outputs numerically, not as strings', () => {
    const rows = flatten({ '10': { '2': 1 }, '2': { '10': 1, '1': 0 } });
    expect(rows.map(r => `${r.exo}:${r.output}`)).toEqual(['2:1', '2:10', '10:2']);
  });

  it('coerces string values to numbers', () => {
    const rows = flatten({ '1': { '1': '64' as unknown as number } });
    expect(rows[0].value).toBe(64);
  });

  it('returns nothing for an empty reading', () => {
    expect(flatten({})).toEqual([]);
  });
});

describe('guessType', () => {
  it('treats 0, 1 and 255 as on/off outputs', () => {
    expect(guessType(0)).toBe('switch');
    expect(guessType(1)).toBe('switch');
    expect(guessType(255)).toBe('switch');
  });

  it('treats an intermediate level as a dimmer', () => {
    expect(guessType(40)).toBe('dimmer');
    expect(guessType(128)).toBe('dimmer');
  });
});

describe('renderTable', () => {
  it('lists every output with its state', () => {
    const out = renderTable({ '1': { '1': 0, '2': 255 } });
    expect(out).toContain('off');
    expect(out).toContain('ON');
    expect(out).toContain('2 sortie(s) sur 1 module(s) EXO');
  });

  it('says so when the central reports nothing', () => {
    expect(renderTable({})).toMatch(/aucune sortie/);
  });
});

describe('renderConfig', () => {
  it('emits a pasteable accessories block', () => {
    const parsed = JSON.parse(renderConfig({ '1': { '1': 255 }, '2': { '1': 40 } }));
    expect(parsed.accessories).toHaveLength(2);
    expect(parsed.accessories[0]).toMatchObject({ type: 'switch', exoAddress: 1, outputNbr: 1 });
  });

  it('adds maxValue only for a guessed dimmer', () => {
    const parsed = JSON.parse(renderConfig({ '1': { '1': 255, '2': 40 } }));
    expect(parsed.accessories[0].maxValue).toBeUndefined();
    expect(parsed.accessories[1]).toMatchObject({ type: 'dimmer', maxValue: 100 });
  });

  it('guesses a 0-255 scale when the level exceeds 100', () => {
    const parsed = JSON.parse(renderConfig({ '1': { '1': 180 } }));
    expect(parsed.accessories[0].maxValue).toBe(255);
  });
});

/** Une centrale qui expose tout son espace d'adressage, tout à 0. */
function fullAddressSpace(): Record<string, Record<string, number>> {
  const values: Record<string, Record<string, number>> = {};
  for (let exo = 1; exo <= 16; exo++) {
    values[String(exo)] = {};
    for (let out = 1; out <= 8; out++) {
      values[String(exo)][String(out)] = 0;
    }
  }
  return values;
}

describe('configAdvice', () => {
  it('warns that an all-zero dump says nothing about which outputs exist', () => {
    const notes = configAdvice(fullAddressSpace()).join(' ');
    expect(notes).toMatch(/128 sorties lues sont toutes à 0/);
    expect(notes).toMatch(/espace d'adressage/);
    expect(notes).toMatch(/--watch/);
  });

  it('counts the live outputs when some are on', () => {
    expect(configAdvice({ '1': { '1': 255, '2': 0 } }).join(' ')).toMatch(/1 sortie\(s\) sur 2/);
  });

  it('says nothing for an empty reading', () => {
    expect(configAdvice({})).toEqual([]);
  });
});

describe('recordChanges', () => {
  it('records an output that moved, with both values', () => {
    const seen: Observations = new Map();
    recordChanges(seen, { '1': { '1': 0 } }, { '1': { '1': 255 } });
    expect(seen.get('1:1')).toEqual([0, 255]);
  });

  it('ignores outputs that did not move', () => {
    const seen: Observations = new Map();
    recordChanges(seen, { '1': { '1': 0, '2': 0 } }, { '1': { '1': 255, '2': 0 } });
    expect([...seen.keys()]).toEqual(['1:1']);
  });

  it('accumulates every distinct level across successive polls', () => {
    const seen: Observations = new Map();
    recordChanges(seen, { '2': { '1': 0 } }, { '2': { '1': 40 } });
    recordChanges(seen, { '2': { '1': 40 } }, { '2': { '1': 80 } });
    recordChanges(seen, { '2': { '1': 80 } }, { '2': { '1': 0 } });
    expect(seen.get('2:1')).toEqual([0, 40, 80]);
  });

  it('does not record an output seen for the first time', () => {
    const seen: Observations = new Map();
    recordChanges(seen, {}, { '1': { '1': 255 } });
    expect(seen.size).toBe(0);
  });
});

describe('describeObserved', () => {
  it('calls a two-state output a switch', () => {
    expect(describeObserved('1', '2', [0, 255])).toEqual({
      name: 'EXO1 sortie 2', type: 'switch', exoAddress: 1, outputNbr: 2,
    });
  });

  it('captures an on value that is not the default 255', () => {
    expect(describeObserved('1', '2', [0, 1])).toMatchObject({ type: 'switch', onValue: 1 });
  });

  it('omits onValue when the hardware uses the default', () => {
    expect(describeObserved('1', '2', [0, 255])).not.toHaveProperty('onValue');
  });

  it('calls an output with several levels a dimmer', () => {
    expect(describeObserved('2', '1', [0, 40, 80])).toMatchObject({
      type: 'dimmer', maxValue: 100,
    });
  });

  it('infers a 0-255 scale from a level above 100', () => {
    expect(describeObserved('2', '1', [0, 128, 255])).toMatchObject({ maxValue: 255 });
  });
});

describe('observedConfig', () => {
  it('emits only the outputs that were seen moving', () => {
    const seen: Observations = new Map([['3:5', [0, 255]], ['1:2', [0, 1]]]);
    const parsed = JSON.parse(observedConfig(seen));
    expect(parsed.accessories).toHaveLength(2);
  });

  it('sorts by EXO then output, numerically', () => {
    const seen: Observations = new Map([['10:1', [0, 1]], ['2:3', [0, 1]], ['2:1', [0, 1]]]);
    const parsed = JSON.parse(observedConfig(seen));
    expect(parsed.accessories.map((a: { name: string }) => a.name)).toEqual([
      'EXO2 sortie 1', 'EXO2 sortie 3', 'EXO10 sortie 1',
    ]);
  });

  it('turns a walk-around session into a pasteable block', () => {
    const seen: Observations = new Map();
    // Un interrupteur en 0/255, une prise en 0/1, un variateur balayé.
    recordChanges(seen, { '1': { '1': 0 } }, { '1': { '1': 255 } });
    recordChanges(seen, { '1': { '2': 0 } }, { '1': { '2': 1 } });
    recordChanges(seen, { '2': { '1': 0 } }, { '2': { '1': 60 } });
    recordChanges(seen, { '2': { '1': 60 } }, { '2': { '1': 100 } });

    const parsed = JSON.parse(observedConfig(seen));
    expect(parsed.accessories).toEqual([
      { name: 'EXO1 sortie 1', type: 'switch', exoAddress: 1, outputNbr: 1 },
      { name: 'EXO1 sortie 2', type: 'switch', exoAddress: 1, outputNbr: 2, onValue: 1 },
      { name: 'EXO2 sortie 1', type: 'dimmer', exoAddress: 2, outputNbr: 1, maxValue: 100 },
    ]);
  });

  it('produces an empty block when nothing moved', () => {
    expect(JSON.parse(observedConfig(new Map())).accessories).toEqual([]);
  });
});

describe('dummyKey', () => {
  it('produces a key of exactly the requested length', () => {
    expect(dummyKey(50)).toHaveLength(50);
    expect(dummyKey(64)).toHaveLength(64);
  });
});

describe('probeErrorCodes', () => {
  const servers: MockTricomServer[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await s.close();
    }
  });

  async function probeAgainst(requireApikey: string | undefined, apikey: string) {
    const server = await startMockTricom({ '1': { '1': 255 } });
    server.requireApikey = requireApikey;
    servers.push(server);
    return probeErrorCodes({ ip: '127.0.0.1', port: server.port, apikey, timeout: 2 });
  }

  it('tries the supplied key plus several deliberately wrong ones', async () => {
    const results = await probeAgainst('bonne', 'bonne');
    expect(results.map(r => r.label)).toEqual([
      'clé fournie',
      'clé absente (vide)',
      'clé courte (4 car.)',
      'clé fausse, 50 car.',
      'clé fausse, 64 car.',
      'endpoint inconnu',
    ]);
  });

  it('separates a key the central accepts from ones it refuses', async () => {
    const results = await probeAgainst('bonne', 'bonne');
    const byLabel = Object.fromEntries(results.map(r => [r.label, r.answer]));
    expect(byLabel['clé fournie']).toContain('200 {');
    expect(byLabel['clé absente (vide)']).toBe('200 ERROR 9001');
    expect(byLabel['clé fausse, 50 car.']).toBe('200 ERROR 9001');
  });

  it('reports the refusal for every case when the supplied key is wrong', async () => {
    const results = await probeAgainst('bonne', 'mauvaise');
    expect(results.every(r => r.answer.includes('ERROR 9001'))).toBe(true);
  });

  it('never writes to the central', async () => {
    const server = await startMockTricom({ '1': { '1': 255 } });
    servers.push(server);
    await probeErrorCodes({ ip: '127.0.0.1', port: server.port, apikey: 'k', timeout: 2 });
    expect(server.requests.every(r => r.path !== '/jeedom/exoOutputValue')).toBe(true);
    expect(server.values).toEqual({ '1': { '1': 255 } });
  });
});

/**
 * Reproduces exactly what a real TriCom answered on 2026-09-14: every key
 * variant refused with the same code, and an unknown route answering with the
 * server's welcome page.
 */
const REAL_CENTRAL: CodeProbeResult[] = [
  { label: 'clé fournie', kind: 'key', answer: '200 ERROR 9001' },
  { label: 'clé absente (vide)', kind: 'key', answer: '200 ERROR 9001' },
  { label: 'clé courte (4 car.)', kind: 'key', answer: '200 ERROR 9001' },
  { label: 'clé fausse, 50 car.', kind: 'key', answer: '200 ERROR 9001' },
  { label: 'clé fausse, 64 car.', kind: 'key', answer: '200 ERROR 9001' },
  {
    label: 'endpoint inconnu', kind: 'route',
    answer: '200 <h1>Server start success if you see this message</h1>',
  },
];

describe('interpretErrorCodes', () => {
  it('concludes the server is alive when an unknown route answers normally', () => {
    expect(interpretErrorCodes(REAL_CENTRAL).join(' ')).toMatch(/serveur HTTP.*bien actif/);
  });

  it('concludes the code means "key not recognised" when length makes no difference', () => {
    const notes = interpretErrorCodes(REAL_CENTRAL).join(' ');
    expect(notes).toMatch(/ERROR 9001/);
    expect(notes).toMatch(/ne distingue ni l'absence de clé, ni sa taille/);
    expect(notes).toMatch(/TRINITY/);
  });

  it('says there is nothing to fix when the supplied key works', () => {
    const ok: CodeProbeResult[] = [
      { label: 'clé fournie', kind: 'key', answer: '200 {"1":{"1":255}}' },
      ...REAL_CENTRAL.slice(1),
    ];
    const notes = interpretErrorCodes(ok);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/acceptée/);
  });

  it('flags that the central distinguishes causes when codes differ', () => {
    const mixed: CodeProbeResult[] = [
      { label: 'clé fournie', kind: 'key', answer: '200 ERROR 9001' },
      { label: 'clé fausse, 64 car.', kind: 'key', answer: '200 ERROR 9002' },
    ];
    expect(interpretErrorCodes(mixed).join(' ')).toMatch(/2 codes différents \(9001, 9002\)/);
  });

  it('does not claim the server is alive when the route test failed too', () => {
    const dead = REAL_CENTRAL.map(r =>
      r.kind === 'route' ? { ...r, answer: 'échec réseau : fetch failed' } : r);
    expect(interpretErrorCodes(dead).join(' ')).not.toMatch(/bien actif/);
  });

  it('returns nothing for an empty probe', () => {
    expect(interpretErrorCodes([])).toEqual([]);
  });
});

describe('renderErrorCodes', () => {
  it('prints the table and the conclusion together', () => {
    const out = renderErrorCodes(REAL_CENTRAL);
    expect(out).toContain('clé fausse, 64 car.');
    expect(out).toMatch(/TRINITY/);
  });

  it('says plainly that nothing was written', () => {
    expect(renderErrorCodes([])).toMatch(/Aucune écriture/);
  });
});

describe('diff', () => {
  it('reports an output that changed', () => {
    const changes = diff({ '1': { '1': 0 } }, { '1': { '1': 255 } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('EXO 1 sortie 1 : 0 → 255');
    expect(changes[0]).toContain('ON');
  });

  it('reports nothing when the reading is unchanged', () => {
    expect(diff({ '1': { '1': 12 } }, { '1': { '1': 12 } })).toEqual([]);
  });

  it('reports an output that appeared', () => {
    const changes = diff({}, { '3': { '4': 1 } });
    expect(changes[0]).toContain('EXO 3 sortie 4 : — → 1');
  });

  it('reports an output that disappeared', () => {
    const changes = diff({ '3': { '4': 1 } }, {});
    expect(changes[0]).toContain('→ —');
  });

  it('reports several changes at once', () => {
    const changes = diff({ '1': { '1': 0, '2': 0 } }, { '1': { '1': 255, '2': 128 } });
    expect(changes).toHaveLength(2);
  });
});
