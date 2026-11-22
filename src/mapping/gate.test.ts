import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { UpDown } from '../homee/enums.js';
import type { HomeeNode } from '../homee/types.js';

import { entranceGate, garageDoor } from './fixtures.test-helper.js';
import {
  currentDoorState,
  stopWrites,
  targetDoorState,
  writeTargetDoorState,
  ImpulseTracker,
} from './gate.js';
import { HAP } from './hap.js';

import { describeNode, snapshot } from './index.js';

const { CurrentDoorState: Current, TargetDoorState: Target } = HAP;

describe('gate mapping', () => {
  it('recognises Hörmann garage doors and entrance gates as GarageDoorOpener', () => {
    for (const node of [
      garageDoor(UpDown.CLOSED, 100),
      entranceGate(UpDown.STOPPED, 0),
    ]) {
      const spec = describeNode(node);

      assert.equal(spec?.kind, 'gate');
      assert.deepEqual(
        spec.services.map((s) => s.type),
        ['GarageDoorOpener'],
      );
      assert.equal(spec.info.manufacturer, 'Hörmann');
    }

    assert.equal(describeNode(garageDoor(1, 100))?.info.model, 'SupraMatic E4');
  });

  it('maps every up/down state', () => {
    const cases: Array<[number, number, number]> = [
      [UpDown.OPEN, 0, Current.OPEN],
      [UpDown.CLOSED, 100, Current.CLOSED],
      [UpDown.OPENING, 40, Current.OPENING],
      [UpDown.CLOSING, 60, Current.CLOSING],
      [UpDown.STOPPED, 50, Current.STOPPED],
      [UpDown.STOPPED, 100, Current.CLOSED],
    ];

    for (const [upDown, position, expected] of cases) {
      assert.equal(
        currentDoorState(garageDoor(upDown, position)),
        expected,
        `upDown=${upDown} position=${position}`,
      );
    }
  });

  it('derives the target while moving and when stopped', () => {
    assert.equal(
      targetDoorState(garageDoor(UpDown.OPENING, 50, UpDown.OPEN)),
      Target.OPEN,
    );
    assert.equal(
      targetDoorState(garageDoor(UpDown.CLOSING, 50, UpDown.CLOSED)),
      Target.CLOSED,
    );
    assert.equal(
      targetDoorState(garageDoor(UpDown.STOPPED, 100, UpDown.STOPPED)),
      Target.CLOSED,
    );
    assert.equal(
      targetDoorState(garageDoor(UpDown.STOPPED, 30, UpDown.STOPPED)),
      Target.OPEN,
    );
  });

  it('writes up/down commands', () => {
    const node = garageDoor(UpDown.CLOSED, 100);

    assert.deepEqual(writeTargetDoorState(Target.OPEN, node), [
      { attributeId: 22, value: UpDown.OPEN },
    ]);
    assert.deepEqual(writeTargetDoorState(Target.CLOSED, node), [
      { attributeId: 22, value: UpDown.CLOSED },
    ]);
    assert.deepEqual(stopWrites(node), [
      { attributeId: 22, value: UpDown.STOPPED },
    ]);
  });

  it('honours reverse_control_ui', () => {
    const node = garageDoor(UpDown.OPEN, 100);

    node.attributes[1]!.options = { reverse_control_ui: true };
    assert.equal(currentDoorState(node), Current.CLOSED);
    assert.deepEqual(writeTargetDoorState(Target.OPEN, node), [
      { attributeId: 22, value: UpDown.CLOSED },
    ]);
  });

  it('reports malfunction as obstruction', () => {
    const node = garageDoor(UpDown.CLOSED, 100);

    node.attributes[3]!.current_value = 1;
    const obstruction = snapshot(
      describeNode(node)!,
      node,
    )[0]!.characteristics.find((c) => c.type === 'ObstructionDetected');

    assert.equal(obstruction?.value, true);
  });

  it('only pulses impulse operators when needed', () => {
    const node = garageDoor(0, 100);

    node.attributes = node.attributes.filter((a) => a.type !== 135);
    node.attributes.push({ ...node.attributes[0]!, id: 99, type: 304 });
    assert.equal(currentDoorState(node), Current.CLOSED);
    assert.deepEqual(writeTargetDoorState(Target.CLOSED, node), []);
    assert.deepEqual(writeTargetDoorState(Target.OPEN, node), [
      { attributeId: 99, value: 1 },
    ]);
  });
});

describe('impulse mode', () => {
  const T0 = 1_795_370_000;
  const PULSE = [{ attributeId: 22, value: UpDown.CLOSED }];

  /** A SupraMatic as homee reports it; change times are cube seconds relative to T0. */
  function door(
    upDown: [value: number, changedAt: number],
    position: [value: number, last: number, changedAt: number],
  ) {
    const node = garageDoor(upDown[0], position[0]);

    Object.assign(node.attributes[1]!, { last_changed: T0 + upDown[1] });
    Object.assign(node.attributes[2]!, {
      last_value: position[1],
      last_changed: T0 + position[2],
    });

    return node;
  }

  const at = (seconds: number) => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: (T0 + seconds) * 1000 });
  };

  afterEach(() => mock.timers.reset());

  it('pulses the close command for both directions, only when needed', () => {
    at(0);
    const tracker = new ImpulseTracker();
    const closed = door([UpDown.CLOSED, -60], [100, 25, -60]);
    const open = door([UpDown.OPEN, -60], [0, 67, -60]);
    const write = describeNode(closed, { impulse: tracker })!.services[0]!
      .characteristics[1]!.write!;

    assert.deepEqual(write(Target.CLOSED, closed), []);
    assert.deepEqual(write(Target.OPEN, open), []);
    assert.deepEqual(write(Target.OPEN, closed), PULSE);
  });

  // Recorded on the real door: open, close, stop mid-way, pulse again.
  it('follows a measured cycle including a stop', () => {
    const tracker = new ImpulseTracker();
    const expectState = (seconds: number, node: HomeeNode, state: number) => {
      at(seconds);
      assert.equal(tracker.state(node), state, `t=${seconds}s`);
    };

    at(0);
    assert.deepEqual(
      tracker.write(Target.OPEN, door([UpDown.CLOSED, -60], [100, 25, -60])),
      PULSE,
    );
    // homee echoes "closing" until the first position report.
    expectState(2, door([UpDown.CLOSING, 0], [100, 25, -60]), Current.OPENING);
    expectState(7, door([UpDown.OPENING, 7], [67, 100, 7]), Current.OPENING);
    expectState(19, door([UpDown.OPEN, 19], [0, 61, 19]), Current.OPEN);
    assert.deepEqual(
      tracker.write(Target.OPEN, door([UpDown.OPEN, 19], [0, 61, 19])),
      [],
    );

    at(22);
    assert.deepEqual(
      tracker.write(Target.CLOSED, door([UpDown.OPEN, 19], [0, 61, 19])),
      PULSE,
    );
    expectState(24, door([UpDown.CLOSING, 22], [0, 61, 19]), Current.CLOSING);

    // The stop pulse's echo lands in the same second as a position report.
    const moving = door([UpDown.CLOSING, 30], [25, 0, 30]);

    at(30);
    assert.deepEqual(tracker.stop(moving), PULSE);
    expectState(45, door([UpDown.CLOSING, 30], [25, 0, 30]), Current.STOPPED);
    expectState(55, door([UpDown.STOPPED, 55], [34, 34, 55]), Current.STOPPED);

    // After a stop the operator reverses: a pulse from here opens, whatever was asked.
    at(110);
    const stopped = door([UpDown.STOPPED, 55], [34, 34, 55]);

    assert.deepEqual(tracker.write(Target.CLOSED, stopped), PULSE);
    expectState(
      112,
      door([UpDown.CLOSING, 110], [34, 34, 55]),
      Current.OPENING,
    );
  });

  it('reads pulses sent by the homee app from the echo', () => {
    const tracker = new ImpulseTracker();
    const echoed = door([UpDown.CLOSING, 0], [100, 100, -60]);

    at(2);
    assert.equal(tracker.state(echoed), Current.OPENING);
    // No position report followed: the pulse did not move the door.
    at(30);
    assert.equal(tracker.state(echoed), Current.CLOSED);
  });

  it('stops only a moving door', () => {
    at(10);
    const tracker = new ImpulseTracker();

    assert.deepEqual(
      tracker.stop(door([UpDown.CLOSED, -60], [100, 25, -60])),
      [],
    );
    assert.deepEqual(
      stopWrites(door([UpDown.CLOSING, 5], [40, 20, 5]), { impulse: tracker }),
      PULSE,
    );
  });
});
