import { AttributeType, NodeProfile, UpDown } from '../homee/enums.js';
import type { HomeeAttribute, HomeeNode } from '../homee/types.js';
import { findAttribute } from '../homee/util.js';

import { HAP } from './hap.js';
import type { AttributeWrite, HapValue, Mapper } from './types.js';

const GATE_PROFILES: ReadonlySet<number> = new Set([
  NodeProfile.ENTRANCE_GATE_OPERATOR,
  NodeProfile.GARAGE_DOOR_OPERATOR,
  NodeProfile.GATE_OPERATOR,
  NodeProfile.INNER_DOOR_OPERATOR,
  NodeProfile.GARAGE_DOOR_IMPULSE_OPERATOR,
]);

type Control =
  | { kind: 'updown'; attribute: HomeeAttribute; reversed: boolean }
  | { kind: 'openclose'; attribute: HomeeAttribute; reversed: boolean }
  | { kind: 'impulse'; attribute: HomeeAttribute };

function control(node: HomeeNode): Control | undefined {
  const upDown = findAttribute(node, AttributeType.UP_DOWN);

  if (upDown)
    return {
      kind: 'updown',
      attribute: upDown,
      reversed: Boolean(upDown.options?.reverse_control_ui),
    };
  const openClose = findAttribute(node, AttributeType.OPEN_CLOSE);

  if (openClose)
    return {
      kind: 'openclose',
      attribute: openClose,
      reversed: Boolean(openClose.options?.reverse_control_ui),
    };
  const impulse = findAttribute(node, AttributeType.IMPULSE);

  if (impulse) return { kind: 'impulse', attribute: impulse };

  return undefined;
}

const MIRRORED: Record<number, number> = {
  [UpDown.OPEN]: UpDown.CLOSED,
  [UpDown.CLOSED]: UpDown.OPEN,
  [UpDown.OPENING]: UpDown.CLOSING,
  [UpDown.CLOSING]: UpDown.OPENING,
};

/** Converts any supported control encoding into an UpDown value. */
function asUpDown(ctrl: Control, raw: number): number | undefined {
  if (ctrl.kind === 'impulse') return undefined;
  // OpenClose uses 1 = open, 0 = closed.
  const value =
    ctrl.kind === 'openclose' ? (raw ? UpDown.OPEN : UpDown.CLOSED) : raw;

  return ctrl.reversed ? (MIRRORED[value] ?? value) : value;
}

export function currentDoorState(node: HomeeNode): number {
  const ctrl = control(node);
  const state = ctrl && asUpDown(ctrl, ctrl.attribute.current_value);

  switch (state) {
    case UpDown.OPEN:
      return HAP.CurrentDoorState.OPEN;
    case UpDown.CLOSED:
      return HAP.CurrentDoorState.CLOSED;
    case UpDown.OPENING:
      return HAP.CurrentDoorState.OPENING;
    case UpDown.CLOSING:
      return HAP.CurrentDoorState.CLOSING;
  }

  // homee position: maximum = fully closed. Only trusted when the up/down state is inconclusive.
  const position = findAttribute(node, AttributeType.POSITION);

  if (position && position.current_value >= position.maximum)
    return HAP.CurrentDoorState.CLOSED;

  if (
    position &&
    state === undefined &&
    position.current_value <= position.minimum
  )
    return HAP.CurrentDoorState.OPEN;

  return HAP.CurrentDoorState.STOPPED;
}

export function targetDoorState(node: HomeeNode): number {
  const ctrl = control(node);
  const target = ctrl && asUpDown(ctrl, ctrl.attribute.target_value);

  if (target === UpDown.OPEN || target === UpDown.OPENING)
    return HAP.TargetDoorState.OPEN;

  if (target === UpDown.CLOSED || target === UpDown.CLOSING)
    return HAP.TargetDoorState.CLOSED;

  const current = currentDoorState(node);

  return current === HAP.CurrentDoorState.CLOSED ||
    current === HAP.CurrentDoorState.CLOSING
    ? HAP.TargetDoorState.CLOSED
    : HAP.TargetDoorState.OPEN;
}

export function writeTargetDoorState(
  value: HapValue,
  node: HomeeNode,
): AttributeWrite[] {
  const ctrl = control(node);

  if (!ctrl) throw new Error(`node ${node.id} has no gate control attribute`);
  const open = value === HAP.TargetDoorState.OPEN;
  const attributeId = ctrl.attribute.id;

  switch (ctrl.kind) {
    case 'impulse': {
      // Every impulse toggles the motor, so only pulse when the door is not already heading there.
      const isOpen = currentDoorState(node) !== HAP.CurrentDoorState.CLOSED;

      return isOpen === open ? [] : [{ attributeId, value: 1 }];
    }

    case 'openclose':
      return [{ attributeId, value: open !== ctrl.reversed ? 1 : 0 }];
    case 'updown': {
      const desired = open ? UpDown.OPEN : UpDown.CLOSED;

      return [
        { attributeId, value: ctrl.reversed ? MIRRORED[desired]! : desired },
      ];
    }
  }
}

/** HomeKit garage doors have no stop; exposed for the test UI only. */
export function stopWrites(node: HomeeNode): AttributeWrite[] {
  const ctrl = control(node);

  return ctrl?.kind === 'updown'
    ? [{ attributeId: ctrl.attribute.id, value: UpDown.STOPPED }]
    : [];
}

export const gateMapper: Mapper = {
  kind: 'gate',
  matches: (node) =>
    GATE_PROFILES.has(node.profile) && control(node) !== undefined,
  services: () => [
    {
      type: 'GarageDoorOpener',
      name: '',
      characteristics: [
        { type: 'CurrentDoorState', read: currentDoorState },
        {
          type: 'TargetDoorState',
          read: targetDoorState,
          write: writeTargetDoorState,
        },
        {
          type: 'ObstructionDetected',
          read: (n) =>
            Boolean(
              findAttribute(n, AttributeType.MALFUNCTION_ALARM)?.current_value,
            ),
        },
      ],
    },
  ],
};
