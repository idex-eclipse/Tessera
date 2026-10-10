const CURRENT_PREFIX = 'mpu:v2:';
const MPU_PREFIX = 'mpu:';

export function detectLegacy(storage: Storage = localStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(MPU_PREFIX) && !k.startsWith(CURRENT_PREFIX)) keys.push(k);
  }
  return keys;
}

export function collectLegacy(storage: Storage = localStorage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of detectLegacy(storage)) {
    try {
      out[k] = storage.getItem(k);
    } catch {
      out[k] = null;
    }
  }
  return out;
}

export function exportLegacy(storage: Storage = localStorage): void {
  const blob = new Blob([JSON.stringify(collectLegacy(storage), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mpu-legacy-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function resetLegacy(storage: Storage = localStorage): void {
  for (const k of detectLegacy(storage)) {
    try {
      storage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}