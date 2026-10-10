/**
 * Klipper temperature object classification.
 * Prefixes are the established Klipper config section names.
 */

export type SensorKind = 'heater' | 'fan' | 'sensor';

export function classifySensor(name: string): SensorKind | null {
  if (/^extruder\d*$/.test(name)) return 'heater';
  if (name === 'heater_bed') return 'heater';
  if (name.startsWith('heater_generic ')) return 'heater';
  if (name.startsWith('temperature_fan ')) return 'fan';
  if (name.startsWith('temperature_sensor ')) return 'sensor';
  if (name === 'temperature_host' || name.startsWith('temperature_host ')) return 'sensor';
  if (name === 'temperature_mcu' || name.startsWith('temperature_mcu ')) return 'sensor';
  return null;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function displayName(name: string): string {
  if (/^extruder\d*$/.test(name)) return titleCase(name);
  if (name === 'heater_bed') return 'Heater Bed';
  if (name.startsWith('heater_generic ')) return titleCase(name.replace('heater_generic ', ''));
  if (name.startsWith('temperature_fan ')) return titleCase(name.replace('temperature_fan ', ''));
  if (name.startsWith('temperature_sensor ')) return titleCase(name.replace('temperature_sensor ', ''));
  if (name === 'temperature_host' || name.startsWith('temperature_host ')) return 'Host';
  if (name === 'temperature_mcu' || name.startsWith('temperature_mcu ')) return 'MCU';
  return name;
}

/**
 * Ordering similar to Fluidd: extruders, bed, other heaters, fans, passive sensors.
 */
export function sensorSortKey(name: string, kind: SensorKind): number {
  if (/^extruder/.test(name)) return 0;
  if (name === 'heater_bed') return 1;
  if (kind === 'heater') return 2;
  if (kind === 'fan') return 3;
  return 4;
}

/**
 * Builds the gcode to set a target temperature.
 * Returns null for passive sensors.
 */
export function buildTargetGcode(
  name: string,
  kind: SensorKind,
  target: number,
): string | null {
  if (kind === 'fan') {
    const fan = name.replace(/^temperature_fan /, '');
    return `SET_TEMPERATURE_FAN_TARGET FAN=${fan} TARGET=${target}`;
  }

  if (kind === 'heater') {
    const heater = name.startsWith('heater_generic ')
      ? name.replace(/^heater_generic /, '')
      : name;
    return `SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${target}`;
  }

  return null;
}