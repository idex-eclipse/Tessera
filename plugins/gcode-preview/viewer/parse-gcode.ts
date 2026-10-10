export interface GcodeObject {
  name: string;
  polygon: Array<{ x: number; y: number }>;
}

export interface ParsedGcode {
  positions: Float32Array;   // x1,y1,z1,x2,y2,z2 на сегмент
  kinds: Uint8Array;         // 0 = travel, 1 = extrude
  extruders: Uint8Array;
  layers: Uint16Array;       // монотонно неубывающий
  offsets: Uint32Array;      // байтовая позиция строки-источника
  layerStart: Uint32Array;   // сегменты слоя l = [layerStart[l], layerStart[l+1]); длина layerCount+1
  layerZ: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  extruderCount: number;
  moveCount: number;
  objects: GcodeObject[];
  segTypes: Uint8Array;
  typeNames: string[];
}

const TAU = Math.PI * 2;

export function parseGcode(text: string): ParsedGcode {
  let cap = 1 << 16;
  let positions = new Float32Array(cap * 6);
  let kinds = new Uint8Array(cap);
  let extruders = new Uint8Array(cap);
  let layers = new Uint16Array(cap);
  let offsets = new Uint32Array(cap);
  let segTypes = new Uint8Array(cap);
  const typeNames: string[] = ['other'];
  let currentType = 0;
  let n = 0;

  function ensureCap(): void {
    if (n < cap) return;
    cap *= 2;
    const p2 = new Float32Array(cap * 6); p2.set(positions); positions = p2;
    const k2 = new Uint8Array(cap); k2.set(kinds); kinds = k2;
    const e2 = new Uint8Array(cap); e2.set(extruders); extruders = e2;
    const l2 = new Uint16Array(cap); l2.set(layers); layers = l2;
    const o2 = new Uint32Array(cap); o2.set(offsets); offsets = o2;
    const t2 = new Uint8Array(cap); t2.set(segTypes); segTypes = t2;
  }

  const layerZ: number[] = [];
  const objects: GcodeObject[] = [];

  let x = 0, y = 0, z = 0, e = 0;
  let layer = 0;
  let extruder = 0;
  let relative = false;
  let relativeE = false;
  let extruderCount = 1;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let lineOffset = 0;
  let byteCursor = 0;

  function pushSeg(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    extruding: boolean,
  ): void {
    ensureCap();
    const o = n * 6;
    positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az;
    positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz;
    kinds[n] = extruding ? 1 : 0;
    extruders[n] = extruder;
    layers[n] = layer;
    offsets[n] = lineOffset;
    segTypes[n] = currentType;
    n++;

    if (extruding) {
      minX = Math.min(minX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxX = Math.max(maxX, ax, bx);
      maxY = Math.max(maxY, ay, by);
    }
  }

  function setLayer(nz: number): void {
    if (nz === z) return;
    z = nz;
    layer = layerZ.indexOf(z);
    if (layer < 0) {
      layerZ.push(z);
      layer = layerZ.length - 1;
    }
  }

  function arc(
    cx: number, cy: number,
    ax: number, ay: number, bx: number, by: number,
    cw: boolean, extruding: boolean,
  ): void {
    const r = Math.hypot(ax - cx, ay - cy);
    if (r <= 0) return;
    const a1 = Math.atan2(ay - cy, ax - cx);
    let a2 = Math.atan2(by - cy, bx - cx);
    if (cw) while (a2 >= a1) a2 -= TAU;
    else while (a2 <= a1) a2 += TAU;

    const steps = Math.max(8, Math.min(64, Math.ceil(Math.abs(a2 - a1) / (TAU / 48))));
    let px = ax, py = ay;
    for (let i = 1; i <= steps; i++) {
      const a = a1 + ((a2 - a1) * i) / steps;
      const nx = cx + r * Math.cos(a);
      const ny = cy + r * Math.sin(a);
      pushSeg(px, py, z, nx, ny, z, extruding);
      px = nx; py = ny;
    }
  }

  const lines = text.split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const orig = lines[li]!;
    lineOffset = byteCursor;
    byteCursor += orig.length + 1;

    const trimmed = orig.trim();
    if (trimmed.toUpperCase().startsWith(';TYPE:')) {
    const name = trimmed.slice(6).trim() || 'other';
    let idx = typeNames.indexOf(name);
    if (idx < 0) {
        if (typeNames.length < 255) {
        typeNames.push(name);
        idx = typeNames.length - 1;
        } else idx = 0;
    }
    currentType = idx;
    // это комментарий, движения нет — но байт-курсор уже учтён выше
    }

    let raw = orig;
    const ci = raw.indexOf(';');
    if (ci >= 0) raw = raw.slice(0, ci);
    if (raw.trim() === '') continue;

    const parts = raw.trim().split(/\s+/);
    const cmd = (parts[0] ?? '').toUpperCase();

    if (cmd === 'G90') { relative = false; continue; }
    if (cmd === 'G91') { relative = true; continue; }
    if (cmd === 'M82') { relativeE = false; continue; }
    if (cmd === 'M83') { relativeE = true; continue; }

    if (cmd === 'G92') {
      for (let i = 1; i < parts.length; i++) {
        if (parts[i]![0]?.toUpperCase() === 'E') e = 0;
      }
      continue;
    }

    if (cmd === 'EXCLUDE_OBJECT_DEFINE') {
      const nameM = /NAME=(\S+)/i.exec(raw);
      const polyM = /POLYGON=(\[\[.*?\]\])/i.exec(raw);
      if (polyM) {
        const pts: Array<{ x: number; y: number }> = [];
        const inner = polyM[1]!.slice(2, -2);
        for (const pair of inner.split('],[')) {
          const [xs, ys] = pair.split(',');
          const px = parseFloat(xs ?? '');
          const py = parseFloat(ys ?? '');
          if (Number.isFinite(px) && Number.isFinite(py)) pts.push({ x: px, y: py });
        }
        if (pts.length > 0) {
          objects.push({ name: nameM?.[1] ?? `obj${objects.length}`, polygon: pts });
        }
      }
      continue;
    }

    if (cmd.length === 2 && cmd[0] === 'T') {
      const t = parseInt(cmd.slice(1), 10);
      if (Number.isFinite(t)) {
        extruder = Math.min(255, t);
        extruderCount = Math.max(extruderCount, t + 1);
      }
      continue;
    }

    if (cmd === 'G0' || cmd === 'G1' || cmd === 'G2' || cmd === 'G3') {
      let nx = x, ny = y, nz = z, ne = e;
      let hasE = false;
      let i = 0, j = 0;

      for (let k = 1; k < parts.length; k++) {
        const p = parts[k]!;
        const letter = p[0]?.toUpperCase();
        const val = parseFloat(p.slice(1));
        if (!Number.isFinite(val)) continue;

        if (letter === 'X') nx = relative ? x + val : val;
        else if (letter === 'Y') ny = relative ? y + val : val;
        else if (letter === 'Z') nz = relative ? z + val : val;
        else if (letter === 'E') { ne = relativeE ? e + val : val; hasE = true; }
        else if (letter === 'I') i = val;
        else if (letter === 'J') j = val;
      }

      setLayer(nz);
      const extruding = hasE && ne > e;

      if (cmd === 'G2' || cmd === 'G3') {
        arc(x + i, y + j, x, y, nx, ny, cmd === 'G2', extruding);
      } else if (nx !== x || ny !== y) {
        pushSeg(x, y, z, nx, ny, nz, extruding);
      }

      x = nx; y = ny; e = ne;
    }
  }

  // границы диапазонов слоёв (слои монотонны)
  const layerCount = layerZ.length;
  const layerStart = new Uint32Array(layerCount + 1);
  let cur = 0;
  layerStart[0] = 0;
  for (let i = 0; i < n; i++) {
    while (cur < layers[i]!) {
      cur++;
      layerStart[cur] = i;
    }
  }
  while (cur < layerCount) {
    cur++;
    layerStart[cur] = n;
  }
  layerStart[layerCount] = n;

  return {
    positions: positions.slice(0, n * 6),
    kinds: kinds.slice(0, n),
    extruders: extruders.slice(0, n),
    layers: layers.slice(0, n),
    offsets: offsets.slice(0, n),
    layerStart,
    layerZ,
    bounds: Number.isFinite(minX)
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    extruderCount,
    moveCount: n,
    objects,
    segTypes: segTypes.slice(0, n),
    typeNames,
  };
}

export function segmentAtOffset(parsed: ParsedGcode, offset: number): number {
  let lo = 0;
  let hi = parsed.moveCount - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((parsed.offsets[mid] ?? 0) <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}