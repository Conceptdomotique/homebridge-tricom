import { describe, expect, it } from 'vitest';
import { PlatformAccessory } from 'homebridge';

import { TricomOutputAccessory } from '../src/accessory';
import { TricomAccessoryConfig, TricomPlatform } from '../src/platform';
import {
  Characteristic,
  HAPStatus,
  HapStatusError,
  MockAccessory,
  Service,
  createMockApi,
  createMockLog,
} from './helpers/hapMock';

interface SentCommand {
  exo: number | string;
  output: number | string;
  value: number;
}

/**
 * Builds an accessory under test wired to a fake platform, and returns the
 * knobs a test needs: the raw values the "central" reports, the commands the
 * accessory sent, and the service HomeKit sees.
 */
function makeAccessory(device: TricomAccessoryConfig, options: { failWrites?: boolean } = {}) {
  const sent: SentCommand[] = [];
  const raw = new Map<string, number>();
  const log = createMockLog();
  const api = createMockApi();

  const platform = {
    Service,
    Characteristic,
    log,
    api,
    client: {
      async setOutput(exo: number | string, output: number | string, value: number) {
        if (options.failWrites) {
          throw new Error('central unreachable');
        }
        sent.push({ exo, output, value });
        raw.set(`${exo}/${output}`, value);
      },
    },
    getValue(exo: number, output: number) {
      return raw.get(`${exo}/${output}`);
    },
  } as unknown as TricomPlatform;

  const accessory = new MockAccessory(device.name, `uuid:${device.exoAddress}-${device.outputNbr}`);
  accessory.context.device = device;

  const handler = new TricomOutputAccessory(platform, accessory as unknown as PlatformAccessory);

  return {
    handler,
    accessory,
    sent,
    log,
    /** Pretend the central now reports this raw value for the output. */
    setRaw(value: number) {
      raw.set(`${device.exoAddress}/${device.outputNbr}`, value);
    },
    clearRaw() {
      raw.delete(`${device.exoAddress}/${device.outputNbr}`);
    },
    service() {
      const type = device.type === 'switch' ? Service.Switch : Service.Lightbulb;
      return accessory.getService(type)!;
    },
  };
}

const SWITCH: TricomAccessoryConfig = {
  name: 'Prise bureau', type: 'switch', exoAddress: 1, outputNbr: 2,
};
const LIGHT: TricomAccessoryConfig = {
  name: 'Plafonnier salon', type: 'light', exoAddress: 1, outputNbr: 1,
};
const DIMMER: TricomAccessoryConfig = {
  name: 'Éclairage cuisine', type: 'dimmer', exoAddress: 2, outputNbr: 1, maxValue: 100,
};

describe('service selection', () => {
  it('exposes a switch as a Switch service', () => {
    const t = makeAccessory(SWITCH);
    expect(t.accessory.getService(Service.Switch)).toBeDefined();
    expect(t.accessory.getService(Service.Lightbulb)).toBeUndefined();
  });

  it('exposes a light as a Lightbulb without brightness', () => {
    const t = makeAccessory(LIGHT);
    const svc = t.accessory.getService(Service.Lightbulb)!;
    expect(svc).toBeDefined();
    expect(svc.characteristics.has(Characteristic.Brightness)).toBe(false);
  });

  it('exposes a dimmer as a Lightbulb with brightness', () => {
    const t = makeAccessory(DIMMER);
    const svc = t.accessory.getService(Service.Lightbulb)!;
    expect(svc.characteristics.has(Characteristic.Brightness)).toBe(true);
  });

  it('fills in accessory information identifying the EXO output', () => {
    const t = makeAccessory(SWITCH);
    const info = t.accessory.getService(Service.AccessoryInformation)!;
    expect(info.valueOf(Characteristic.Manufacturer)).toBe('Tricom');
    expect(info.valueOf(Characteristic.Model)).toBe('switch');
    expect(info.valueOf(Characteristic.SerialNumber)).toBe('EXO1-OUT2');
  });

  it('reuses an existing service instead of adding a second one', () => {
    const t = makeAccessory(SWITCH);
    const before = t.accessory.services.size;
    // Re-wrapping the same cached accessory must not duplicate the service.
    makeAccessorySecondPass(t.accessory);
    expect(t.accessory.services.size).toBe(before);
  });
});

/** Wrap an already-configured accessory a second time, as a restart would. */
function makeAccessorySecondPass(accessory: MockAccessory) {
  const platform = {
    Service,
    Characteristic,
    log: createMockLog(),
    api: createMockApi(),
    client: { async setOutput() {} },
    getValue: () => undefined,
  } as unknown as TricomPlatform;
  return new TricomOutputAccessory(platform, accessory as unknown as PlatformAccessory);
}

describe('switch and light on/off', () => {
  it('sends 255 on and 0 off by default', async () => {
    const t = makeAccessory(SWITCH);
    await t.handler.setOn(true);
    await t.handler.setOn(false);
    expect(t.sent.map(c => c.value)).toEqual([255, 0]);
  });

  it('honours a custom onValue', async () => {
    const t = makeAccessory({ ...SWITCH, onValue: 1 });
    await t.handler.setOn(true);
    expect(t.sent[0].value).toBe(1);
  });

  it('addresses the configured EXO and output', async () => {
    const t = makeAccessory(SWITCH);
    await t.handler.setOn(true);
    expect(t.sent[0]).toMatchObject({ exo: 1, output: 2 });
  });

  it('reports on for any value above zero', async () => {
    const t = makeAccessory(LIGHT);
    t.setRaw(1);
    expect(await t.handler.getOn()).toBe(true);
    t.setRaw(255);
    expect(await t.handler.getOn()).toBe(true);
    t.setRaw(0);
    expect(await t.handler.getOn()).toBe(false);
  });

  it('falls back to the last known state before the first poll', async () => {
    const t = makeAccessory(SWITCH);
    expect(await t.handler.getOn()).toBe(false);
  });
});

describe('dimmer brightness mapping', () => {
  it('maps percent directly when maxValue is 100', async () => {
    const t = makeAccessory(DIMMER);
    await t.handler.setBrightness(42);
    expect(t.sent[0].value).toBe(42);
  });

  it('scales percent to a 0-255 range when maxValue is 255', async () => {
    const t = makeAccessory({ ...DIMMER, maxValue: 255 });
    await t.handler.setBrightness(100);
    await t.handler.setBrightness(50);
    await t.handler.setBrightness(0);
    expect(t.sent.map(c => c.value)).toEqual([255, 128, 0]);
  });

  it('converts a raw value back to a percent', async () => {
    const t = makeAccessory({ ...DIMMER, maxValue: 255 });
    t.setRaw(255);
    expect(await t.handler.getBrightness()).toBe(100);
    t.setRaw(128);
    expect(await t.handler.getBrightness()).toBe(50);
  });

  it('clamps a raw value above maxValue to 100%', async () => {
    const t = makeAccessory(DIMMER);
    t.setRaw(180);
    expect(await t.handler.getBrightness()).toBe(100);
  });

  it('restores the previous level when switched back on', async () => {
    const t = makeAccessory(DIMMER);
    await t.handler.setBrightness(30);
    await t.handler.setOn(false);
    await t.handler.setOn(true);
    expect(t.sent.map(c => c.value)).toEqual([30, 0, 30]);
  });

  it('turns on to full brightness when no level is known yet', async () => {
    const t = makeAccessory(DIMMER);
    await t.handler.setOn(true);
    expect(t.sent[0].value).toBe(100);
  });

  it('treats brightness 0 as off', async () => {
    const t = makeAccessory(DIMMER);
    await t.handler.setBrightness(0);
    expect(await t.handler.getOn()).toBe(false);
  });
});

describe('polling updates', () => {
  it('pushes the on state into HomeKit', () => {
    const t = makeAccessory(LIGHT);
    t.setRaw(255);
    t.handler.updateFromPoll();
    expect(t.service().valueOf(Characteristic.On)).toBe(true);
  });

  it('pushes brightness for a dimmer that is on', () => {
    const t = makeAccessory({ ...DIMMER, maxValue: 255 });
    t.setRaw(64);
    t.handler.updateFromPoll();
    expect(t.service().valueOf(Characteristic.On)).toBe(true);
    expect(t.service().valueOf(Characteristic.Brightness)).toBe(25);
  });

  it('keeps the last brightness when the dimmer is switched off', () => {
    const t = makeAccessory(DIMMER);
    t.setRaw(60);
    t.handler.updateFromPoll();
    t.setRaw(0);
    t.handler.updateFromPoll();
    expect(t.service().valueOf(Characteristic.On)).toBe(false);
    // Brightness is left at its last non-zero value, as HomeKit expects.
    expect(t.service().valueOf(Characteristic.Brightness)).toBe(60);
  });

  it('does nothing when the output has never been seen', () => {
    const t = makeAccessory(LIGHT);
    t.handler.updateFromPoll();
    expect(t.service().valueOf(Characteristic.On)).toBeUndefined();
  });
});

describe('error handling', () => {
  it('raises a HAP communication failure when a write fails', async () => {
    const t = makeAccessory(SWITCH, { failWrites: true });
    await expect(t.handler.setOn(true)).rejects.toBeInstanceOf(HapStatusError);
    await expect(t.handler.setOn(true)).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
  });

  it('logs the failure with the accessory name', async () => {
    const t = makeAccessory(SWITCH, { failWrites: true });
    await t.handler.setOn(true).catch(() => undefined);
    expect(t.log.at('error').some(m => m.includes('Prise bureau'))).toBe(true);
  });
});
