import { onDestroy } from 'svelte';
import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../shared/core-keeper/core-keeper';
import { initialBedMeshUiState, type BedMeshUiState } from './bed-mesh-ui-state.svelte.ts';

export interface BedMeshProfileInfo {
  name: string;
  points: number[][];
  meshParams: {
    xCount?: number;
    yCount?: number;
    algo?: string;
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
  };
}

export interface BedMeshModel {
  profileName: string;
  meshMin: [number, number] | null;
  meshMax: [number, number] | null;
  probedMatrix: number[][];
  meshMatrix: number[][];
  profiles: Record<string, BedMeshProfileInfo>;
}

export interface ManualProbeModel {
  isActive: boolean;
  zPosition: number | null;
  zLower: number | null;
  zUpper: number | null;
}

export interface ScrewResult {
  name: string;
  z: number | null;
  sign: string;
  adjust: string;
  isBase: boolean;
}

export interface ScrewsTiltModel {
  error: boolean;
  maxDeviation: number | null;
  results: ScrewResult[];
  hasResults: boolean;
}

export interface BedMeshTools {
  calibrate: boolean;
  clear: boolean;
  profile: boolean;
  zTilt: boolean;
  qgl: boolean;
  screws: boolean;
  probeCalibrate: boolean;
  manualProbe: boolean;
}

const BED_MESH_FIELDS = [
  'profile_name', 'mesh_min', 'mesh_max', 'probed_matrix', 'mesh_matrix', 'profiles',
];
const MANUAL_PROBE_FIELDS = ['is_active', 'z_position', 'z_position_lower', 'z_position_upper'];
const SCREWS_FIELDS = ['error', 'max_deviation', 'results'];

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalizeProfiles(raw: Record<string, unknown>): Record<string, BedMeshProfileInfo> {
  const out: Record<string, BedMeshProfileInfo> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (!value || typeof value !== 'object') continue;
    const p = value as { points?: unknown; mesh_params?: Record<string, unknown> };
    const mp = p.mesh_params ?? {};
    out[name] = {
      name,
      points: Array.isArray(p.points) ? (p.points as number[][]) : [],
      meshParams: {
        xCount: num(mp.x_count),
        yCount: num(mp.y_count),
        algo: typeof mp.algo === 'string' ? mp.algo : undefined,
        minX: num(mp.min_x),
        maxX: num(mp.max_x),
        minY: num(mp.min_y),
        maxY: num(mp.max_y),
      },
    };
  }
  return out;
}

function createBedMeshCore(api: PluginApi, printerId: string) {
  const handle: MoonrakerProxyHandle = api.moonrakerFor(printerId);

  let mesh = $state<BedMeshModel>({
    profileName: '',
    meshMin: null,
    meshMax: null,
    probedMatrix: [],
    meshMatrix: [],
    profiles: {},
  });

  let probe = $state<ManualProbeModel>({
    isActive: false,
    zPosition: null,
    zLower: null,
    zUpper: null,
  });

  let screws = $state<ScrewsTiltModel>({
    error: false,
    maxDeviation: null,
    results: [],
    hasResults: false,
  });

  let commands = $state<Record<string, string>>({});

  let bedMeshUi = $state<BedMeshUiState>(initialBedMeshUiState());

  function applyBedMesh(bm: any): void {
    if (!bm || typeof bm !== 'object') return;
    const next: BedMeshModel = { ...mesh };
    if (typeof bm.profile_name === 'string') next.profileName = bm.profile_name;
    if (Array.isArray(bm.mesh_min) && bm.mesh_min.length === 2) {
      next.meshMin = [bm.mesh_min[0], bm.mesh_min[1]];
    }
    if (Array.isArray(bm.mesh_max) && bm.mesh_max.length === 2) {
      next.meshMax = [bm.mesh_max[0], bm.mesh_max[1]];
    }
    if (Array.isArray(bm.probed_matrix)) next.probedMatrix = bm.probed_matrix;
    if (Array.isArray(bm.mesh_matrix)) next.meshMatrix = bm.mesh_matrix;
    if (bm.profiles && typeof bm.profiles === 'object') {
      next.profiles = normalizeProfiles(bm.profiles);
    }
    mesh = next;
  }

  function applyManualProbe(mp: any): void {
    if (!mp || typeof mp !== 'object') return;
    probe = {
      isActive: typeof mp.is_active === 'boolean' ? mp.is_active : probe.isActive,
      zPosition: num(mp.z_position) ?? probe.zPosition,
      zLower: num(mp.z_position_lower) ?? probe.zLower,
      zUpper: num(mp.z_position_upper) ?? probe.zUpper,
    };
  }

  function applyScrews(sa: any): void {
    if (!sa || typeof sa !== 'object') return;
    const results: ScrewResult[] = [];
    const raw = sa.results;
    if (raw && typeof raw === 'object') {
      for (const [name, r] of Object.entries(raw)) {
        const rec = r as any;
        results.push({
          name,
          z: typeof rec?.z === 'number' ? rec.z : null,
          sign: typeof rec?.sign === 'string' ? rec.sign : '',
          adjust: typeof rec?.adjust === 'string' ? rec.adjust : '',
          isBase: Boolean(rec?.is_base),
        });
      }
    }
    results.sort((a, b) =>
      a.isBase === b.isBase ? a.name.localeCompare(b.name) : a.isBase ? -1 : 1,
    );
    screws = {
      error: Boolean(sa.error),
      maxDeviation: typeof sa.max_deviation === 'number' ? sa.max_deviation : null,
      results,
      hasResults: results.length > 0,
    };
  }

  async function refresh(): Promise<void> {
    try {
      const res: any = await handle.request('printer.objects.query', {
        objects: {
          bed_mesh: [...BED_MESH_FIELDS],
          manual_probe: [...MANUAL_PROBE_FIELDS],
          screws_tilt_adjust: [...SCREWS_FIELDS],
        },
      });
      applyBedMesh(res?.status?.bed_mesh);
      applyManualProbe(res?.status?.manual_probe);
      applyScrews(res?.status?.screws_tilt_adjust);
    } catch {
      // offline — данные придут подпиской
    }
  }

  function setup(): () => void {
    const unsubs: Array<() => void> = [];

    // Reset state на каждый setup (при реконнекте/пробуждении ядра)
    mesh = { profileName: '', meshMin: null, meshMax: null, probedMatrix: [], meshMatrix: [], profiles: {} };
    probe = { isActive: false, zPosition: null, zLower: null, zUpper: null };
    screws = { error: false, maxDeviation: null, results: [], hasResults: false };
    commands = {};

    unsubs.push(
      handle.subscribe(
        { bed_mesh: [...BED_MESH_FIELDS] },
        (d: any) => applyBedMesh(d?.bed_mesh),
        { immediate: true },
      ),
    );
    unsubs.push(
      handle.subscribe(
        { manual_probe: [...MANUAL_PROBE_FIELDS] },
        (d: any) => applyManualProbe(d?.manual_probe),
        { immediate: true },
      ),
    );
    unsubs.push(
      handle.subscribe(
        { screws_tilt_adjust: [...SCREWS_FIELDS] },
        (d: any) => applyScrews(d?.screws_tilt_adjust),
        { immediate: true },
      ),
    );
    unsubs.push(
      handle.subscribe(
        { gcode: ['commands'] },
        (d: any) => {
          const c = d?.gcode?.commands;
          if (c && typeof c === 'object') commands = c as Record<string, string>;
        },
        { immediate: true },
      ),
    );
    unsubs.push(
      handle.onNotify('notify_klippy_ready', () => {
        void refresh();
      }),
    );

    void refresh();
    void handle
      .request<any>('printer.objects.query', { objects: { gcode: ['commands'] } })
      .then((res) => {
        const c = res?.status?.gcode?.commands;
        if (c && typeof c === 'object') commands = c as Record<string, string>;
      })
      .catch(() => {});

    return () => unsubs.forEach((u) => u());
  }

  let cleanup: (() => void) | null = null;

  $effect(() => {
    cleanup = setup();
    return () => {
      cleanup?.();
      cleanup = null;
    };
  });

  let hasMesh = $derived(
    mesh.meshMatrix.length > 0 && (mesh.meshMatrix[0]?.length ?? 0) > 0,
  );
  let profileNames = $derived(Object.keys(mesh.profiles).sort());
  let tools = $derived<BedMeshTools>({
    calibrate: 'BED_MESH_CALIBRATE' in commands,
    clear: 'BED_MESH_CLEAR' in commands,
    profile: 'BED_MESH_PROFILE' in commands,
    zTilt: 'Z_TILT_ADJUST' in commands,
    qgl: 'QUAD_GANTRY_LEVEL' in commands,
    screws: 'SCREWS_TILT_CALCULATE' in commands,
    probeCalibrate: 'PROBE_CALIBRATE' in commands,
    manualProbe: 'MANUAL_PROBE' in commands,
  });

  function toggleScrewsOverlay(): void {
    bedMeshUi.screwsOverlayOpen = !bedMeshUi.screwsOverlayOpen;
  }

  function closeScrewsOverlay(): void {
    bedMeshUi.screwsOverlayOpen = false;
  }

  function destroy(): void {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  }

  return {
    get mesh() { return mesh; },
    get probe() { return probe; },
    get screws() { return screws; },
    get commands() { return commands; },
    get hasMesh() { return hasMesh; },
    get profileNames() { return profileNames; },
    get tools() { return tools; },
    get bedMeshUi() { return bedMeshUi; },
    refresh,
    toggleScrewsOverlay,
    closeScrewsOverlay,
    destroy,
  };
}

export type BedMeshStore = ReturnType<typeof createBedMeshCore>;

const keeper = createCoreKeeper<BedMeshStore>({
  create: (pid, api) => createBedMeshCore(api, pid),
  cap: 4,
});

export function useBedMesh(api: PluginApi, printerId?: string): BedMeshStore {
  if (printerId !== undefined) {
    const core = keeper.acquire(printerId, api);
    const offPrinters = api.onPrintersChange((printers) => {
      keeper.prune(printers.map((p) => p.id));
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(printerId);
    });
    return core;
  }

  let heldPid = api.printer.id;
  keeper.acquire(heldPid, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldPid);
    heldPid = p.id;
    keeper.acquire(heldPid, api);
  });
  const offPrinters = api.onPrintersChange((printers) => {
    keeper.prune(printers.map((p) => p.id));
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldPid);
  });

  return createDelegateStore<BedMeshStore>(() => keeper.get(api.printer.id, api));
}