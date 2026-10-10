/**
 * Minimal storage abstraction.
 *
 * In browser this is localStorage.
 * In tests we use MemoryStorage.
 */

export interface StorageLike {
  readonly length: number;

  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * In-memory storage for tests and non-browser environments.
 */
export class MemoryStorage implements StorageLike {
  private items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.items.keys());
    return keys[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Reads JSON from storage.
 * Returns fallback on missing value or parse error.
 */
export function readJson<T>(
  storage: StorageLike,
  key: string,
  fallback: T,
): T {
  try {
    const raw = storage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Writes JSON to storage.
 * Swallows storage errors intentionally.
 */
export function writeJson(
  storage: StorageLike,
  key: string,
  value: unknown,
): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write errors.
  }
}

/**
 * Removes key from storage.
 */
export function removeItem(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage remove errors.
  }
}