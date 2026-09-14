/**
 * Minimal stand-in for the pieces of the Homebridge / HAP API that this
 * plugin touches. Just enough to drive platform.ts and accessory.ts in a
 * test without pulling in a real Homebridge instance.
 */

export type CharKey = string;

/** Fake HAP "characteristic": records handlers and the last pushed value. */
export class MockCharacteristic {
  onGetHandler?: () => unknown | Promise<unknown>;
  onSetHandler?: (v: unknown) => unknown | Promise<unknown>;
  value: unknown = undefined;

  constructor(public readonly key: CharKey) {}

  onGet(fn: () => unknown | Promise<unknown>): this {
    this.onGetHandler = fn;
    return this;
  }

  onSet(fn: (v: unknown) => unknown | Promise<unknown>): this {
    this.onSetHandler = fn;
    return this;
  }
}

/** Fake HAP service holding a bag of characteristics. */
export class MockService {
  readonly characteristics = new Map<CharKey, MockCharacteristic>();

  constructor(public readonly type: CharKey) {}

  getCharacteristic(key: CharKey): MockCharacteristic {
    let c = this.characteristics.get(key);
    if (!c) {
      c = new MockCharacteristic(key);
      this.characteristics.set(key, c);
    }
    return c;
  }

  setCharacteristic(key: CharKey, value: unknown): this {
    this.getCharacteristic(key).value = value;
    return this;
  }

  updateCharacteristic(key: CharKey, value: unknown): this {
    this.getCharacteristic(key).value = value;
    return this;
  }

  /** Read back what the plugin last pushed to HomeKit. */
  valueOf(key: CharKey): unknown {
    return this.characteristics.get(key)?.value;
  }
}

/** Fake PlatformAccessory. */
export class MockAccessory {
  readonly services = new Map<CharKey, MockService>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> = {};

  constructor(
    public displayName: string,
    public readonly UUID: string,
  ) {
    // Homebridge always provides AccessoryInformation.
    this.services.set('AccessoryInformation', new MockService('AccessoryInformation'));
  }

  getService(type: CharKey): MockService | undefined {
    return this.services.get(type);
  }

  addService(type: CharKey): MockService {
    const s = new MockService(type);
    this.services.set(type, s);
    return s;
  }
}

/** Characteristic and Service "enums": the plugin only uses them as keys. */
export const Characteristic = {
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
  Name: 'Name',
  On: 'On',
  Brightness: 'Brightness',
} as const;

export const Service = {
  AccessoryInformation: 'AccessoryInformation',
  Switch: 'Switch',
  Lightbulb: 'Lightbulb',
} as const;

export const HAPStatus = {
  SERVICE_COMMUNICATION_FAILURE: -70402,
} as const;

export class HapStatusError extends Error {
  constructor(public readonly hapStatus: number) {
    super(`HapStatusError ${hapStatus}`);
    this.name = 'HapStatusError';
  }
}

export interface MockLogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export function createMockLog() {
  const entries: MockLogEntry[] = [];
  const push = (level: MockLogEntry['level']) => (message: string, ...rest: unknown[]) => {
    entries.push({ level, message: [message, ...rest].join(' ') });
  };
  return {
    entries,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('debug'),
    log: push('info'),
    success: push('info'),
    /** Every message logged at a given level. */
    at(level: MockLogEntry['level']): string[] {
      return entries.filter(e => e.level === level).map(e => e.message);
    },
  };
}

export interface MockApiState {
  registered: MockAccessory[];
  updated: MockAccessory[];
  unregistered: MockAccessory[];
  handlers: Record<string, (() => void)[]>;
}

/** Fake Homebridge API. `state` exposes what the platform did to it. */
export function createMockApi() {
  const state: MockApiState = {
    registered: [],
    updated: [],
    unregistered: [],
    handlers: {},
  };

  const api = {
    hap: {
      Service,
      Characteristic,
      HAPStatus,
      HapStatusError,
      uuid: {
        // Deterministic and collision-free enough for tests.
        generate: (seed: string) => `uuid:${seed}`,
      },
    },
    platformAccessory: MockAccessory,
    on(event: string, fn: () => void) {
      (state.handlers[event] ??= []).push(fn);
      return api;
    },
    registerPlatformAccessories(_plugin: string, _platform: string, accessories: MockAccessory[]) {
      state.registered.push(...accessories);
    },
    updatePlatformAccessories(accessories: MockAccessory[]) {
      state.updated.push(...accessories);
    },
    unregisterPlatformAccessories(_plugin: string, _platform: string, accessories: MockAccessory[]) {
      state.unregistered.push(...accessories);
    },
    /** Fire a lifecycle event the platform subscribed to. */
    emit(event: string) {
      for (const fn of state.handlers[event] ?? []) {
        fn();
      }
    },
    state,
  };

  return api;
}
