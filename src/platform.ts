import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { TricomClient, ExoValues } from './tricomClient';
import { TricomOutputAccessory } from './accessory';

export type TricomDeviceType = 'switch' | 'light' | 'dimmer';

/**
 * One HomeKit accessory = one output on one EXO module.
 */
export interface TricomAccessoryConfig {
  name: string;
  exoAddress: number;
  outputNbr: number;
  type: TricomDeviceType;
  /** Value sent for "on" on a switch/light (Jeedom template used 255). */
  onValue?: number;
  /** Full-scale value for a dimmer (brightness 100% maps to this). */
  maxValue?: number;
}

export class TricomPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  /** Accessories restored from the Homebridge cache. */
  public readonly accessories: PlatformAccessory[] = [];

  public readonly client: TricomClient;
  public latestValues: ExoValues = {};

  private readonly handlers: TricomOutputAccessory[] = [];
  private readonly pollIntervalMs: number;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    const ip = (config.ip as string) || '127.0.0.1';
    const port = (config.port as number) || 9000;
    const apikey = (config.apikey as string) || '';
    const timeoutMs = ((config.timeout as number) || 5) * 1000;
    this.pollIntervalMs = Math.max(2, (config.pollInterval as number) || 5) * 1000;

    this.client = new TricomClient(ip, port, apikey, timeoutMs, log);

    if (!apikey) {
      this.log.warn('No "apikey" set in config — the Tricom server will likely reject requests.');
    }

    this.log.info(`Tricom platform ready (server http://${ip}:${port}, poll ${this.pollIntervalMs / 1000}s).`);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
      void this.startPolling();
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  /** Called by Homebridge for each cached accessory at startup. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Loading cached accessory: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  /**
   * The Tricom central does not expose a device list, so accessories are
   * built from the user's config. We register new ones, refresh existing
   * ones, and prune any that were removed from the config.
   */
  private discoverDevices(): void {
    const configured = (this.config.accessories as TricomAccessoryConfig[]) || [];
    const validUUIDs = new Set<string>();

    for (const dev of configured) {
      if (dev.exoAddress === undefined || dev.outputNbr === undefined || !dev.name) {
        this.log.warn(`Skipping an accessory — "name", "exoAddress" and "outputNbr" are required.`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`tricom-${dev.exoAddress}-${dev.outputNbr}`);
      validUUIDs.add(uuid);

      let accessory = this.accessories.find(a => a.UUID === uuid);
      if (accessory) {
        accessory.context.device = dev;
        accessory.displayName = dev.name;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info(`Adding Tricom accessory: ${dev.name} (exo ${dev.exoAddress}, output ${dev.outputNbr})`);
        accessory = new this.api.platformAccessory(dev.name, uuid);
        accessory.context.device = dev;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }

      this.handlers.push(new TricomOutputAccessory(this, accessory));
    }

    const stale = this.accessories.filter(a => !validUUIDs.has(a.UUID));
    if (stale.length > 0) {
      this.log.info(`Removing ${stale.length} stale Tricom accessory(ies).`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private async startPolling(): Promise<void> {
    const poll = async () => {
      try {
        this.latestValues = await this.client.getAllValues();
        for (const handler of this.handlers) {
          handler.updateFromPoll();
        }
      } catch (e) {
        this.log.debug('Tricom poll failed: ' + (e as Error).message);
      }
    };

    await poll();
    this.pollTimer = setInterval(() => void poll(), this.pollIntervalMs);
  }

  /** Latest known raw value for an output, or undefined if not seen yet. */
  getValue(exo: number, output: number): number | undefined {
    const outputs = this.latestValues[String(exo)];
    if (!outputs) {
      return undefined;
    }
    const raw = outputs[String(output)];
    if (raw === undefined) {
      return undefined;
    }
    return typeof raw === 'number' ? raw : Number(raw);
  }
}
