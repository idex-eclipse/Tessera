/**
 * Подключённые устройства из Moonraker (machine.peripherals.*) в виде карточек для
 * панели редактора. Чистая логика: request передаётся снаружи, DOM не нужен.
 *
 * Схема ответов описана по документации Moonraker; поля, которых мы не знаем,
 * всё равно попадают в карточку, а форма ответа никогда не бросает исключений —
 * в худшем случае список пуст.
 */

export type DeviceKind = 'serial' | 'canbus' | 'usb' | 'video';

export const DEVICE_KINDS: readonly DeviceKind[] = ['serial', 'canbus', 'usb', 'video'];

export interface DeviceField {
  key: string;
  value: string;
  /** путь или идентификатор, который имеет смысл копировать / вставлять в конфиг */
  copyable: boolean;
}

export interface DeviceCard {
  id: string;
  title: string;
  subtitle?: string;
  fields: DeviceField[];
}

export type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

export const DEFAULT_CAN_INTERFACE = 'can0';

const CAN_INTERFACE_RE = /^[\w.-]{1,32}$/;

const COPYABLE_KEYS = new Set([
  'device_path',
  'path_by_id',
  'path_by_hardware',
  'uuid',
  'serial',
  'usb_location',
  'libcamera_id',
  'vendor_id',
  'product_id',
  'vendor_product',
]);

type Json = Record<string, unknown>;

export function isValidCanInterface(name: string): boolean {
  return CAN_INTERFACE_RE.test(name.trim());
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function formatValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  }
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function toFields(item: Json, extra: DeviceField[] = []): DeviceField[] {
  const fields: DeviceField[] = [...extra];
  for (const [key, raw] of Object.entries(item)) {
    const value = formatValue(raw);
    if (value === null || value === '') continue;
    fields.push({ key, value, copyable: COPYABLE_KEYS.has(key) });
  }
  // пути и идентификаторы — наверх (порядок внутри групп сохраняется)
  return [...fields.filter((f) => f.copyable), ...fields.filter((f) => !f.copyable)];
}

function items(resp: unknown, key: string): Json[] {
  if (!isObject(resp)) return [];
  const list = resp[key];
  return Array.isArray(list) ? list.filter(isObject) : [];
}

function joinParts(...parts: string[]): string | undefined {
  const s = parts.filter(Boolean).join(' · ');
  return s || undefined;
}

function serialCards(resp: unknown): DeviceCard[] {
  const cards = items(resp, 'serial_devices').map((d, i) => {
    const path = str(d.device_path);
    return {
      id: `serial:${i}`,
      title: path || str(d.path_by_id) || str(d.device_name) || 'serial',
      subtitle: joinParts(str(d.device_name), str(d.device_type), str(d.driver_name)),
      fields: toFields(d),
    };
  });
  // устройства со стабильным by-id — первыми: именно их вписывают в [mcu] serial:
  return [...cards.filter((c) => c.fields.some((f) => f.key === 'path_by_id')),
    ...cards.filter((c) => !c.fields.some((f) => f.key === 'path_by_id'))];
}

function usbCards(resp: unknown): DeviceCard[] {
  return items(resp, 'usb_devices').map((d, i) => {
    const vid = str(d.vendor_id);
    const pid = str(d.product_id);
    const vp = vid && pid ? `${vid}:${pid}` : '';
    const extra: DeviceField[] = vp ? [{ key: 'vendor_product', value: vp, copyable: true }] : [];
    return {
      id: `usb:${i}`,
      title: str(d.product) || str(d.description) || vp || 'usb',
      subtitle: joinParts(str(d.manufacturer), vp),
      fields: toFields(d, extra),
    };
  });
}

function videoCards(resp: unknown): DeviceCard[] {
  const v4l2 = items(resp, 'v4l2_devices').map((d, i) => ({
    id: `video:v4l2:${i}`,
    title: str(d.camera_name) || str(d.device_name) || str(d.device_path) || 'v4l2',
    subtitle: joinParts('v4l2', str(d.driver_name), str(d.device_path)),
    fields: toFields(d),
  }));
  const libcamera = items(resp, 'libcamera_devices').map((d, i) => ({
    id: `video:libcamera:${i}`,
    title: str(d.model) || str(d.libcamera_id) || 'libcamera',
    subtitle: 'libcamera',
    fields: toFields(d),
  }));
  return [...v4l2, ...libcamera];
}

function canCards(resp: unknown): DeviceCard[] {
  return items(resp, 'can_uuids').map((d, i) => ({
    id: `canbus:${i}`,
    title: str(d.uuid) || 'canbus',
    subtitle: str(d.application) || undefined,
    fields: toFields(d),
  }));
}

export async function loadDevices(
  request: RequestFn,
  kind: DeviceKind,
  opts: { canInterface?: string } = {},
): Promise<DeviceCard[]> {
  switch (kind) {
    case 'serial':
      return serialCards(await request('machine.peripherals.serial'));
    case 'usb':
      return usbCards(await request('machine.peripherals.usb'));
    case 'video':
      return videoCards(await request('machine.peripherals.video'));
    case 'canbus': {
      const iface = (opts.canInterface ?? '').trim() || DEFAULT_CAN_INTERFACE;
      if (!isValidCanInterface(iface)) throw new Error(`Invalid CAN interface: ${iface}`);
      return canCards(await request('machine.peripherals.canbus', { interface: iface }));
    }
  }
}

export type DeviceErrorStatus = 'unsupported' | 'offline' | 'error';

/** Раскладывает ошибку запроса по понятным пользователю состояниям панели. */
export function classifyError(e: unknown): { status: DeviceErrorStatus; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (/Method not found/i.test(message)) return { status: 'unsupported', message };
  if (/connection (is not open|closed)/i.test(message)) return { status: 'offline', message };
  return { status: 'error', message };
}
