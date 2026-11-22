import type {
  Characteristic,
  CharacteristicValue,
  PlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge';

import { NODE_STATE_AVAILABLE } from '../homee/enums.js';
import type { HomeeNode } from '../homee/types.js';
import type {
  AccessorySpec,
  CharacteristicSpec,
  HapValue,
} from '../mapping/index.js';

import type { HomeePlatform } from './platform.js';

export interface AccessoryContext {
  nodeId: number;
}

interface Binding {
  service: Service;
  spec: CharacteristicSpec;
  last: HapValue | undefined;
}

/** Binds one homee node to one cached PlatformAccessory, driven by an AccessorySpec. */
export class HomeeAccessory {
  private bindings: Binding[] = [];

  constructor(
    private readonly platform: HomeePlatform,
    public readonly accessory: PlatformAccessory<AccessoryContext>,
    spec: AccessorySpec,
  ) {
    this.apply(spec);
  }

  get nodeId(): number {
    return this.accessory.context.nodeId;
  }

  apply(spec: AccessorySpec): void {
    const { Service, Characteristic } = this.platform.api.hap;

    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, spec.info.manufacturer)
      .setCharacteristic(Characteristic.Model, spec.info.model)
      .setCharacteristic(Characteristic.SerialNumber, spec.info.serialNumber);

    const wanted = new Set(
      spec.services.map((s) => serviceKey(this.serviceUuid(s.type), s.subtype)),
    );

    for (const service of [...this.accessory.services]) {
      if (service.UUID === Service.AccessoryInformation.UUID) continue;

      if (!wanted.has(serviceKey(service.UUID, service.subtype)))
        this.accessory.removeService(service);
    }

    this.bindings = [];
    for (const serviceSpec of spec.services) {
      const ServiceType = this.serviceType(serviceSpec.type);
      const { subtype } = serviceSpec;
      const service =
        (subtype
          ? this.accessory.getServiceById(ServiceType, subtype)
          : this.accessory.getService(ServiceType)) ??
        this.accessory.addService(
          new (ServiceType as unknown as ConcreteService)(
            serviceSpec.name,
            subtype,
          ),
        );

      service.setCharacteristic(Characteristic.Name, serviceSpec.name);

      for (const characteristicSpec of serviceSpec.characteristics) {
        this.bind(service, characteristicSpec);
      }
    }
  }

  /** Pushes changed values to HomeKit. */
  refresh(): void {
    const node = this.platform.client.nodes.get(this.nodeId);

    if (!node) return;
    for (const binding of this.bindings) {
      const value = binding.spec.read(node);

      if (value === binding.last) continue;
      binding.last = value;
      binding.service.updateCharacteristic(
        this.characteristicType(binding.spec.type),
        value,
      );
    }
  }

  private bind(service: Service, spec: CharacteristicSpec): void {
    const characteristic = service.getCharacteristic(
      this.characteristicType(spec.type),
    );

    if (spec.props) characteristic.setProps(spec.props);

    const binding: Binding = { service, spec, last: undefined };

    this.bindings.push(binding);

    characteristic.onGet(() => {
      binding.last = spec.read(this.reachableNode());

      return binding.last;
    });

    const write = spec.write;

    if (write) {
      characteristic.onSet((value: CharacteristicValue) => {
        const node = this.reachableNode();
        const writes = write(value as HapValue, node);

        for (const { attributeId, value: homeeValue } of writes) {
          this.platform.log.info(
            `${service.displayName}: ${spec.type} -> ${JSON.stringify(value)} (attribute ${attributeId} = ${homeeValue})`,
          );
          this.platform.client.setValue(node.id, attributeId, homeeValue);
        }
      });
    }
  }

  /** HomeKit shows "No Response" when we throw this, instead of stale values. */
  private reachableNode(): HomeeNode {
    const node = this.platform.client.nodes.get(this.nodeId);

    if (
      !this.platform.client.connected ||
      !node ||
      node.state !== NODE_STATE_AVAILABLE
    ) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }

    return node;
  }

  private serviceType(name: string): ServiceType {
    const type = (
      this.platform.api.hap.Service as unknown as Record<
        string,
        ServiceType | undefined
      >
    )[name];

    if (!type) throw new Error(`unknown HAP service ${name}`);

    return type;
  }

  private serviceUuid(name: string): string {
    return this.serviceType(name).UUID;
  }

  private characteristicType(name: string): CharacteristicType {
    const type = (
      this.platform.api.hap.Characteristic as unknown as Record<
        string,
        CharacteristicType | undefined
      >
    )[name];

    if (!type) throw new Error(`unknown HAP characteristic ${name}`);

    return type;
  }
}

type ServiceType = WithUUID<typeof Service>;
// Concrete HAP services (Service.Switch, …) take (displayName, subtype); the base class type doesn't say so.
type ConcreteService = new (displayName: string, subtype?: string) => Service;
type CharacteristicType = WithUUID<new () => Characteristic>;

const serviceKey = (uuid: string, subtype: string | undefined) =>
  `${uuid}/${subtype ?? ''}`;
