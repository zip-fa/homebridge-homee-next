import { AttributeType, NodeProfile, UpDown } from '../homee/enums.js';
import type { HomeeAttribute, HomeeNode } from '../homee/types.js';
import { findAttribute } from '../homee/util.js';

import { HAP } from './hap.js';
import type { Mapper } from './types.js';

const COVER_PROFILES: ReadonlySet<number> = new Set([
  NodeProfile.SHUTTER_POSITION_SWITCH,
  NodeProfile.ELECTRIC_MOTOR_METERING_SWITCH,
  NodeProfile.ELECTRIC_MOTOR_METERING_SWITCH_WITHOUT_SLAT_POSITION,
  NodeProfile.WIFI_ELECTRIC_MOTOR_METERING_SWITCH,
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** homee: maximum = closed. HomeKit: 100 = open. */
export function toHomeKitPosition(
  attribute: HomeeAttribute,
  value: number,
): number {
  const span = attribute.maximum - attribute.minimum;

  if (span <= 0) return 0;

  return clamp(
    Math.round(100 - ((value - attribute.minimum) / span) * 100),
    0,
    100,
  );
}

export function fromHomeKitPosition(
  attribute: HomeeAttribute,
  position: number,
): number {
  const span = attribute.maximum - attribute.minimum;

  return Math.round(((100 - position) / 100) * span + attribute.minimum);
}

const position = (node: HomeeNode) =>
  findAttribute(node, AttributeType.POSITION)!;

export const coverMapper: Mapper = {
  kind: 'cover',
  matches: (node) =>
    COVER_PROFILES.has(node.profile) &&
    findAttribute(node, AttributeType.POSITION) !== undefined,
  services: () => [
    {
      type: 'WindowCovering',
      name: '',
      characteristics: [
        {
          type: 'CurrentPosition',
          read: (n) =>
            toHomeKitPosition(position(n), position(n).current_value),
        },
        {
          type: 'TargetPosition',
          read: (n) => toHomeKitPosition(position(n), position(n).target_value),
          write: (value, n) => [
            {
              attributeId: position(n).id,
              value: fromHomeKitPosition(position(n), Number(value)),
            },
          ],
        },
        {
          type: 'PositionState',
          read: (n) => {
            const state = findAttribute(
              n,
              AttributeType.UP_DOWN,
            )?.current_value;

            if (state === UpDown.OPENING) return HAP.PositionState.INCREASING;

            if (state === UpDown.CLOSING) return HAP.PositionState.DECREASING;

            return HAP.PositionState.STOPPED;
          },
        },
      ],
    },
  ],
};
