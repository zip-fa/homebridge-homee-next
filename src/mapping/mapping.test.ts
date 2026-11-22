import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HomeeNode } from '../homee/types.js';

import { fromHomeKitPosition, toHomeKitPosition } from './cover.js';
import { attribute } from './fixtures.test-helper.js';

import { describeNode } from './index.js';

const node = (
  profile: number,
  attributes: HomeeNode['attributes'],
): HomeeNode => ({ id: 7, name: 'Device', profile, state: 1, attributes });

describe('other device mappings', () => {
  it('ignores the cube itself', () => {
    assert.equal(describeNode({ ...node(1, []), id: -1 }), undefined);
  });

  it('inverts shutter positions', () => {
    const position = attribute({ id: 1, type: 15, maximum: 100 });

    assert.equal(toHomeKitPosition(position, 100), 0);
    assert.equal(toHomeKitPosition(position, 25), 75);
    assert.equal(fromHomeKitPosition(position, 75), 25);
    assert.equal(
      describeNode(node(2002, [position]))?.services[0]?.type,
      'WindowCovering',
    );
  });

  it('exposes one switch per writable relay', () => {
    const spec = describeNode(
      node(18, [
        attribute({ id: 1, type: 1, editable: 1 }),
        attribute({ id: 2, type: 1, editable: 1, instance: 1 }),
      ]),
    );

    assert.equal(spec?.kind, 'switch');
    assert.deepEqual(
      spec.services.map((s) => [s.type, s.subtype, s.name]),
      [
        ['Switch', 'onoff-1', 'Device 1'],
        ['Switch', 'onoff-2', 'Device 2'],
      ],
    );
  });

  it('prefers Lightbulb when dimmable and adds sensors', () => {
    const spec = describeNode(
      node(1004, [
        attribute({ id: 1, type: 1, editable: 1 }),
        attribute({ id: 2, type: 2, maximum: 100, editable: 1 }),
        attribute({ id: 3, type: 5, maximum: 60 }),
      ]),
    );

    assert.deepEqual(
      spec?.services.map((s) => s.type),
      ['Lightbulb', 'TemperatureSensor'],
    );
  });

  it('builds contact sensors with battery', () => {
    const spec = describeNode(
      node(2000, [
        attribute({ id: 1, type: 14 }),
        attribute({ id: 2, type: 8, maximum: 100, current_value: 80 }),
      ]),
    );

    assert.deepEqual(
      spec?.services.map((s) => s.type),
      ['ContactSensor', 'Battery'],
    );
  });

  it('returns undefined for unsupported nodes', () => {
    assert.equal(
      describeNode(node(9999, [attribute({ id: 1, type: 88 })])),
      undefined,
    );
  });
});
