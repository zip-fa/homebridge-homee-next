import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UpDown } from '../homee/enums.js';

import { entranceGate, garageDoor } from './fixtures.test-helper.js';
import {
  currentDoorState,
  stopWrites,
  targetDoorState,
  writeTargetDoorState,
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
