import { AttributeType } from '../homee/enums.js';
import type { HomeeNode } from '../homee/types.js';
import { findAttribute, findAttributes } from '../homee/util.js';

import type { Mapper } from './types.js';

const writableOnOff = (node: HomeeNode) =>
  findAttributes(node, AttributeType.ON_OFF).filter((a) => a.editable);
const byId = (node: HomeeNode, id: number) =>
  node.attributes.find((a) => a.id === id);

export const lightMapper: Mapper = {
  kind: 'light',
  matches: (node) =>
    writableOnOff(node).length > 0 &&
    findAttribute(node, AttributeType.DIMMING_LEVEL) !== undefined,
  services: (node) => {
    const onOff = writableOnOff(node)[0]!;
    const dimmer = findAttribute(node, AttributeType.DIMMING_LEVEL)!;

    return [
      {
        type: 'Lightbulb',
        name: '',
        characteristics: [
          {
            type: 'On',
            read: (n) => Boolean(byId(n, onOff.id)?.current_value),
            write: (value) => [{ attributeId: onOff.id, value: value ? 1 : 0 }],
          },
          {
            type: 'Brightness',
            read: (n) => Math.round(byId(n, dimmer.id)?.current_value ?? 0),
            write: (value) => [
              { attributeId: dimmer.id, value: Math.round(Number(value)) },
            ],
          },
        ],
      },
    ];
  },
};

/** One Switch service per writable OnOff attribute (double relays expose two). */
export const switchMapper: Mapper = {
  kind: 'switch',
  matches: (node) => writableOnOff(node).length > 0,
  services: (node) => {
    const attributes = writableOnOff(node);

    return attributes.map((attribute, index) => ({
      type: 'Switch',
      subtype: attributes.length > 1 ? `onoff-${attribute.id}` : undefined,
      name: attributes.length > 1 ? `${index + 1}` : '',
      characteristics: [
        {
          type: 'On',
          read: (n) => Boolean(byId(n, attribute.id)?.current_value),
          write: (value) => [
            { attributeId: attribute.id, value: value ? 1 : 0 },
          ],
        },
      ],
    }));
  },
};
