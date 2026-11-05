/**
 * Детект кинематики по configfile.settings (Moonraker).
 *
 * corexy:  [printer] kinematics: corexy
 *          ИЛИ generic_cartesian с corexy-математикой кареток:
 *            [carriage <n>] axis: x|y
 *            [stepper <a>] carriages: <x> + <y>   (сумма)
 *            [stepper <b>] carriages: <x> - <y>   (разность, порядок любой)
 * delta:   [printer] kinematics: delta
 * cartesian: всё остальное распознанное; unknown: секции [printer] нет.
 *
 * Чистая функция: тесты без прокси.
 */

export type Kinematics = 'corexy' | 'delta' | 'cartesian' | 'unknown';

type Section = Record<string, unknown>;

export function detectKinematics(settings: Record<string, Section>): Kinematics {
  const printer = settings['printer'];
  if (!printer || typeof printer !== 'object') return 'unknown';

  // в конфиге встречались оба написания ключа
  const raw = String(printer.kinematics ?? printer.kinematic ?? '')
    .trim()
    .toLowerCase();

  if (raw === 'delta') return 'delta';
  if (raw === 'corexy') return 'corexy';
  if (raw === 'generic_cartesian') {
    return isCoreXYCarriageMath(settings) ? 'corexy' : 'cartesian';
  }
  if (raw === '') return 'unknown';
  return 'cartesian'; // cartesian и прочие (hybrid_* намеренно не считаем corexy)
}

/** Сумма/разность кареток по двум степперам = corexy-математика. */
function isCoreXYCarriageMath(settings: Record<string, Section>): boolean {
  const axisOf = new Map<string, 'x' | 'y'>();

  for (const [key, sec] of Object.entries(settings)) {
    if (!key.toLowerCase().startsWith('carriage ')) continue;
    const name = key.substring('carriage '.length).trim().toLowerCase();
    const axis = String(sec?.axis ?? '').trim().toLowerCase();
    if (axis === 'x' || axis === 'y') axisOf.set(name, axis);
  }
  if (axisOf.size < 2) return false;

  let sumSeen = false;
  let diffSeen = false;

  for (const [key, sec] of Object.entries(settings)) {
    if (!key.toLowerCase().startsWith('stepper ')) continue;
    const expr = String(sec?.carriages ?? '').trim();
    if (!expr) continue;
    const prod = signProduct(parseCarriages(expr), axisOf);
    if (prod === 1) sumSeen = true;
    else if (prod === -1) diffSeen = true;
  }

  return sumSeen && diffSeen;
}

/** "xc + yc" / "yc - xc" / … → [{name, sign}]; порядок и знак первого токена любые. */
function parseCarriages(expr: string): Array<{ name: string; sign: 1 | -1 }> {
  const out: Array<{ name: string; sign: 1 | -1 }> = [];
  const re = /([+-]?)\s*([^+-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const name = (m[2] ?? '').trim().toLowerCase();
    if (!name) continue;
    out.push({ name, sign: m[1] === '-' ? -1 : 1 });
  }
  return out;
}

/** +1 = сумма осей, -1 = разность, 0 = нельзя судить (неизвестная/конфликтующая ось).
 *  Глобальный знак не важен: {-x,-y} тоже сумма, {-x,+y} тоже разность. */
function signProduct(
  entries: Array<{ name: string; sign: 1 | -1 }>,
  axisOf: Map<string, 'x' | 'y'>,
): 0 | 1 | -1 {
  const byAxis: { x?: 1 | -1; y?: 1 | -1 } = {};

  for (const e of entries) {
    const axis = axisOf.get(e.name);
    if (!axis) return 0;
    const prev = byAxis[axis];
    if (prev !== undefined && prev !== e.sign) return 0; // одна ось дважды с разными знаками
    byAxis[axis] = e.sign;
  }

  if (byAxis.x === undefined || byAxis.y === undefined) return 0;
  return byAxis.x * byAxis.y === 1 ? 1 : -1;
}