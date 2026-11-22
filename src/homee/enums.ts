export const NodeProfile = {
  ENTRANCE_GATE_OPERATOR: 2010,
  GARAGE_DOOR_OPERATOR: 2012,
  GATE_OPERATOR: 2013,
  INNER_DOOR_OPERATOR: 2014,
  GARAGE_DOOR_IMPULSE_OPERATOR: 2015,
  OPEN_CLOSE_SENSOR: 2000,
  WINDOW_HANDLE: 2001,
  SHUTTER_POSITION_SWITCH: 2002,
  OPEN_CLOSE_AND_TEMPERATURE_SENSOR: 2003,
  ELECTRIC_MOTOR_METERING_SWITCH: 2004,
  OPEN_CLOSE_WITH_TEMPERATURE_AND_BRIGHTNESS_SENSOR: 2005,
  ELECTRIC_MOTOR_METERING_SWITCH_WITHOUT_SLAT_POSITION: 2006,
  WIFI_OPEN_CLOSE_SENSOR: 2018,
  WIFI_ELECTRIC_MOTOR_METERING_SWITCH: 2019,
} as const;

export const AttributeType = {
  ON_OFF: 1,
  DIMMING_LEVEL: 2,
  TEMPERATURE: 5,
  RELATIVE_HUMIDITY: 7,
  BATTERY_LEVEL: 8,
  BRIGHTNESS: 11,
  FLOOD_ALARM: 12,
  OPEN_CLOSE: 14,
  POSITION: 15,
  SMOKE_ALARM: 16,
  MOTION_ALARM: 25,
  LEAK_ALARM: 68,
  BATTERY_LOW_ALARM: 69,
  MALFUNCTION_ALARM: 70,
  PRESENCE_ALARM: 76,
  POLLING_INTERVAL: 88,
  UP_DOWN: 135,
  IMPULSE: 304,
  WATCHDOG_ON_OFF: 385,
  // Not yet in public enum lists; reported in dBm by firmware 2.41+.
  SIGNAL_STRENGTH: 411,
} as const;

export const UpDown = {
  OPEN: 0,
  CLOSED: 1,
  STOPPED: 2,
  OPENING: 3,
  CLOSING: 4,
} as const;

export const NODE_STATE_AVAILABLE = 1;

const reverse = (table: Record<string, number>) =>
  new Map(Object.entries(table).map(([k, v]) => [v, k]));
const profileNames = reverse(NodeProfile);
const attributeNames = reverse(AttributeType);

export const profileName = (id: number) =>
  profileNames.get(id) ?? `PROFILE_${id}`;
export const attributeName = (id: number) =>
  attributeNames.get(id) ?? `ATTRIBUTE_${id}`;
