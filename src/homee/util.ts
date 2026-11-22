import type { HomeeAttribute, HomeeNode } from './types.js';

/** homee URL-encodes every user supplied string (names, notes, units). */
export function decode(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const findAttribute = (
  node: HomeeNode,
  type: number,
): HomeeAttribute | undefined => node.attributes.find((a) => a.type === type);

export const findAttributes = (
  node: HomeeNode,
  type: number,
): HomeeAttribute[] => node.attributes.filter((a) => a.type === type);
