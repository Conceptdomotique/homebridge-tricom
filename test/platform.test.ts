import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, PlatformConfig } from 'homebridge';

import { TricomPlatform, TricomAccessoryConfig } from '../src/platform';
import {
  Characteristic,
  MockAccessory,
  Service,
  createMockApi,
  createMockLog,
} from './helpers/hapMock';
import { startMockTricom, MockTricomServer } from './helpers/tricomServer';

const openServers: MockTricomServer[] = [];
const runningPlatforms: ReturnType<typeof createMockApi>[] = [];

afterEach(async () => {
  // Stop poll timers so the test process can exit.
  for (const api of runningPlatforms.splice(0)) {
    api.emit('shutdown');
  }
  for (const s of openServers.splice(0)) {
    await s.close();
  }
});

function makePlatform(config: Partial<PlatformConfig> & { accessories?: TricomAccessoryConfig[] }) {
  const log = createMockLog();
  const api = createMockApi();
  runningPlatforms.push(api);

  const platform = new TricomPlatform(
    log as never,
    { platform: 'Tricom', name: 'Tricom', ...config } as PlatformConfig,
    api as unknown as API,
  );

  return { platform, api, log };
}

const LIGHT: TricomAccessoryConfig = {
  name: 'Plafonnier', type: 'light', exoAddress: 1, outputNbr: 1,
};
const SWITCH: TricomAccessoryConfig = {
  name: 'Prise', type: 'switch', exoAddress: 1, outputNbr: 2,
};

describe('configuration', () => {
  it('warns when no apikey is configured', () => {
    const { log } = makePlatform({ ip: '127.0.0.1', port: 9000 });
    expect(log.at('warn').some(m => m.includes('apikey'))).toBe(true);
  });

  it('does not warn when an apikey is present', () => {
    const { log } = makePlatform({ ip: '127.0.0.1', apikey: 'k' });
    expect(log.at('warn').some(m => m.includes('apikey'))).toBe(false);
  });

  it('applies default ip, port and poll interval', () => {
    const { log } = makePlatform({ apikey: 'k' });
    expect(log.at('info').some(m => m.includes('http://127.0.0.1:9000') && m.includes('poll 5s'))).toBe(true);
  });

  it('never polls faster than every 2 seconds', () => {
    const { log } = makePlatform({ apikey: 'k', pollInterval: 0 });
    expect(log.at('info').some(m => m.includes('poll 5s'))).toBe(true);
  });

  it('honours a configured poll interval', () => {
    const { log } = makePlatform({ apikey: 'k', pollInterval: 30 });
    expect(log.at('info').some(m => m.includes('poll 30s'))).toBe(true);
  });
});

describe('accessory discovery', () => {
  it('registers one accessory per configured output', () => {
    const { api } = makePlatform({ apikey: 'k', accessories: [LIGHT, SWITCH] });
    api.emit('didFinishLaunching');
    expect(api.state.registered.map(a => a.displayName)).toEqual(['Plafonnier', 'Prise']);
  });

  it('derives a stable UUID from the EXO address and output number', () => {
    const { api } = makePlatform({ apikey: 'k', accessories: [LIGHT] });
    api.emit('didFinishLaunching');
    expect(api.state.registered[0].UUID).toBe('uuid:tricom-1-1');
  });

  it('skips an entry missing its EXO address or output number', () => {
    const { api, log } = makePlatform({
      apikey: 'k',
      accessories: [
        { name: 'Incomplet', type: 'switch' } as unknown as TricomAccessoryConfig,
        LIGHT,
      ],
    });
    api.emit('didFinishLaunching');
    expect(api.state.registered).toHaveLength(1);
    expect(log.at('warn').some(m => m.includes('required'))).toBe(true);
  });

  it('reuses a cached accessory instead of registering a duplicate', () => {
    const { platform, api } = makePlatform({ apikey: 'k', accessories: [LIGHT] });
    const cached = new MockAccessory('Ancien nom', 'uuid:tricom-1-1');
    platform.configureAccessory(cached as never);

    api.emit('didFinishLaunching');

    expect(api.state.registered).toHaveLength(0);
    expect(api.state.updated).toHaveLength(1);
    expect(cached.displayName).toBe('Plafonnier');
    expect(cached.context.device).toMatchObject({ exoAddress: 1, outputNbr: 1 });
  });

  it('removes a cached accessory that is no longer in the config', () => {
    const { platform, api } = makePlatform({ apikey: 'k', accessories: [LIGHT] });
    const orphan = new MockAccessory('Supprimé', 'uuid:tricom-9-9');
    platform.configureAccessory(orphan as never);

    api.emit('didFinishLaunching');

    expect(api.state.unregistered.map(a => a.UUID)).toEqual(['uuid:tricom-9-9']);
  });

  it('registers nothing when no accessories are configured', () => {
    const { api } = makePlatform({ apikey: 'k' });
    api.emit('didFinishLaunching');
    expect(api.state.registered).toHaveLength(0);
  });
});

describe('getValue', () => {
  it('returns undefined before the first successful poll', () => {
    const { platform } = makePlatform({ apikey: 'k' });
    expect(platform.getValue(1, 1)).toBeUndefined();
  });

  it('reads a value out of the nested map', () => {
    const { platform } = makePlatform({ apikey: 'k' });
    platform.latestValues = { '1': { '1': 255, '2': 0 } };
    expect(platform.getValue(1, 1)).toBe(255);
    expect(platform.getValue(1, 2)).toBe(0);
  });

  it('returns undefined for an unknown EXO or output', () => {
    const { platform } = makePlatform({ apikey: 'k' });
    platform.latestValues = { '1': { '1': 255 } };
    expect(platform.getValue(2, 1)).toBeUndefined();
    expect(platform.getValue(1, 7)).toBeUndefined();
  });

  it('coerces a value the central sent as a string', () => {
    const { platform } = makePlatform({ apikey: 'k' });
    platform.latestValues = { '1': { '1': '128' as unknown as number } };
    expect(platform.getValue(1, 1)).toBe(128);
  });
});

describe('polling a central', () => {
  it('fills latestValues from the central on launch', async () => {
    const server = await startMockTricom({ '1': { '1': 255, '2': 0 } });
    openServers.push(server);

    const { platform, api } = makePlatform({
      apikey: 'k', ip: '127.0.0.1', port: server.port, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');
    await vi.waitFor(() => expect(platform.getValue(1, 1)).toBe(255));
  });

  it('pushes polled values into the registered accessories', async () => {
    const server = await startMockTricom({ '1': { '1': 255 } });
    openServers.push(server);

    const { api } = makePlatform({
      apikey: 'k', ip: '127.0.0.1', port: server.port, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');

    await vi.waitFor(() => {
      const svc = api.state.registered[0].getService(Service.Lightbulb)!;
      expect(svc.valueOf(Characteristic.On)).toBe(true);
    });
  });

  it('survives an unreachable central without crashing', async () => {
    const { platform, api, log } = makePlatform({
      apikey: 'k', ip: '127.0.0.1', port: 1, timeout: 1, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');

    // The first failure is a warning, so a misconfiguration is visible
    // without turning on debug logging.
    await vi.waitFor(() => expect(log.at('warn').some(m => m.includes('poll failed'))).toBe(true));
    expect(platform.latestValues).toEqual({});
  });

  it('reports a key refused by the central as an error naming the code', async () => {
    const server = await startMockTricom({ '1': { '1': 255 } });
    server.requireApikey = 'la-bonne-cle';
    openServers.push(server);

    const { api, log } = makePlatform({
      apikey: 'mauvaise-cle', ip: '127.0.0.1', port: server.port, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');

    await vi.waitFor(() => {
      expect(log.at('error').some(m => m.includes('9001') && m.includes('TRINITY'))).toBe(true);
    });
  });

  it('warns once per outage instead of flooding the log', async () => {
    const { api, log } = makePlatform({
      apikey: 'k', ip: '127.0.0.1', port: 1, timeout: 1,
      pollInterval: 2, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');

    await vi.waitFor(() => expect(log.at('warn').length).toBe(1));
    await new Promise(r => setTimeout(r, 250));
    expect(log.at('warn').filter(m => m.includes('poll failed'))).toHaveLength(1);
  });

  it('says so when the central comes back', async () => {
    const server = await startMockTricom({ '1': { '1': 0 } });
    server.requireApikey = 'la-bonne-cle';
    openServers.push(server);

    const { api, log } = makePlatform({
      apikey: 'la-bonne-cle', ip: '127.0.0.1', port: server.port,
      pollInterval: 2, accessories: [LIGHT],
    });

    // Fail the first poll, then let the key through again.
    server.requireApikey = 'autre-chose';
    api.emit('didFinishLaunching');
    await vi.waitFor(() => expect(log.at('error').length).toBeGreaterThan(0));

    server.requireApikey = 'la-bonne-cle';
    await vi.waitFor(
      () => expect(log.at('info').some(m => m.includes('reachable again'))).toBe(true),
      { timeout: 5000 },
    );
  });

  it('stops polling on shutdown', async () => {
    const server = await startMockTricom({ '1': { '1': 0 } });
    openServers.push(server);

    const { api } = makePlatform({
      apikey: 'k', ip: '127.0.0.1', port: server.port, pollInterval: 2, accessories: [LIGHT],
    });
    api.emit('didFinishLaunching');
    await vi.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));

    api.emit('shutdown');
    const after = server.requests.length;
    await new Promise(r => setTimeout(r, 120));
    expect(server.requests.length).toBe(after);
  });
});
