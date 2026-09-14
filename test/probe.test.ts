import { describe, expect, it } from 'vitest';

import { diff, flatten, guessType, parseArgs, renderConfig, renderTable } from '../src/probe';

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
    expect(o).toMatchObject({ watch: true, json: true, config: false });
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
