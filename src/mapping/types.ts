import type { HomeeNode } from '../homee/types.js';

import type { ImpulseTracker } from './gate.js';

export type HapValue = number | boolean;

export interface AttributeWrite {
  attributeId: number;
  value: number;
}

export interface CharacteristicSpec {
  /** HAP characteristic name, resolved via `api.hap.Characteristic[type]`. */
  type: string;
  read: (node: HomeeNode) => HapValue;
  write?: (value: HapValue, node: HomeeNode) => AttributeWrite[];
  props?: { minValue?: number; maxValue?: number };
}

export interface ServiceSpec {
  /** HAP service name, resolved via `api.hap.Service[type]`. */
  type: string;
  subtype?: string;
  name: string;
  characteristics: CharacteristicSpec[];
}

export interface AccessoryInfo {
  manufacturer: string;
  model: string;
  serialNumber: string;
}

export interface AccessorySpec {
  kind: 'gate' | 'cover' | 'light' | 'switch' | 'sensor';
  info: AccessoryInfo;
  services: ServiceSpec[];
}

export interface DescribeOptions {
  /** Drive a gate as a single-button operator: every command is one pulse of the working button. */
  impulse?: ImpulseTracker;
}

export interface Mapper {
  kind: AccessorySpec['kind'];
  matches: (node: HomeeNode) => boolean;
  services: (node: HomeeNode, options: DescribeOptions) => ServiceSpec[];
}
