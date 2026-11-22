import { AttributeType, NodeProfile, UpDown } from '../homee/enums.js';
import type { HomeeAttribute, HomeeNode } from '../homee/types.js';
import { findAttribute } from '../homee/util.js';

import { HAP } from './hap.js';
import type {
  AttributeWrite,
  DescribeOptions,
  HapValue,
  Mapper,
} from './types.js';

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
  const ctrl = requireControl(node);
  const open = value === HAP.TargetDoorState.OPEN;
  const attributeId = ctrl.attribute.id;

  switch (ctrl.kind) {
    case 'impulse':
      return new ImpulseTracker().write(value, node);
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

function requireControl(node: HomeeNode): Control {
  const ctrl = control(node);

  if (!ctrl) throw new Error(`node ${node.id} has no gate control attribute`);

  return ctrl;
}

const { CurrentDoorState: Current, TargetDoorState: Target } = HAP;
const MOVING: ReadonlySet<number> = new Set([Current.OPENING, Current.CLOSING]);
const REVERSED: Record<number, number> = {
  [Current.OPENING]: Current.CLOSING,
  [Current.CLOSING]: Current.OPENING,
};

/** Measured on a SupraMatic E4: the first position report follows a pulse after ~7 s. */
export const IMPULSE_MOTION_WINDOW_MS = 15_000;
/** A pulse that stops the door produces no position report; give up on it eventually. */
const STOP_PULSE_MAX_MS = 60_000;

interface Pulse {
  at: number;
  positionChangedAt: number | undefined;
  expect: number;
}

/**
 * Single-button operators start, stop or reverse on every pulse. homee echoes the forwarded
 * command ("closing" while the door opens) and corrects itself only with the next position
 * report, which comes 7–25 s apart. The tracker remembers its own pulses and their expected
 * effect until that report arrives. One instance per cube connection.
 */
export class ImpulseTracker {
  private readonly pulses = new Map<number, Pulse>();
  private readonly lastMotion = new Map<number, number>();

  state(node: HomeeNode): number {
    const pending = this.pending(node);
    const state = pending ?? observedState(node);

    if (MOVING.has(state)) this.lastMotion.set(node.id, state);

    return state;
  }

  target(node: HomeeNode): number {
    return heading(this.state(node)) ?? Target.OPEN;
  }

  /** Pulses only when the door is not already at or heading for the target. */
  write(value: HapValue, node: HomeeNode): AttributeWrite[] {
    const state = this.state(node);

    return heading(state) === value ? [] : this.pulse(node, state);
  }

  stop(node: HomeeNode): AttributeWrite[] {
    const state = this.state(node);

    return MOVING.has(state) ? this.pulse(node, state) : [];
  }

  private pulse(node: HomeeNode, state: number): AttributeWrite[] {
    const ctrl = requireControl(node);
    const position = findAttribute(node, AttributeType.POSITION);

    this.pulses.set(node.id, {
      at: Date.now(),
      positionChangedAt: position?.last_changed,
      expect: this.effect(node, state),
    });

    // The one command these operators answer; on Hörmann via homee that is "close".
    const value =
      ctrl.kind === 'updown'
        ? UpDown.CLOSED
        : ctrl.kind === 'openclose'
          ? 0
          : 1;

    return [{ attributeId: ctrl.attribute.id, value }];
  }

  private effect(node: HomeeNode, state: number): number {
    if (state === Current.CLOSED) return Current.OPENING;

    if (state === Current.OPEN) return Current.CLOSING;

    if (MOVING.has(state)) return Current.STOPPED;
    const last = this.lastMotion.get(node.id);

    // Unknown history: say nothing rather than guess a direction.
    return last === undefined ? Current.STOPPED : REVERSED[last]!;
  }

  private pending(node: HomeeNode): number | undefined {
    const pulse = this.pulses.get(node.id);

    if (!pulse) return undefined;
    const position = findAttribute(node, AttributeType.POSITION);
    const age = Date.now() - pulse.at;
    const reported = position?.last_changed !== pulse.positionChangedAt;
    const expired =
      age >
      (MOVING.has(pulse.expect) ? IMPULSE_MOTION_WINDOW_MS : STOP_PULSE_MAX_MS);

    if (reported || expired) {
      this.pulses.delete(node.id);

      return undefined;
    }

    return pulse.expect;
  }
}

function heading(state: number): number | undefined {
  switch (state) {
    case Current.OPEN:
    case Current.OPENING:
      return Target.OPEN;
    case Current.CLOSED:
    case Current.CLOSING:
      return Target.CLOSED;
  }

  return undefined;
}

// Tolerates small clock skew between cube and host; a badly skewed clock only drops the echo check.
const changedRecently = (attribute: HomeeAttribute) =>
  attribute.last_changed !== undefined &&
  Math.abs(Date.now() - attribute.last_changed * 1000) <
    IMPULSE_MOTION_WINDOW_MS;

/** State from cube data alone, for pulses the tracker did not send (homee app, wall button). */
function observedState(node: HomeeNode): number {
  const ctrl = control(node);
  const position = findAttribute(node, AttributeType.POSITION);

  if (!ctrl || !position) return Current.STOPPED;
  const closed = position.current_value >= position.maximum;
  const open = position.current_value <= position.minimum;
  const echo =
    (ctrl.attribute.last_changed ?? 0) > (position.last_changed ?? 0);

  // From an end stop a pulse always heads for the other end.
  if (echo && changedRecently(ctrl.attribute)) {
    if (closed) return Current.OPENING;

    if (open) return Current.CLOSING;
  }

  // An echo nobody followed up with a position report did not move the door.
  if (ctrl.kind === 'updown' && !(echo && (closed || open)))
    return currentDoorState(node);

  if (closed) return Current.CLOSED;

  if (open) return Current.OPEN;

  return Current.STOPPED;
}

/** HomeKit garage doors have no stop; exposed for the test UI only. */
export function stopWrites(
  node: HomeeNode,
  options: DescribeOptions = {},
): AttributeWrite[] {
  if (options.impulse) return options.impulse.stop(node);
  const ctrl = control(node);

  return ctrl?.kind === 'updown'
    ? [{ attributeId: ctrl.attribute.id, value: UpDown.STOPPED }]
    : [];
}

export const gateMapper: Mapper = {
  kind: 'gate',
  matches: (node) =>
    GATE_PROFILES.has(node.profile) && control(node) !== undefined,
  services: (node, options) => {
    // Pure impulse operators always need one; a fresh tracker just starts without pulse history.
    const impulse =
      options.impulse ??
      (control(node)?.kind === 'impulse' ? new ImpulseTracker() : undefined);

    return [
      {
        type: 'GarageDoorOpener',
        name: '',
        characteristics: [
          {
            type: 'CurrentDoorState',
            read: impulse ? (n) => impulse.state(n) : currentDoorState,
          },
          {
            type: 'TargetDoorState',
            read: impulse ? (n) => impulse.target(n) : targetDoorState,
            write: impulse
              ? (value, n) => impulse.write(value, n)
              : writeTargetDoorState,
          },
          {
            type: 'ObstructionDetected',
            read: (n) =>
              Boolean(
                findAttribute(n, AttributeType.MALFUNCTION_ALARM)
                  ?.current_value,
              ),
          },
        ],
      },
    ];
  },
};
