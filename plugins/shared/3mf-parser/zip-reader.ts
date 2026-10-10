// Минимальный read-only ZIP-ридер: central directory + ленивое извлечение записей.
// Без сторонних зависимостей: deflate через DecompressionStream('deflate-raw').
// Не универсальная библиотека — ровно то, что нужно 3MF-инспектору.

export class ZipError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly method: number;          // 0 = stored, 8 = deflate
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  getEntry(name: string): ZipEntry | undefined;
  find(re: RegExp): ZipEntry[];
  readEntry(entry: ZipEntry, signal?: AbortSignal): Promise<Uint8Array>;
  readText(entry: ZipEntry, signal?: AbortSignal): Promise<string>;
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const DEFAULT_MAX_ENTRIES = 5000;
const TAIL_WINDOW = 66_000;         // EOCD (22) + максимум комментария (65535) + запас

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Сканирует buf ОТ from ВНИЗ до 0 в поисках 4-байтовой little-endian сигнатуры. */
function findSignature(buf: Uint8Array, sig: number, from: number): number {
  const b0 = sig & 0xff;
  const b1 = (sig >>> 8) & 0xff;
  const b2 = (sig >>> 16) & 0xff;
  const b3 = (sig >>> 24) & 0xff;
  for (let i = Math.min(from, buf.length - 4); i >= 0; i--) {
    if (buf[i] === b0 && buf[i + 1] === b1 && buf[i + 2] === b2 && buf[i + 3] === b3) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('no-inflate');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function openZip(
  blob: Blob,
  opts: { maxEntries?: number; signal?: AbortSignal } = {},
): Promise<ZipArchive> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const tailSize = Math.min(blob.size, TAIL_WINDOW);
  const tail = new Uint8Array(await blob.slice(blob.size - tailSize).arrayBuffer());
  const tv = view(tail);

  const eocdAt = findSignature(tail, EOCD_SIG, tail.length - 22);
  if (eocdAt < 0) throw new ZipError('not-a-zip');

  let totalEntries = tv.getUint16(eocdAt + 10, true);
  let cdSize = tv.getUint32(eocdAt + 12, true);
  let cdOffset = tv.getUint32(eocdAt + 16, true);

  // Zip64: только EOCD-уровень; zip64-записи (0xFFFFFFFF в размерах) ниже отклоняются.
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locAt = findSignature(tail, EOCD64_LOC_SIG, tail.length - 20);
    if (locAt < 0) throw new ZipError('zip64-no-locator');
    const eocd64Offset = Number(tv.getBigUint64(locAt + 8, true));
    const head = new Uint8Array(await blob.slice(eocd64Offset, eocd64Offset + 56).arrayBuffer());
    const hv = view(head);
    if (hv.getUint32(0, true) !== EOCD64_SIG) throw new ZipError('zip64-bad-eocd');
    totalEntries = Number(hv.getBigUint64(32, true));
    cdSize = Number(hv.getBigUint64(40, true));
    cdOffset = Number(hv.getBigUint64(48, true));
  }
  if (totalEntries > maxEntries) throw new ZipError('too-many-entries');

  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cv = view(cd);
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cv.getUint32(p, true) === CD_SIG) {
    const compressedSize = cv.getUint32(p + 20, true);
    const uncompressedSize = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const localHeaderOffset = cv.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipError('zip64-entry');
    }
    entries.push({
      name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)),
      method: cv.getUint16(p + 10, true),
      compressedSize,
      uncompressedSize,
      crc32: cv.getUint32(p + 16, true),
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const byName = new Map<string, ZipEntry>();
  for (const e of entries) byName.set(e.name, e);

  async function readEntry(entry: ZipEntry, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw new ZipError('aborted');
    if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported-method', entry.name);
    const lh = new Uint8Array(
      await blob.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer(),
    );
    const lv = view(lh);
    if (lv.getUint32(0, true) !== LOCAL_SIG) throw new ZipError('bad-local-header', entry.name);
    // Размеры берём из central directory: local-заголовки с data descriptor (bit 3) содержат нули.
    const start = entry.localHeaderOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    const end = start + entry.compressedSize;
    if (end > blob.size) throw new ZipError('truncated', entry.name);
    const raw = new Uint8Array(await blob.slice(start, end).arrayBuffer());
    if (signal?.aborted) throw new ZipError('aborted');
    return entry.method === 0 ? raw : inflateRaw(raw);
  }

  return {
    entries,
    getEntry: (name) => byName.get(name),
    find: (re) => entries.filter((e) => re.test(e.name)),
    readEntry,
    readText: async (entry, signal) => new TextDecoder().decode(await readEntry(entry, signal)),
  };
}