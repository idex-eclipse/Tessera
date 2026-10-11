import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';

import { useKlippyState } from '../../plugins/shared/klippy-state/use-klippy-state.svelte';

// ------------------------------------------------------------------
// Модели
// ------------------------------------------------------------------

export interface SystemInfoModel {
  hostname: string;
  cpuCount: number;
  cpuDesc: string;
  bits: string;
  totalMemoryKb: number | null;
  osName: string;
  kernel: string;
  python: string;
  moonrakerVersion: string;
  network: Array<{ iface: string; ip: string }>;
  sdInfo: Record<string, unknown> | null;
  availableServices: string[];
  serviceState: Record<string, { active: string; sub: string }>;
}

export interface PowerDeviceModel {
  device: string;
  status: string;
  lockedWhilePrinting: boolean;
  type: string;
}

export interface McuModel {
  name: string;
  version: string;
  build: string;
  freq: number | null;
  load: number | null;
  constants: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
}

export interface ProcPoint {
  t: number;
  sysCpu: number | null;
  cpuTemp: number | null;
  memUsed: number | null;
  memTotal: number | null;
  mkCpu: number | null;
  mkMem: number | null;
  ws: number | null;
  klipperCpu: number | null;
  load1: number | null;
}

export interface AccessModel {
  available: boolean;   // эндпоинты access/* отвечают (Moonraker не слишком старый)
  loginEnabled: boolean; // enforcement активен
  users: string[];
}

export type UpdateItemType = 'git_repo' | 'web' | 'system' | 'unknown';

export interface CommitInfo {
  sha: string;
  author: string;
  date: string; // unix seconds
  subject: string;
  message: string;
  tag: string | null;
}

export interface UpdateItemModel {
  name: string;
  type: UpdateItemType;
  configuredType: string;
  channel: string;
  version: string;
  remoteVersion: string;
  isValid: boolean;
  warnings: string[];
  anomalies: string[];

  // git_repo
  corrupt: boolean;
  dirty: boolean;
  detached: boolean;
  pristine: boolean;
  branch: string;
  owner: string;
  repoName: string;
  currentHash: string;
  remoteHash: string;
  rollbackVersion: string;
  fullVersionString: string;
  remoteUrl: string;
  commitsBehind: CommitInfo[];
  commitsBehindCount: number;
  gitMessages: string[];

  // system
  packageCount: number;
  packageList: string[];
}

const PROC_CAP = 600; // ~10 минут при 1 Гц

// ------------------------------------------------------------------
// Module-level состояние: общее для баннера, правой панели и страницы
// ------------------------------------------------------------------

let systemInfo = $state<SystemInfoModel>({
  hostname: '',
  cpuCount: 0,
  cpuDesc: '',
  bits: '',
  totalMemoryKb: null,
  osName: '',
  kernel: '',
  python: '',
  moonrakerVersion: '',
  network: [],
  sdInfo: null,
  availableServices: [],
  serviceState: {},
});

let klipperMeta = $state({
  hostname: '',
  softwareVersion: '',
  logFile: '',
  configFile: '',
});

let updates = $state<{ busy: boolean; items: UpdateItemModel[] }>({
  busy: false,
  items: [],
});
let updateLog = $state<Array<{ app: string; line: string }>>([]);

let power = $state<PowerDeviceModel[]>([]);
let mcus = $state<McuModel[]>([]);
let proc = $state<ProcPoint[]>([]);
let access = $state<AccessModel>({ available: false, loginEnabled: false, users: [] });
let busy = $state('');

// ------------------------------------------------------------------
// Хук
// ------------------------------------------------------------------

export function useSystem(api: PluginApi) {
  let generation = 0;
  let klipperLoadSeq = 0;
  const unsubs: Array<() => void> = [];
  let unsubMcu: (() => void) | null = null;
  const klippy = useKlippyState(api);

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
    } catch {
      return null;
    }
  }

  /** REST для access/* (санкционировано task.txt); токен появится в 12.4. */
  async function rest<T>(path: string, init?: RequestInit): Promise<T | null> {
    const h = safeHandle();
    if (!h) return null;

    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    const tok = (h as { authToken?: string }).authToken;
    if (tok) headers.Authorization = `Bearer ${tok}`;

    try {
      const res = await fetch(h.httpBaseUrl + path, { ...init, headers });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // apply*
  // ------------------------------------------------------------------

  function applySystemInfo(info: any, serverInfo: any): void {
    if (!info || typeof info !== 'object') return;

    const cpu = info.cpu_info ?? {};
    const dist = info.distribution ?? {};
    const network: SystemInfoModel['network'] = [];

    for (const [iface, entry] of Object.entries(info.network ?? {})) {
      const e = entry as any;
      const v4 = (e?.ip_addresses ?? []).find(
        (ip: any) => ip?.family === 'ipv4' && !ip?.is_link_local,
      );
      const anyIp = v4 ?? (e?.ip_addresses ?? [])[0];
      network.push({ iface, ip: anyIp?.address ?? '' });
    }

    const serviceState: SystemInfoModel['serviceState'] = {};
    for (const [svc, st] of Object.entries(info.service_state ?? {})) {
      const s = st as any;
      serviceState[svc] = { active: s?.active_state ?? '', sub: s?.sub_state ?? '' };
    }

    systemInfo = {
      hostname: info.hostname ?? systemInfo.hostname,
      cpuCount: typeof cpu.cpu_count === 'number' ? cpu.cpu_count : 0,
      cpuDesc: [cpu.processor, cpu.bits].filter(Boolean).join(' '),
      bits: cpu.bits ?? '',
      totalMemoryKb: typeof cpu.total_memory === 'number' ? cpu.total_memory : null,
      osName: dist.name ?? '',
      kernel: dist.kernel_version ?? '',
      python: info.python?.version_string ?? systemInfo.python,
      moonrakerVersion: serverInfo?.version ?? systemInfo.moonrakerVersion,
      network,
      sdInfo:
        info.sd_info && typeof info.sd_info === 'object' && Object.keys(info.sd_info).length > 0
          ? info.sd_info
          : null,
      availableServices: Array.isArray(info.available_services) ? info.available_services : [],
      serviceState,
    };
  }

  function applyKlipperMeta(info: any): void {
    if (!info || typeof info !== 'object') return;
    klipperMeta = {
      hostname: typeof info.hostname === 'string' ? info.hostname : klipperMeta.hostname,
      softwareVersion:
        typeof info.software_version === 'string' ? info.software_version : klipperMeta.softwareVersion,
      logFile: typeof info.log_file === 'string' ? info.log_file : klipperMeta.logFile,
      configFile: typeof info.config_file === 'string' ? info.config_file : klipperMeta.configFile,
    };
  }

  function applyPowerDevices(devs: any): void {
    const list = Array.isArray(devs) ? devs : devs?.devices;
    if (!Array.isArray(list)) {
      power = [];
      return;
    }
    power = list.map((d: any) => ({
      device: String(d?.device ?? ''),
      status: String(d?.status ?? 'off'),
      lockedWhilePrinting: Boolean(d?.locked_while_printing),
      type: String(d?.type ?? ''),
    }));
  }
  function applyPowerChanged(params: any): void {
    const list = Array.isArray(params) ? params : [params];
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const dev = power.find((d) => d.device === p.device);
      if (dev && typeof p.status === 'string') dev.status = p.status;
    }
    power = [...power]; // триггер реактивности
  }

  function applyMcuDelta(delta: any): void {
    // Klipper не ready — никакие дельты/снапшоты mcu не принимаем:
    // закрывает окно, когда отписка ещё не доехала, а snapshot прокси
    // всё ещё содержит поля mcu
    if (!klippy.ready) return;
    if (!delta || typeof delta !== 'object') return;
    const next = [...mcus];

    for (const [name, d] of Object.entries(delta)) {
      if (!/^mcu(\s|$)/.test(name)) continue;
      const rec = d as any;
      const ls = rec?.last_stats;
      if (!rec || typeof rec !== 'object') continue;

      const existing = next.find((m) => m.name === name);
      const model: McuModel = {
        name,
        version: typeof rec.mcu_version === 'string' ? rec.mcu_version : existing?.version ?? '',
        build:
          typeof rec.mcu_build_versions === 'string'
            ? rec.mcu_build_versions
            : Array.isArray(rec.mcu_build_versions)
              ? rec.mcu_build_versions.join(', ')
              : existing?.build ?? '',
        freq: rec.mcu_constants?.CLOCK_FREQ ?? existing?.freq ?? null,
        load: rec.last_stats?.mcu_task_avg ?? existing?.load ?? null,
        constants:
          rec.mcu_constants && typeof rec.mcu_constants === 'object'
            ? (rec.mcu_constants as Record<string, unknown>)
            : (existing?.constants ?? null),
        stats:
          rec.last_stats && typeof rec.last_stats === 'object'
            ? (rec.last_stats as Record<string, unknown>)
            : (existing?.stats ?? null),
      };

      const idx = next.findIndex((m) => m.name === name);
      if (idx >= 0) next[idx] = model;
      else next.push(model);
    }

    next.sort((a, b) => a.name.localeCompare(b.name));
    mcus = next;
  }

  function applyProcStat(params: any): void {
    const p = Array.isArray(params) ? params[0] : params;
    if (!p || typeof p !== 'object') return;

    // moonraker_stats в старых версиях мог быть массивом — берём последний
    const mk = Array.isArray(p.moonraker_stats)
      ? p.moonraker_stats[p.moonraker_stats.length - 1]
      : p.moonraker_stats;

    const procStats = (p.proc_stats ?? {}) as any;
    const klipperStats = (p.klipper_stats ?? procStats.klipper_stats ?? null) as any;

    const point: ProcPoint = {
      t: mk?.time ?? Date.now() / 1000,
      sysCpu: p.system_cpu_usage?.cpu ?? null,
      cpuTemp: typeof p.cpu_temp === 'number' ? p.cpu_temp : null,
      memUsed: p.system_memory?.used ?? null,
      memTotal: p.system_memory?.total ?? null,
      mkCpu: mk?.cpu_usage ?? null,
      mkMem: mk?.memory ?? null,
      ws: typeof p.websocket_connections === 'number' ? p.websocket_connections : null,
      klipperCpu: typeof klipperStats?.cpu_usage === 'number' ? klipperStats.cpu_usage : null,
      load1:
        typeof p.load_1min === 'number'
          ? p.load_1min
          : typeof p.system_stats?.load_1min === 'number'
            ? p.system_stats.load_1min
            : typeof procStats.load_1min === 'number'
              ? procStats.load_1min
              : null,
    };

    proc = [...proc.slice(-(PROC_CAP - 1)), point];
  }

    /** Полный сброс пер-принтерных данных: вызывается ТОЛЬКО при смене принтера. */
  function resetState(): void {
    systemInfo = {
      hostname: '',
      cpuCount: 0,
      cpuDesc: '',
      bits: '',
      totalMemoryKb: null,
      osName: '',
      kernel: '',
      python: '',
      moonrakerVersion: '',
      network: [],
      sdInfo: null,
      availableServices: [],
      serviceState: {},
    };
    power = [];
    mcus = [];
    proc = [];
    access = { available: false, loginEnabled: false, users: [] };
    updates = { busy: false, items: [] }; updateLog = [];
  }

  function applyUpdateStatus(res: any): void {
    if (!res || typeof res !== 'object') return;
    const vi = res.version_info ?? res;
    const items: UpdateItemModel[] = [];

    for (const [name, raw] of Object.entries(vi ?? {})) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as any;
      const configuredType = String(r.configured_type ?? '');
      const type: UpdateItemType =
        configuredType === 'git_repo'
          ? 'git_repo'
          : configuredType === 'web'
            ? 'web'
            : configuredType === 'system'
              ? 'system'
              : 'unknown';

      const warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : [];
      const anomalies = Array.isArray(r.anomalies) ? r.anomalies.map(String) : [];
      const gitMessages = Array.isArray(r.git_messages)
        ? r.git_messages.map(String)
        : [];
      const commitsBehind: CommitInfo[] = Array.isArray(r.commits_behind)
        ? r.commits_behind
            .filter((c: any) => c && typeof c === 'object')
            .map((c: any) => ({
              sha: String(c.sha ?? ''),
              author: String(c.author ?? ''),
              date: String(c.date ?? ''),
              subject: String(c.subject ?? ''),
              message: String(c.message ?? ''),
              tag: c.tag ? String(c.tag) : null,
            }))
        : [];

      const packageList = Array.isArray(r.package_list)
        ? r.package_list.map(String)
        : [];

      items.push({
        name,
        type,
        configuredType,
        channel: String(r.channel ?? ''),
        version: String(r.version ?? ''),
        remoteVersion: String(r.remote_version ?? ''),
        isValid: r.is_valid !== false,
        warnings,
        anomalies,
        // git
        corrupt: Boolean(r.corrupt),
        dirty: Boolean(r.is_dirty),
        detached: Boolean(r.detached),
        pristine: Boolean(r.pristine),
        branch: String(r.branch ?? ''),
        owner: String(r.owner ?? ''),
        repoName: String(r.repo_name ?? ''),
        currentHash: String(r.current_hash ?? ''),
        remoteHash: String(r.remote_hash ?? ''),
        rollbackVersion: String(r.rollback_version ?? ''),
        fullVersionString: String(r.full_version_string ?? ''),
        remoteUrl: String(r.remote_url ?? ''),
        commitsBehind,
        commitsBehindCount:
          typeof r.commits_behind_count === 'number'
            ? r.commits_behind_count
            : commitsBehind.length,
        gitMessages,
        // system
        packageCount:
          typeof r.package_count === 'number' ? r.package_count : packageList.length,
        packageList,
      });
    }

    items.sort((a, b) => a.name.localeCompare(b.name));
    updates = { busy: Boolean(res.busy), items };
  }



  // ------------------------------------------------------------------
  // loaders
  // ------------------------------------------------------------------

  async function loadSystemInfo(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    const [info, serverInfo] = await Promise.all([
      h.request<any>('machine.system_info').catch(() => null),
      h.request<any>('server.info').catch(() => null),
    ]);
    if (gen !== generation) return;
    applySystemInfo(info?.system_info ?? info, serverInfo);
  }

  async function loadKlipperMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const info = await h.request<any>('printer.info').catch(() => null);
    if (gen !== generation) return;
    applyKlipperMeta(info); // state НЕ трогаем — он в useKlippyState
  }

  async function loadPower(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    try {
      const res = await h.request<any>('machine.device_power.devices');
      if (gen !== generation) return;
      applyPowerDevices(res);
    } catch (e: any) {
      if (gen !== generation) return;

      // "Method not found" = no [power] in moonraker.conf.
      const isMethodNotFound =
        typeof e?.message === 'string' && /Method not found/i.test(e.message);

      if (isMethodNotFound) {
        // Don't show console error
        applyPowerDevices(null);
      } else {
        console.error('[system] power load failed:', e);
        applyPowerDevices(null);
      }
    }
  }

  async function loadAccess(gen: number): Promise<void> {
    let loginEnabled = false;
    let available = false;

    // 1) /access/info: если вернул объект (не null) — endpoint доступен
    const info = await rest<any>('/access/info');
    if (info && typeof info === 'object') {
      available = true;
      const r = info.result ?? info;
      loginEnabled = Boolean(
        r?.login_required ?? r?.authorization?.enabled ?? r?.login_enabled ?? false,
      );
    } else {
      // 2) /access/info
      const probe = await rest<any>('/access/user');
      if (probe && typeof probe === 'object') {
        available = true;
        loginEnabled = false; // trusted: /access/user ответил 200
      }
      // probe === null и info === null → endpoints нет (очень старый Moonraker)
    }

    // 3) список пользователей
    let users: string[] = [];
    if (available) {
      let arr: any[] | null = null;

      // /access/users/list
      const l1 = await rest<any>('/access/users/list');
      if (l1 && typeof l1 === 'object') {
        const r1 = l1.result ?? l1;
        arr = Array.isArray(r1?.users) ? r1.users : Array.isArray(r1) ? r1 : null;
      }

      users = (arr ?? [])
        .map((u: any) => String(u?.username ?? ''))
        .filter(Boolean);
    }

    if (gen !== generation) return;
    access = { available, loginEnabled, users };
  }

  async function loadMcus(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    if (unsubMcu) {
      unsubMcu();
      unsubMcu = null;
    }

    if (!klippy.ready) {
      mcus = [];
      return;
    }

    const list = await h.request<any>('printer.objects.list').catch(() => null);
    if (gen !== generation) return;

    const names = ((list?.objects ?? []) as string[]).filter((n) => /^mcu(\s|$)/.test(n));
    if (names.length === 0) {
      mcus = [];
      return;
    }

    const objects: Record<string, string[]> = {};
    for (const n of names) {
      objects[n] = ['mcu_version', 'mcu_build_versions', 'mcu_constants', 'last_stats'];
    }

    unsubMcu = h.subscribe(
      objects,
      (delta: any) => {
        if (gen === generation) applyMcuDelta(delta);
      },
      { immediate: true },
    );
  }

  async function loadUpdates(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h.request<any>('machine.update.status').catch(() => null);
    if (gen !== generation) return;
    if (res) applyUpdateStatus(res);
  }

  async function refresh(): Promise<void> {
    const gen = generation;
    await loadKlipperMeta(gen);
    await Promise.all([
      loadSystemInfo(gen),
      loadPower(gen),
      loadAccess(gen),
      loadMcus(gen),
      loadUpdates(gen),
    ]);
  }

  // ------------------------------------------------------------------
  // Действия (панель/баннер вызывают их напрямую)
  // ------------------------------------------------------------------

  async function guard(action: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = action;
    try {
      await fn();
    } catch (e) {
      console.error('[system] action failed:', action, e);
    } finally {
      busy = '';
    }
  }

  function estop(): void {
    // без подтверждения и без busy-блокировки: безопасность прежде всего
    const h = safeHandle();
    h?.request('printer.emergency_stop').catch((e) => console.error('[system] estop', e));
  }

  const restartKlipper = () => guard('restartKlipper', () => safeHandle()!.request('printer.restart'));
  const firmwareRestart = () =>
    guard('firmwareRestart', () => safeHandle()!.request('printer.firmware_restart'));
  const restartMoonraker = () =>
    guard('restartMoonraker', () =>
      safeHandle()!.request('machine.services.restart', { service: 'moonraker' }),
    );
  const hostShutdown = () => guard('hostShutdown', () => safeHandle()!.request('machine.shutdown'));
  const hostReboot = () => guard('hostReboot', () => safeHandle()!.request('machine.reboot'));

  const serviceAction = (service: string, action: 'restart' | 'stop' | 'start') =>
    guard(`svc:${service}:${action}`, async () => {
      await safeHandle()!.request(`machine.services.${action}`, { service });
      await loadSystemInfo(generation);
    });

  const powerSet = (device: string, action: 'on' | 'off' | 'toggle') =>
    guard(`power:${device}`, async () => {
      await safeHandle()!.request('machine.device_power.post_device', {
        device,
        action,
      });
      await loadPower(generation);
    });

    const addUser = (username: string, password: string) =>
    guard(`userAdd:${username}`, async () => {
      await rest<any>('/access/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      await loadAccess(generation);
    });

  const deleteUser = (username: string) =>
    guard(`userDel:${username}`, async () => {
      await rest<any>(`/access/user?username=${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
      await loadAccess(generation);
    });

  const changePassword = (password: string, newPassword: string) =>
    guard('userPwd', async () => {
      await rest<any>('/access/user/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, newPassword }),
      });
    });

  const refreshUpdates = () =>
    guard('updRefresh', () => safeHandle()!.request('machine.update.refresh'));

  const updateItem = (name: string) =>
    guard(`upd:${name}`, () => safeHandle()!.request(`machine.update.${name}`));

  const rollbackItem = (name: string) =>
    guard(`rollback:${name}`, () =>
      safeHandle()!.request('machine.update.rollback', { name }),
    );

  const clearUpdateLog = () => {
    updateLog = [];
  };

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
    if (unsubMcu) {
      unsubMcu();
      unsubMcu = null;
    }
  }

  async function init(): Promise<void> {
    const gen = ++generation;

    const h = safeHandle();
    if (!h || !api.printer.url) return;

    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen === generation) {
          void loadKlipperMeta(gen);
          void loadMcus(gen);
        }
      }),
    );

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void refresh();
      }),
    );

    unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open' && gen === generation) void refresh();
      }),
    );

    unsubs.push(
      h.onNotify('notify_proc_stat_update', (params) => {
        if (gen === generation) applyProcStat(params);
      }),
    );

    unsubs.push(
      h.onNotify('notify_power_changed', (params) => {
        if (gen === generation) applyPowerChanged(params);
      }),
    );

    unsubs.push(
      h.onNotify('notify_service_state_changed', () => {
        if (gen === generation) void loadSystemInfo(gen);
      }),
    );

    unsubs.push(
      h.onNotify('notify_update_refreshed', (params) => {
        if (gen === generation) applyUpdateStatus(params);
      }),
    );

    unsubs.push(
      h.onNotify('notify_update_response', (params) => {
        if (gen !== generation) return;
        const p = Array.isArray(params) ? params[0] : params;
        const line = String(p?.message ?? '');
        if (!line) return;
        updateLog = [
          ...updateLog.slice(-499),
          { app: String(p?.application ?? ''), line },
        ];
      }),
    );

    await refresh();
  }

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    resetState();
    void init();
  });
  onDestroy(() => {
    teardown();
    offPrinter();
  });

  // ------------------------------------------------------------------
  // Public
  // ------------------------------------------------------------------

  return {
    get systemInfo() {
      return systemInfo;
    },
    get klipper() {
      return {
        state: klippy.state,
        stateMessage: klippy.stateMessage,
        ...klipperMeta,
      };
    },
    get power() {
      return power;
    },
    get mcus() {
      return mcus;
    },
    get proc() {
      return proc;
    },
    get access() {
      return access;
    },
    get busy() {
      return busy;
    },
    get updates(){
      return updates;
    }, 
    get updateLog() {
      return updateLog;
    },

    refresh,
    estop,
    restartKlipper,
    firmwareRestart,
    restartMoonraker,
    hostShutdown,
    hostReboot,
    serviceAction,
    powerSet,
    addUser,
    deleteUser,
    changePassword,
    refreshUpdates, 
    updateItem, 
    rollbackItem,
    clearUpdateLog
  };
}

export type SystemStore = ReturnType<typeof useSystem>;