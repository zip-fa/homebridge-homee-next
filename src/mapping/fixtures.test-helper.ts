import type { HomeeAttribute, HomeeNode } from '../homee/types.js';

export function attribute(
  partial: Partial<HomeeAttribute> & Pick<HomeeAttribute, 'id' | 'type'>,
): HomeeAttribute {
  return {
    node_id: 1,
    instance: 0,
    minimum: 0,
    maximum: 1,
    current_value: 0,
    target_value: 0,
    unit: '',
    step_value: 1,
    editable: 0,
    ...partial,
  };
}

/** Shape of a Hörmann garage door operator (SupraMatic) as reported by homee 2.42. */
export function garageDoor(
  upDown: number,
  position: number,
  target = upDown,
): HomeeNode {
  return {
    id: 1,
    name: 'H%C3%B6rmann%20Garagentor',
    profile: 2012,
    state: 1,
    note: '%23%20H%C3%B6rmann%20SupraMatic%20E4',
    attributes: [
      attribute({ id: 21, type: 385, editable: 1 }),
      attribute({
        id: 22,
        type: 135,
        maximum: 4,
        current_value: upDown,
        target_value: target,
        editable: 1,
      }),
      attribute({
        id: 23,
        type: 15,
        maximum: 100,
        current_value: position,
        target_value: position,
      }),
      attribute({ id: 24, type: 70 }),
      attribute({
        id: 25,
        type: 88,
        maximum: 30,
        current_value: 5,
        target_value: 5,
        editable: 1,
      }),
      attribute({
        id: 56,
        type: 411,
        minimum: -120,
        maximum: 0,
        current_value: -63,
      }),
    ],
  };
}

export function entranceGate(upDown: number, position: number): HomeeNode {
  return {
    ...garageDoor(upDown, position),
    id: 2,
    name: 'Einfahrtstor',
    profile: 2010,
    note: '%23%20H%C3%B6rmann%20LineaMatic%20P',
  };
}
