import { AttributeType, NodeProfile } from '../homee/enums.js';
import type { HomeeNode } from '../homee/types.js';
import { findAttribute } from '../homee/util.js';

import { HAP } from './hap.js';
import type { CharacteristicSpec, HapValue, ServiceSpec } from './types.js';

interface SensorRule {
  attribute: number;
  service: string;
  characteristic: string;
  convert(value: number): HapValue;
  props?: CharacteristicSpec['props'];
}

const RULES: SensorRule[] = [
  {
    attribute: AttributeType.TEMPERATURE,
    service: 'TemperatureSensor',
    characteristic: 'CurrentTemperature',
    convert: (v) => v,
    props: { minValue: -50, maxValue: 100 },
  },
  {
    attribute: AttributeType.RELATIVE_HUMIDITY,
    service: 'HumiditySensor',
    characteristic: 'CurrentRelativeHumidity',
    convert: (v) => v,
  },
  {
    attribute: AttributeType.BRIGHTNESS,
    service: 'LightSensor',
    characteristic: 'CurrentAmbientLightLevel',
    convert: (v) => Math.max(0.0001, v),
  },
  {
    attribute: AttributeType.MOTION_ALARM,
    service: 'MotionSensor',
    characteristic: 'MotionDetected',
    convert: Boolean,
  },
  {
    attribute: AttributeType.PRESENCE_ALARM,
    service: 'OccupancySensor',
    characteristic: 'OccupancyDetected',
    convert: (v) => (v ? 1 : 0),
  },
  {
    attribute: AttributeType.SMOKE_ALARM,
    service: 'SmokeSensor',
    characteristic: 'SmokeDetected',
    convert: (v) => (v ? 1 : 0),
  },
  {
    attribute: AttributeType.FLOOD_ALARM,
    service: 'LeakSensor',
    characteristic: 'LeakDetected',
    convert: (v) => (v ? 1 : 0),
  },
  {
    attribute: AttributeType.LEAK_ALARM,
    service: 'LeakSensor',
    characteristic: 'LeakDetected',
    convert: (v) => (v ? 1 : 0),
  },
];

const CONTACT_PROFILES: ReadonlySet<number> = new Set([
  NodeProfile.OPEN_CLOSE_SENSOR,
  NodeProfile.OPEN_CLOSE_AND_TEMPERATURE_SENSOR,
  NodeProfile.OPEN_CLOSE_WITH_TEMPERATURE_AND_BRIGHTNESS_SENSOR,
  NodeProfile.WIFI_OPEN_CLOSE_SENSOR,
  NodeProfile.WINDOW_HANDLE,
]);

const valueOf = (node: HomeeNode, type: number) =>
  findAttribute(node, type)?.current_value ?? 0;

export function sensorServices(node: HomeeNode): ServiceSpec[] {
  const services = new Map<string, ServiceSpec>();

  for (const rule of RULES) {
    if (services.has(rule.service) || !findAttribute(node, rule.attribute))
      continue;
    services.set(rule.service, {
      type: rule.service,
      subtype: rule.service,
      name: '',
      characteristics: [
        {
          type: rule.characteristic,
          read: (n) => rule.convert(valueOf(n, rule.attribute)),
          props: rule.props,
        },
      ],
    });
  }

  if (
    CONTACT_PROFILES.has(node.profile) &&
    findAttribute(node, AttributeType.OPEN_CLOSE)
  ) {
    services.set('ContactSensor', {
      type: 'ContactSensor',
      subtype: 'ContactSensor',
      name: '',
      characteristics: [
        {
          type: 'ContactSensorState',
          read: (n) =>
            valueOf(n, AttributeType.OPEN_CLOSE)
              ? HAP.ContactSensorState.NOT_DETECTED
              : HAP.ContactSensorState.DETECTED,
        },
      ],
    });
  }

  if (findAttribute(node, AttributeType.BATTERY_LEVEL)) {
    services.set('Battery', {
      type: 'Battery',
      subtype: 'Battery',
      name: 'Battery',
      characteristics: [
        {
          type: 'BatteryLevel',
          read: (n) => Math.round(valueOf(n, AttributeType.BATTERY_LEVEL)),
        },
        {
          type: 'StatusLowBattery',
          read: (n) => {
            const low = findAttribute(n, AttributeType.BATTERY_LOW_ALARM);
            const isLow = low
              ? Boolean(low.current_value)
              : valueOf(n, AttributeType.BATTERY_LEVEL) < 15;

            return isLow
              ? HAP.StatusLowBattery.LOW
              : HAP.StatusLowBattery.NORMAL;
          },
        },
        { type: 'ChargingState', read: () => HAP.ChargingState.NOT_CHARGEABLE },
      ],
    });
  }

  return [...services.values()];
}
