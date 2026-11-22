/** Enum values from the HomeKit Accessory Protocol spec; mirrored here so mapping stays HAP-free. */
export const HAP = {
  CurrentDoorState: { OPEN: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, STOPPED: 4 },
  TargetDoorState: { OPEN: 0, CLOSED: 1 },
  PositionState: { DECREASING: 0, INCREASING: 1, STOPPED: 2 },
  ContactSensorState: { DETECTED: 0, NOT_DETECTED: 1 },
  StatusLowBattery: { NORMAL: 0, LOW: 1 },
  ChargingState: { NOT_CHARGING: 0, CHARGING: 1, NOT_CHARGEABLE: 2 },
} as const satisfies Record<string, Record<string, number>>;

export function hapLabel(
  characteristic: string,
  value: unknown,
): string | undefined {
  const table = (HAP as Record<string, Record<string, number>>)[characteristic];

  return table && Object.keys(table).find((key) => table[key] === value);
}
