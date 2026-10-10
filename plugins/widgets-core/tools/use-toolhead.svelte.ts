import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

export const DEFAULT_STEPS = [0.1, 1, 10, 25, 50, 100];

export const DC_MODES = ['PRIMARY', 'COPY', 'MIRROR'] as const;
export type DualCarriageMode = (typeof DC_MODES)[number];

//Spoolman
export interface SpoolFilament {
  id: number;
  name: string;
  vendor?: { id: number; name: string };
  material?: string;
  /** HEX без '#', например "BD0B0B". */
  color_hex?: string;
  /** Номинальный вес катушки, г. */
  weight?: number;
}

export interface SpoolData {
  id: number;
  filament: SpoolFilament;
  remaining_weight?: number;
  used_weight?: number;
  remaining_length?: number;
  used_length?: number;
  archived?: boolean;
}

//Tool
interface ToolheadMeta {
  ready: boolean;
  tools: string[];
  extruders: string[];
  steppers: string[];
  minExtrudeTemp: Record<string, number>;
  maxZVelocity: number;
  hasDualCarriage: boolean;
  dualKey: string;
  directPrimaryAxis: string;
  hasRetraction: boolean;
  defaults: {
    pa: Record<string, { advance: number; smooth: number }>;
    retraction: { length: number; speed: number; extra: number; unspeed: number };
  };
  hasSaveVars: boolean;
  hasSpoolman: boolean;
}

let meta = $state<ToolheadMeta>({
  ready: false,
  tools: [],
  extruders: [],
  steppers: [],
  minExtrudeTemp: {},
  maxZVelocity: 5,
  hasDualCarriage: false,
  dualKey: 'carriage_1',
  directPrimaryAxis: 'x',
  hasRetraction: false,
  defaults: {
    pa: {},
    retraction: { length: 0, speed: 0, extra: 0, unspeed: 0 },
  },
  hasSaveVars: false,
  hasSpoolman: false,
});

let th = $state({
  position: [0, 0, 0] as number[],
  homedAxes: '',
  activeExtruder: 'extruder',
  speedFactor: 1,
  extrudeFactor: 1,
  temps: {} as Record<string, number>,
  dcModes: {} as Record<string, string>,
  gcodePosition: [0, 0, 0] as number[],
  printState: '',
  pa: {} as Record<string, { advance: number; smooth: number }>,
  retraction: { length: 0, speed: 0, extra: 0, unspeed: 0 },
  activeToolSaved: null as string | null,
  spoolIds: {} as Record<string, number | null>,
  nativeSpoolId: null as number | null,
});

let forceMove = $state(false);

let ui = $state<{
  style: 'cross' | 'rows';
  invert: { x: boolean; y: boolean; z: boolean };
  steps: number[];
  feedXY: number;
  feedZ: number;
  //experimental direct mode
  directMode: boolean;
  directAxis: string;
}>({
  style: 'cross',
  invert: { x: false, y: false, z: false },
  steps: [...DEFAULT_STEPS],
  feedXY: 100,
  feedZ: 5,
  directMode: false,
  directAxis: 'U',
});

let uiLoaded = false;

// Spoolman-cache

const SPOOL_TTL = 60_000;
let spoolData = $state<Record<number, SpoolData>>({});
const spoolTs = new Map<number, number>();
const spoolInflight = new Map<number, Promise<SpoolData | null>>();
/** защита от записи ответа, прилетевшего после смены принтера */
let spoolOwner = 0;

export function useToolhead(api: PluginApi) {
  let generation = 0;
  const unsubs: Array<() => void> = [];
  let unsubMeta: (() => void) | null = null;

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
    } catch {
      return null;
    }
  }

  function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function script(cmd: string): void {
    safeHandle()
      ?.request('printer.gcode.script', { script: cmd })
      .catch((e) => console.error('[tools] gcode failed:', cmd, e));
  }

  // Spoolman fetch spool

  async function fetchSpool(id: number): Promise<SpoolData | null> {
    const inflight = spoolInflight.get(id);
    if (inflight) return inflight;

    const h = safeHandle();
    if (!h) return null;

    const owner = spoolOwner;
    const p = h
      .request<any>('server.spoolman.proxy', {
        use_v2_response: true,
        request_method: 'GET',
        path: `/v1/spool/${id}`,
      })
      .then((res) => {
        if (res?.error) {
          console.warn(`[tools] spool ${id}:`, res.error.message);
          return null;
        }
        const data = (res?.response ?? null) as SpoolData | null;
        if (data && owner === spoolOwner) {
          spoolData[id] = data;
          spoolTs.set(id, Date.now());
        }
        return data;
      })
      .catch((e) => {
        console.warn(`[tools] spool ${id} fetch failed:`, e);
        return null;
      })
      .finally(() => {
        spoolInflight.delete(id);
      });

    spoolInflight.set(id, p);
    return p;
  }

  // Spool ID
  function spoolIdForTool(tool: string): number | null {
    if (!meta.hasSpoolman) return null;
    const fromVars = th.spoolIds[tool];
    if (fromVars != null) return fromVars;
    if (meta.tools.length <= 1 && th.nativeSpoolId != null) return th.nativeSpoolId;
    return null;
  }

  // Get spool data
  function getSpool(id: number): SpoolData | null {
    const cached = spoolData[id];
    if (cached) {
      const ts = spoolTs.get(id) ?? 0;
      if (Date.now() - ts > SPOOL_TTL && !spoolInflight.has(id)) {
        void fetchSpool(id);
      }
      return cached;
    }
    void fetchSpool(id);
    return null;
  }

  async function refreshSpool(id: number): Promise<SpoolData | null> {
    return fetchSpool(id);
  }

  function spoolColorForTool(tool: string): string | undefined {
    const sid = spoolIdForTool(tool);
    if (sid == null) return undefined;
    const hex = getSpool(sid)?.filament?.color_hex;
    return hex ? `#${hex}` : undefined;
  }

  // Meta

  async function loadMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    const [list, cfgRes, srvInfo] = await Promise.all([
      h.request<any>('printer.objects.list').catch(() => null),
      h.request<any>('printer.objects.query', { objects: { configfile: ['settings'] } }).catch(() => null),
      h.request<any>('server.info').catch(() => null),
    ]);
    if (gen !== generation || !list) return;

    const objects: string[] = list.objects ?? [];
    const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;

    const hasSpoolman =
      Array.isArray(srvInfo?.components) && srvInfo.components.includes('spoolman');

    const macros = objects
      .filter((o) => o.startsWith('gcode_macro '))
      .map((o) => o.slice('gcode_macro '.length));

    const tools = macros
      .filter((m) => /^T\d+$/i.test(m))
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map((m) => m.toUpperCase());

    const extruders = Object.keys(settings).filter((k) => /^extruder\d*$/.test(k)).sort();

    const steppers = Object.keys(settings)
      .filter((k) => /^stepper[_ ]/.test(k) || /^extruder\d*$/.test(k))
      .sort();

    const minExtrudeTemp: Record<string, number> = {};
    for (const e of extruders) minExtrudeTemp[e] = Number(settings[e]?.min_extrude_temp ?? 170);

    const dcSection = Object.keys(settings).find(
      (k) => k === 'dual_carriage' || k.startsWith('dual_carriage '),
    );
    const dualKey = dcSection ? (dcSection.split(' ')[1] ?? 'carriage_1') : 'carriage_1';
    const dcCfg = dcSection ? settings[dcSection] : null;
    let directPrimaryAxis = 'x';
    if (dcCfg) {
      if (typeof dcCfg.primary_carriage === 'string' && dcCfg.primary_carriage) {
        directPrimaryAxis = axisOfCarriage(dcCfg.primary_carriage);
      } else if (typeof dcCfg.axis === 'string' && dcCfg.axis) {
        directPrimaryAxis = String(dcCfg.axis).toLowerCase();
      }
    }

    const paDefaults: Record<string, { advance: number; smooth: number }> = {};
    for (const e of extruders) {
      paDefaults[e] = {
        advance: Number(settings[e]?.pressure_advance ?? 0),
        smooth: Number(settings[e]?.pressure_advance_smooth_time ?? 0.04),
      };
    }

    const fr = settings.firmware_retraction;

    meta = {
      ready: true,
      tools,
      extruders,
      steppers,
      minExtrudeTemp,
      maxZVelocity: Number(settings.printer?.max_z_velocity ?? 5),
      hasDualCarriage: objects.includes('dual_carriage'),
      dualKey,
      directPrimaryAxis,
      hasRetraction: Boolean(fr),
      defaults: {
        pa: paDefaults,
        retraction: {
          length: Number(fr?.retract_length ?? 0),
          speed: Number(fr?.retract_speed ?? 20),
          extra: Number(fr?.unretract_extra_length ?? 0),
          unspeed: Number(fr?.unretract_speed ?? 10),
        },
      },
      hasSaveVars: objects.includes('save_variables'),
      hasSpoolman,
    };

    console.debug('[tools] spoolman:', hasSpoolman, 'tools:', tools);

    const subObjects: Record<string, string[]> = {
      toolhead: ['position', 'homed_axes', 'extruder'],
      gcode_move: ['speed_factor', 'extrude_factor'],
    };
    if (meta.hasSaveVars) subObjects.save_variables = ['variables'];
    for (const e of extruders) subObjects[e] = ['temperature', 'pressure_advance', 'smooth_time'];
    if (objects.includes('firmware_retraction')) {
      subObjects.firmware_retraction = ['retract_length', 'retract_speed', 'unretract_extra_length', 'unretract_speed'];
    }
    if (meta.hasDualCarriage) {
      subObjects.dual_carriage = ['carriage_0', 'carriage_1', 'carriages'];
    }
    if (objects.includes('print_stats')) subObjects.print_stats = ['state'];

    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }

    unsubMeta = h.subscribe(
      subObjects,
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );

    const queryObjects: Record<string, string[] | null> = {
      toolhead: null,
      gcode_move: null,
    };
    if (meta.hasSaveVars) queryObjects.save_variables = null;
    for (const e of extruders) queryObjects[e] = null;
    if (objects.includes('firmware_retraction')) queryObjects.firmware_retraction = null;
    if (meta.hasDualCarriage) queryObjects.dual_carriage = null;
    if (objects.includes('print_stats')) queryObjects.print_stats = ['state'];

    const seeded = await h
      .request<any>('printer.objects.query', { objects: queryObjects })
      .catch(() => null);
    if (gen === generation && seeded?.status) applyDelta(seeded.status);

    // native spool ID via moonraker
    if (hasSpoolman) {
      h.request<any>('server.spoolman.get_spool_id')
        .then((res) => {
          if (gen !== generation) return;
          const id = Number(res?.spool_id);
          th = { ...th, nativeSpoolId: Number.isFinite(id) && id > 0 ? id : null };
        })
        .catch(() => { /* [spoolman] не настроен/недоступен */ });
    }
  }

  function applyDelta(d: any): void {
    const next = { ...th };

    const t = d?.toolhead;
    if (t) {
      if (Array.isArray(t.position)) next.position = [...t.position];
      if (typeof t.homed_axes === 'string') next.homedAxes = t.homed_axes;
      if (typeof t.extruder === 'string') next.activeExtruder = t.extruder;
    }

    const gm = d?.gcode_move;
    if (gm) {
      if (typeof gm.speed_factor === 'number') next.speedFactor = gm.speed_factor;
      if (typeof gm.extrude_factor === 'number') next.extrudeFactor = gm.extrude_factor;
      if (Array.isArray(gm.gcode_position)) next.gcodePosition = [...gm.gcode_position];
    }

    const ps = d?.print_stats;
    if (ps && typeof ps.state === 'string') next.printState = ps.state;

    const sv = d?.save_variables;
    if (sv && sv.variables && typeof sv.variables === 'object') {
      const raw = sv.variables.active_tool;
      if (raw == null) {
        next.activeToolSaved = null;
      } else {
        const n = Number(raw);
        next.activeToolSaved = Number.isFinite(n) ? `T${Math.round(n)}` : null;
      }

      // Spools ID per tool
      if (meta.hasSpoolman) {
        const ids: Record<string, number | null> = {};
        for (const tool of meta.tools) {
          const k = tool.toLowerCase();
          const rawId = sv.variables[`${k}__spool_id`];
          const n = Number(rawId);
          ids[tool] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
        }
        next.spoolIds = ids;
      }
    }

    for (const e of meta.extruders) {
      const ed = d?.[e];
      if (!ed) continue;
      const temp = num(ed.temperature);
      if (temp != null) next.temps = { ...next.temps, [e]: temp };
      const pa = num(ed.pressure_advance);
      const sm = num(ed.smooth_time);
      if (pa != null || sm != null) {
        const cur = next.pa[e] ?? { advance: 0, smooth: 0.04 };
        next.pa = {
          ...next.pa,
          [e]: { advance: pa ?? cur.advance, smooth: sm ?? cur.smooth },
        };
      }
    }

    const fr = d?.firmware_retraction;
    if (fr) {
      next.retraction = {
        length: num(fr.retract_length) ?? next.retraction.length,
        speed: num(fr.retract_speed) ?? next.retraction.speed,
        extra: num(fr.unretract_extra_length) ?? next.retraction.extra,
        unspeed: num(fr.unretract_speed) ?? next.retraction.unspeed,
      };
    }

    const dc = d?.dual_carriage;
    if (dc && typeof dc === 'object') {
      if (dc.carriages && typeof dc.carriages === 'object' && Object.keys(dc.carriages).length > 0) {
        const m: Record<string, string> = {};
        for (const [k, v] of Object.entries(dc.carriages)) {
          if (typeof v === 'string') m[cleanCarriage(k)] = v;
        }
        next.dcModes = m;
      } else {
        const m: Record<string, string> = {};
        if (typeof dc.carriage_0 === 'string') m.carriage_0 = dc.carriage_0;
        if (typeof dc.carriage_1 === 'string') m.carriage_1 = dc.carriage_1;
        if (Object.keys(m).length > 0) next.dcModes = m;
      }
    }

    th = next;
  }

  // Settings helpers

  function invertSign(): number {
    return api.settings.get<boolean>('tools.invert') === true ? -1 : 1;
  }

  function feedFor(axis: string): number {
    return axis === 'Z' ? Math.min(ui.feedZ, meta.maxZVelocity) : ui.feedXY;
  }

  function loadUi(): void {
    const rawInv = api.settings.get<unknown>('tools.invert');
    const inv =
      typeof rawInv === 'object' && rawInv !== null
        ? {
            x: Boolean((rawInv as any).x),
            y: Boolean((rawInv as any).y),
            z: Boolean((rawInv as any).z),
          }
        : rawInv === true
          ? { x: true, y: true, z: true }
          : { x: false, y: false, z: false };

    ui = {
      style: api.settings.get<'cross' | 'rows'>('tools.style') ?? 'cross',
      invert: inv,
      steps: [...(api.settings.get<number[]>('tools.steps') ?? DEFAULT_STEPS)],
      feedXY: Number(api.settings.get<number>('tools.feedXY') ?? 100),
      feedZ: Number(api.settings.get<number>('tools.feedZ') ?? 5),
      directMode: api.settings.get<boolean>('tools.directMode') === true,
      directAxis: String(api.settings.get<string>('tools.directAxis') ?? 'U'),
    };
  }

  function setFeed(key: 'feedXY' | 'feedZ', v: number): void {
    ui[key] = v;
    api.settings.set(`tools.${key}`, v);
  }

  function setStyle(s: 'cross' | 'rows'): void {
    ui.style = s;
    api.settings.set('tools.style', s);
  }

  function setInvert(axis: 'x' | 'y' | 'z', v: boolean): void {
    ui.invert = { ...ui.invert, [axis]: v };
    api.settings.set('tools.invert', ui.invert);
  }

  function setSteps(arr: number[]): void {
    ui.steps = [...arr];
    api.settings.set('tools.steps', ui.steps);
  }

  function setDirectMode(v: boolean): void {
    ui = { ...ui, directMode: v };
    api.settings.set('tools.directMode', v);
  }

  function setDirectAxis(axis: string): void {
    const trimmed = (axis || '').trim().toUpperCase();
    const first = trimmed.charAt(0);
    const a = /^[A-Z]$/.test(first) ? first : (ui.directAxis || 'U');
    ui = { ...ui, directAxis: a };
    api.settings.set('tools.directAxis', a);
  }

  function setPA(patch: { advance?: number; smooth?: number }): void {
    const e = th.activeExtruder;
    const cur = th.pa[e] ?? meta.defaults.pa[e] ?? { advance: 0, smooth: 0.04 };
    script(
      `SET_PRESSURE_ADVANCE EXTRUDER=${e} ADVANCE=${patch.advance ?? cur.advance} SMOOTH_TIME=${patch.smooth ?? cur.smooth}`,
    );
  }

  function setRetraction(patch: {
    length?: number;
    speed?: number;
    extra?: number;
    unspeed?: number;
  }): void {
    const parts: string[] = [];
    if (patch.length != null) parts.push(`RETRACT_LENGTH=${patch.length}`);
    if (patch.speed != null) parts.push(`RETRACT_SPEED=${patch.speed}`);
    if (patch.extra != null) parts.push(`UNRETRACT_EXTRA_LENGTH=${patch.extra}`);
    if (patch.unspeed != null) parts.push(`UNRETRACT_SPEED=${patch.unspeed}`);
    if (parts.length > 0) script(`SET_RETRACTION ${parts.join(' ')}`);
  }

  // Actions

  function jog(axis: 'X' | 'Y' | 'Z', dist: number, useInvert = true): void {
    const inv =
      useInvert && ui.invert[axis.toLowerCase() as 'x' | 'y' | 'z'] ? -1 : 1;
    const d = dist * inv;
    script(`G91\nG0 ${axis}${d} F${Math.round(feedFor(axis) * 60)}\nG90`);
  }

  function moveTo(axis: 'X' | 'Y' | 'Z', value: number): void {
    script(`G90\nG0 ${axis}${value} F${Math.round(feedFor(axis) * 60)}`);
  }

  function forceMoveStepper(stepper: string, dist: number): void {
    const d = dist * invertSign();
    const axis = stepper.toLowerCase().includes('z') ? 'Z' : 'X';
    script(`FORCE_MOVE STEPPER="${stepper}" DISTANCE=${d} VELOCITY=${feedFor(axis)}`);
  }

  const homeAll = () => script('G28');
  const homeAxes = (axes: string) => script(`G28 ${axes}`);
  const motorsOff = () => script('M84');
  const setSpeed = (pct: number) => script(`M220 S${Math.round(pct)}`);
  const setFlow = (pct: number) => script(`M221 S${Math.round(pct)}`);

  function extrude(dir: 1 | -1): void {
    const len = Number(api.settings.get<number>('tools.extrudeLen') ?? 10);
    const speed = Number(api.settings.get<number>('tools.extrudeSpeed') ?? 5);
    script(`M83\nG1 E${dir * len} F${Math.round(speed * 60)}`);
  }

  const activateExtruder = (name: string) => script(`ACTIVATE_EXTRUDER EXTRUDER=${name}`);

  function dualCarriageName(): string | null {
    const keys = Object.keys(th.dcModes);
    if (keys.length === 0) return null;
    const want = cleanCarriage(meta.dualKey);
    const byClean = keys.find((k) => cleanCarriage(k) === want);
    if (byClean) return byClean;
    const byPrefix = keys.find((k) => k.startsWith('dual_carriage '));
    if (byPrefix) return byPrefix;
    return keys.length >= 2 ? (keys[1] ?? null) : null;
  }

  function resolveActiveTool(): string | null {
    if (th.activeToolSaved) return th.activeToolSaved;
    if (meta.hasDualCarriage) {
      const dualMode = (th.dcModes[meta.dualKey] ?? 'INACTIVE').toUpperCase();
      if (dualMode !== 'INACTIVE') return 'T1';
    }
    return null;
  }

  function modesFor(carriage: string): DualCarriageMode[] {
    return carriage === dualCarriageName() ? [...DC_MODES] : ['PRIMARY'];
  }

  function setCarriageMode(carriage: string, mode: DualCarriageMode): void {
    script(`SET_DUAL_CARRIAGE CARRIAGE=${cleanCarriage(carriage)} MODE=${mode}`);
  }

  // DIRECT mode (experimental branch generic_cartesian)
  // Available = settings from tools.directMode (user check).

  function setCarriageDirect(carriage: string, enable: boolean): void {
    const c = cleanCarriage(carriage);
    if (enable) {
      const axis = (ui.directAxis || 'U').toUpperCase();
      script(`SET_DUAL_CARRIAGE CARRIAGE=${c} MODE=DIRECT GCODE_AXIS=${axis}`);
    } else {
      script(`SET_DUAL_CARRIAGE CARRIAGE=${c} MODE=PRIMARY`);
    }
  }

  function jogDirect(dist: number): void {
    const axis = ui.directAxis || 'U';
    script(`G91\nG0 ${axis}${dist} F${Math.round(ui.feedXY * 60)}\nG90`);
  }

  function moveToDirect(value: number): void {
    const axis = ui.directAxis || 'U';
    script(`G90\nG0 ${axis}${value} F${Math.round(ui.feedXY * 60)}`);
  }

  const runTool = (tool: string) => script(tool);
  const setForceMove = (v: boolean) => (forceMove = v);

  function coldBlocked(): boolean {
    const min = meta.minExtrudeTemp[th.activeExtruder] ?? 170;
    const cur = th.temps[th.activeExtruder];
    return cur == null || cur < min;
  }

  const homed = (axis: string) => th.homedAxes.includes(axis.toLowerCase());

  // Lifecycle

  function teardown(): void {
    generation++;
    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }
    for (const u of unsubs.splice(0)) u();
    spoolInflight.clear();
    spoolTs.clear();
  }

  async function init(): Promise<void> {
    
    loadUi();

    unsubs.push(
      api.settings.onChange((k) => {
        if (
          k === 'tools.style' || k === 'tools.invert' || k === 'tools.steps' ||
          k === 'tools.directMode' || k === 'tools.directAxis'
        ) loadUi();
      }),
    );

    const gen = ++generation;
    const h = safeHandle();
    if (!h || !api.printer.url) return;

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void loadMeta(gen);
      }),
    );

    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen === generation) void loadMeta(gen);
      }),
    );
    await loadMeta(gen);
  }

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    spoolOwner++;
    spoolData = {};
    meta = {
      ready: false,
      tools: [],
      extruders: [],
      steppers: [],
      minExtrudeTemp: {},
      maxZVelocity: 5,
      hasDualCarriage: false,
      dualKey: 'carriage_1',
      directPrimaryAxis: 'x',
      hasRetraction: false,
      defaults: {
        pa: {},
        retraction: { length: 0, speed: 0, extra: 0, unspeed: 0 },
      },
      hasSaveVars: false,
      hasSpoolman: false,
    };
    th = {
      position: [0, 0, 0],
      homedAxes: '',
      activeExtruder: 'extruder',
      speedFactor: 1,
      extrudeFactor: 1,
      temps: {},
      dcModes: {},
      pa: {},
      retraction: { length: 0, speed: 0, extra: 0, unspeed: 0 },
      gcodePosition: [0, 0, 0],
      printState: '',
      activeToolSaved: null,
      spoolIds: {},
      nativeSpoolId: null,
    };
    forceMove = false;
    void init();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

  return {
    get meta() { return meta; },
    get th() { return th; },
    get forceMove() { return forceMove; },
    get ui() { return ui; },
    get activeTool() { return resolveActiveTool(); },
    get isDirectActive() {
      return Object.values(th.dcModes).some((m) => m === 'DIRECT')
        || th.position.length > 4
        || th.gcodePosition.length > 4;
    },
    get directHomed() {
      const axis = meta.directPrimaryAxis.toLowerCase();
      let n = 0;
      for (const ch of th.homedAxes) if (ch === axis) n++;
      return n >= 2;
    },
    setStyle,
    setInvert,
    setSteps,
    setFeed,
    setDirectMode,
    setDirectAxis,
    setForceMove,
    jog,
    jogDirect,
    moveToDirect,
    forceMoveStepper,
    homeAll,
    homeAxes,
    motorsOff,
    setSpeed,
    setFlow,
    extrude,
    activateExtruder,
    dualCarriageName,
    modesFor,
    setCarriageMode,
    setCarriageDirect,
    runTool,
    coldBlocked,
    homed,
    moveTo,
    setPA,
    setRetraction,
    // Spoolman
    spoolIdForTool,
    spoolColorForTool,
    getSpool,
    refreshSpool,
  };
}

export type ToolheadStore = ReturnType<typeof useToolhead>;

//helpers

export function cleanCarriage(name: string): string {
  if (name.startsWith('dual_carriage'))
    return name.replace(/^dual_carriage\s+/, '').trim();
  else if (name.startsWith('carriage'))
    return name.replace(/^carriage\s+/, '').trim();
  return name;
}

function axisOfCarriage(name: string): string {
  const lower = String(name).toLowerCase().trim();
  const m = lower.match(/[_\s]([xyz])$/) ?? lower.match(/^([xyz])$/);
  return m ? m[1] : 'x';
}