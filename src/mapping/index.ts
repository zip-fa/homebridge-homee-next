import type { HomeeNode } from '../homee/types.js';
import { decode } from '../homee/util.js';

import { coverMapper } from './cover.js';
import { gateMapper } from './gate.js';
import { hapLabel } from './hap.js';
import { sensorServices } from './sensor.js';
import { lightMapper, switchMapper } from './switch.js';
import type {
  AccessoryInfo,
  AccessorySpec,
  DescribeOptions,
  HapValue,
  Mapper,
} from './types.js';

export { HAP, hapLabel } from './hap.js';
export {
  IMPULSE_MOTION_WINDOW_MS,
  ImpulseTracker,
  stopWrites,
} from './gate.js';
export type * from './types.js';

/** Order matters: the first matching mapper defines the accessory's primary service. */
const MAPPERS: Mapper[] = [gateMapper, coverMapper, lightMapper, switchMapper];

const KNOWN_VENDORS =
  /^(Hörmann|Hoermann|Fibaro|Devolo|Philips|Danfoss|Popp|Qubino|Aeotec|Somfy|Eurotronic)\b\s*(.*)$/i;

export const nodeName = (node: HomeeNode) =>
  decode(node.name) || `homee ${node.id}`;

/** homee stores the device model in the node note, e.g. "# Hörmann SupraMatic E4". */
export function nodeInfo(node: HomeeNode): AccessoryInfo {
  const note = decode(node.note).replace(/^#\s*/, '').trim();
  const vendor = KNOWN_VENDORS.exec(note);

  return {
    manufacturer: vendor?.[1] ?? 'homee',
    model: (vendor ? vendor[2] : note) || `profile ${node.profile}`,
    serialNumber: `homee-${node.id}`,
  };
}

export function describeNode(
  node: HomeeNode,
  options: DescribeOptions = {},
): AccessorySpec | undefined {
  if (node.id < 1) return undefined; // id -1 is the cube itself

  const primary = MAPPERS.find((mapper) => mapper.matches(node));
  // Gate status attributes (position, malfunction, …) are already folded into the door service.
  const services = [
    ...(primary?.services(node, options) ?? []),
    ...(primary?.kind === 'gate' ? [] : sensorServices(node)),
  ];

  if (services.length === 0) return undefined;

  const name = nodeName(node);

  for (const service of services)
    service.name = service.name ? `${name} ${service.name}` : name;

  return { kind: primary?.kind ?? 'sensor', info: nodeInfo(node), services };
}

export interface CharacteristicSnapshot {
  type: string;
  value: HapValue | undefined;
  label: string | undefined;
  writable: boolean;
  error?: string;
}

export function snapshot(spec: AccessorySpec, node: HomeeNode) {
  return spec.services.map((service) => ({
    type: service.type,
    subtype: service.subtype,
    name: service.name,
    characteristics: service.characteristics.map(
      (c): CharacteristicSnapshot => {
        try {
          const value = c.read(node);

          return {
            type: c.type,
            value,
            label: hapLabel(c.type, value),
            writable: Boolean(c.write),
          };
        } catch (error) {
          return {
            type: c.type,
            value: undefined,
            label: undefined,
            writable: Boolean(c.write),
            error: (error as Error).message,
          };
        }
      },
    ),
  }));
}
