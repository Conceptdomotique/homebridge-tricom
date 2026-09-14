import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { TricomPlatform, TricomAccessoryConfig } from './platform';

/**
 * Bridges one Tricom EXO output to a HomeKit Switch or Lightbulb.
 *
 * Value model (from the original Jeedom plugin):
 *   - switch/light on  -> sends `onValue` (default 255), off -> 0
 *   - state read: any value > 0 means "on"
 *   - dimmer: HomeKit brightness 0-100% is scaled to 0..`maxValue`
 */
export class TricomOutputAccessory {
  private readonly service: Service;
  private readonly device: TricomAccessoryConfig;

  private readonly isDimmer: boolean;
  private readonly onValue: number;
  private readonly maxValue: number;

  /** Last known state, used as a fallback and to restore brightness. */
  private state = { on: false, brightness: 100 };

  constructor(
    private readonly platform: TricomPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.device = accessory.context.device as TricomAccessoryConfig;
    this.isDimmer = this.device.type === 'dimmer';
    this.onValue = this.device.onValue ?? 255;
    this.maxValue = this.device.maxValue ?? (this.isDimmer ? 100 : 255);

    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Tricom')
      .setCharacteristic(Characteristic.Model, this.device.type)
      .setCharacteristic(
        Characteristic.SerialNumber,
        `EXO${this.device.exoAddress}-OUT${this.device.outputNbr}`,
      );

    const useSwitch = this.device.type === 'switch';
    this.service =
      (useSwitch
        ? this.accessory.getService(Service.Switch)
        : this.accessory.getService(Service.Lightbulb)) ||
      this.accessory.addService(useSwitch ? Service.Switch : Service.Lightbulb);

    this.service.setCharacteristic(Characteristic.Name, this.device.name);

    this.service.getCharacteristic(Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    if (this.isDimmer) {
      this.service.getCharacteristic(Characteristic.Brightness)
        .onGet(this.getBrightness.bind(this))
        .onSet(this.setBrightness.bind(this));
    }
  }

  private toBrightness(rawValue: number): number {
    return Math.max(0, Math.min(100, Math.round((rawValue / this.maxValue) * 100)));
  }

  private fromBrightness(percent: number): number {
    return Math.max(0, Math.min(this.maxValue, Math.round((percent / 100) * this.maxValue)));
  }

  /** Push the latest polled value into HomeKit. */
  updateFromPoll(): void {
    const raw = this.platform.getValue(this.device.exoAddress, this.device.outputNbr);
    if (raw === undefined) {
      return;
    }

    const { Characteristic } = this.platform;
    const on = raw > 0;
    this.state.on = on;
    this.service.updateCharacteristic(Characteristic.On, on);

    if (this.isDimmer && on) {
      this.state.brightness = this.toBrightness(raw);
      this.service.updateCharacteristic(Characteristic.Brightness, this.state.brightness);
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    const raw = this.platform.getValue(this.device.exoAddress, this.device.outputNbr);
    return raw !== undefined ? raw > 0 : this.state.on;
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    const on = value as boolean;
    let out: number;

    if (this.isDimmer) {
      const level = this.state.brightness > 0 ? this.state.brightness : 100;
      out = on ? this.fromBrightness(level) : 0;
    } else {
      out = on ? this.onValue : 0;
    }

    this.state.on = on;
    await this.send(out);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const raw = this.platform.getValue(this.device.exoAddress, this.device.outputNbr);
    return raw !== undefined ? this.toBrightness(raw) : this.state.brightness;
  }

  async setBrightness(value: CharacteristicValue): Promise<void> {
    const percent = value as number;
    this.state.brightness = percent;
    this.state.on = percent > 0;
    await this.send(this.fromBrightness(percent));
  }

  private async send(value: number): Promise<void> {
    try {
      await this.platform.client.setOutput(this.device.exoAddress, this.device.outputNbr, value);
    } catch (e) {
      this.platform.log.error(`Failed to set "${this.device.name}": ${(e as Error).message}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }
}
