import { Buffer } from 'node:buffer';
import { MOCK_GCODE_COMMANDS, MockPrinterState, type MockStatus } from './state.js';

/** Preserves Moonraker's JSON-RPC error code instead of pretending a command worked. */
export class MockRpcError extends Error {
  constructor(message: string, readonly code = -32602) {
    super(message);
    this.name = 'MockRpcError';
  }
}

/** A subscription belongs to one WebSocket connection, as in Moonraker. */
export interface MockConnection {
  subscribed: Record<string, string[] | null>;
  close?: () => void;
}

/** Rejects malformed or missing params with a stable JSON-RPC error. */
function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/** Extracts a required string instead of silently accepting an invalid action. */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new MockRpcError(`Missing ${name}`);
  return value;
}

/** Selects exactly the fields requested by one Moonraker subscriber. */
export function selectStatus(
  state: MockPrinterState,
  wanted: Record<string, string[] | null>,
  source: MockStatus = state.objects,
): MockStatus {
  const result: MockStatus = {};
  for (const [name, fields] of Object.entries(wanted)) {
    const status = source[name];
    if (!status) continue;
    if (fields === null || fields.length === 0) {
      result[name] = { ...status };
    } else {
      const selected = Object.fromEntries(fields.filter((field) => field in status).map((field) => [field, status[field]]));
      if (Object.keys(selected).length) result[name] = selected;
    }
  }
  return result;
}

/** Lists only direct children so nested Config and Jobs folders navigate normally. */
function directory(state: MockPrinterState, path: string): Record<string, unknown> {
  if (!state.directories.has(path)) throw new MockRpcError(`Directory not found: ${path}`, 404);
  const prefix = `${path}/`;
  const dirs = [...state.directories]
    .filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes('/'))
    .map((item) => ({ dirname: item.slice(prefix.length), modified: Date.now() / 1000, size: 0 }));
  const files = [...state.files.entries()]
    .filter(([item]) => item.startsWith(prefix) && !item.slice(prefix.length).includes('/'))
    .map(([item, file]) => ({
      ...(item.startsWith('gcodes/') ? state.metadata(item) : {}),
      filename: item.slice(prefix.length), modified: file.modified, size: file.content.length,
    }));
  return { dirs, files, disk_usage: { total: 1_000_000_000, used: 10_000_000, free: 990_000_000 } };
}

/** Finds the status object of a configurable LED (`neopixel case` for LED=case, and so on). */
function findLedObjectKey(state: MockPrinterState, name: string | undefined): string | null {
  if (!name) return null;
  for (const kind of ['led', 'neopixel', 'dotstar', 'pca9533', 'pca9632']) {
    const key = `${kind} ${name}`;
    if (key in state.objects) return key;
  }
  return null;
}

/** Simulates only G-code commands used by the bundled controls and the sample macro. */
function gcode(state: MockPrinterState, script: string): string {
  if (state.klippyState !== 'ready' && !/^\s*(FIRMWARE_RESTART|RESTART)\s*$/i.test(script)) {
    throw new MockRpcError('Klippy is not ready', 503);
  }
  let answer = 'ok';
  // Klipper keeps movement mode across lines; bundled jog commands restore it explicitly.
  let relativeAxes = false;
  let relativeExtruder = false;
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.split(';')[0]?.trim() ?? '';
    if (!line) continue;
    state.recordGcode(line, 'command');
    const command = line.split(/\s+/)[0]?.toUpperCase();
    const value = (key: string): number | null => {
      const found = new RegExp(`(?:^|\\s)${key}(?:=)?(-?\\d+(?:\\.\\d+)?)`, 'i').exec(line);
      return found ? Number(found[1]) : null;
    };
    if (command === 'M104' || command === 'M109' || command === 'M140' || command === 'M190') {
      const name = command === 'M104' || command === 'M109' ? 'extruder' : 'heater_bed';
      const target = value('S');
      if (target === null) throw new MockRpcError(`Missing temperature in ${command}`);
      state.patch(name, { target });
    } else if (command === 'SET_HEATER_TEMPERATURE') {
      const name = /HEATER=([^\s]+)/i.exec(line)?.[1];
      const target = value('TARGET');
      if (!name || target === null || !(name in state.objects)) throw new MockRpcError('Invalid heater');
      state.patch(name, { target });
    } else if (command === 'G28') {
      state.patch('toolhead', { homed_axes: 'xyz', position: [0, 0, 0, 0] });
      state.patch('gcode_move', { position: [0, 0, 0, 0], gcode_position: [0, 0, 0, 0] });
    } else if (command === 'G90' || command === 'G91') {
      relativeAxes = command === 'G91';
    } else if (command === 'M82' || command === 'M83') {
      relativeExtruder = command === 'M83';
    } else if (command === 'G0' || command === 'G1') {
      const old = state.objects.toolhead?.position;
      const position = Array.isArray(old) ? [...old] as number[] : [0, 0, 0, 0];
      ['X', 'Y', 'Z', 'E'].forEach((axis, index) => {
        const next = value(axis);
        if (next !== null) position[index] = (relativeAxes || (axis === 'E' && relativeExtruder))
          ? (position[index] ?? 0) + next : next;
      });
      state.patch('toolhead', { position });
      state.patch('gcode_move', { position, gcode_position: position });
    } else if (command === 'G92') {
      const old = state.objects.toolhead?.position;
      const position = Array.isArray(old) ? [...old] as number[] : [0, 0, 0, 0];
      ['X', 'Y', 'Z', 'E'].forEach((axis, index) => {
        const next = value(axis);
        if (next !== null) position[index] = next;
      });
      state.patch('toolhead', { position });
      state.patch('gcode_move', { position, gcode_position: position });
    } else if (command === 'M84') {
      state.patch('toolhead', { homed_axes: '' });
    } else if (command === 'ACTIVATE_EXTRUDER') {
      const name = /EXTRUDER=([^\s]+)/i.exec(line)?.[1];
      if (!name || !(name in state.objects)) throw new MockRpcError('Unknown extruder');
      state.patch('toolhead', { extruder: name });
    } else if (command === 'M220' || command === 'M221') {
      const ratio = value('S');
      if (ratio === null) throw new MockRpcError(`Missing factor in ${command}`);
      state.patch('gcode_move', { [command === 'M220' ? 'speed_factor' : 'extrude_factor']: ratio / 100 });
    } else if (command === 'SET_VELOCITY_LIMIT') {
      const fields: Record<string, number> = {};
      for (const [param, field] of [['VELOCITY', 'max_velocity'], ['ACCEL', 'max_accel'], ['SQUARE_CORNER_VELOCITY', 'square_corner_velocity']] as const) {
        const next = value(param);
        if (next !== null) fields[field] = next;
      }
      state.patch('toolhead', fields);
    } else if (command === 'SET_PRESSURE_ADVANCE') {
      const advance = value('ADVANCE');
      if (advance === null) throw new MockRpcError('Missing pressure advance');
      state.patch('extruder', { pressure_advance: advance });
    } else if (command === 'M106' || command === 'M107') {
      state.patch('fan', { speed: command === 'M107' ? 0 : Math.min(1, Math.max(0, (value('S') ?? 255) / 255)) });
    } else if (command === 'SET_FAN_SPEED') {
      const name = /FAN=([^\s]+)/i.exec(line)?.[1];
      const speed = value('SPEED');
      if (!name || speed === null || !state.objects[`fan_generic ${name}`]) throw new MockRpcError('Invalid fan');
      state.patch(`fan_generic ${name}`, { speed: Math.min(1, Math.max(0, speed)) });
    } else if (command === 'SET_PIN') {
      const name = /PIN=([^\s]+)/i.exec(line)?.[1];
      const pinValue = value('VALUE');
      if (!name || pinValue === null || !state.objects[`output_pin ${name}`]) throw new MockRpcError('Invalid output pin');
      state.patch(`output_pin ${name}`, { value: pinValue });
    } else if (command === 'SET_LED') {
      // LED names with spaces arrive quoted (the UI escapes them like Klipper's shlex does).
      const name = /LED=(?:"([^"]+)"|([^\s]+))/i.exec(line);
      const ledName = name?.[1] ?? name?.[2];
      const key = findLedObjectKey(state, ledName);
      if (!key) throw new MockRpcError(`Invalid LED: ${ledName ?? '(missing)'}`);
      const pixel = [value('RED') ?? 0, value('GREEN') ?? 0, value('BLUE') ?? 0, value('WHITE') ?? 0];
      const current = state.objects[key]?.color_data;
      const data = Array.isArray(current) ? current.map((px) => [...px] as number[]) : [pixel];
      const index = value('INDEX');
      if (index !== null && index >= 1 && index <= data.length) data[index - 1] = pixel;
      else for (let i = 0; i < data.length; i++) data[i] = [...pixel];
      state.patch(key, { color_data: data });
    } else if (command === 'SET_LED_TEMPLATE') {
      // Templates animate over time; the mock keeps the last SET_LED color instead.
    } else if (command === 'SET_FILAMENT_SENSOR') {
      const name = /SENSOR=([^\s]+)/i.exec(line)?.[1];
      const enabled = value('ENABLE');
      if (!name || enabled === null || !state.objects[`filament_switch_sensor ${name}`]) throw new MockRpcError('Invalid filament sensor');
      state.patch(`filament_switch_sensor ${name}`, { enabled: enabled !== 0 });
    } else if (command === 'BED_MESH_CALIBRATE') {
      // A repeatable, visibly different mesh lets the page verify that calibration changed state.
      const points = [[0.01, 0, -0.01], [0.02, 0, -0.01], [0.02, 0.01, 0]];
      state.patch('bed_mesh', { profile_name: '', probed_matrix: points, mesh_matrix: points });
      answer = 'Bed mesh calibration complete';
    } else if (command === 'BED_MESH_CLEAR') {
      state.patch('bed_mesh', { profile_name: '', probed_matrix: [], mesh_matrix: [] });
    } else if (command === 'BED_MESH_PROFILE') {
      const action = /\b(LOAD|SAVE|REMOVE)=([^\s]+)/i.exec(line);
      if (!action) throw new MockRpcError('Missing bed mesh profile action');
      const name = action[2]!.replace(/^"|"$/g, '');
      const mesh = state.objects.bed_mesh ?? {};
      const profiles = { ...(mesh.profiles as Record<string, { points: number[][] }> ?? {}) };
      if (action[1]!.toUpperCase() === 'SAVE') {
        const points = mesh.probed_matrix;
        if (!Array.isArray(points) || points.length === 0) throw new MockRpcError('No mesh to save');
        profiles[name] = { points: points as number[][] };
        state.patch('bed_mesh', { profile_name: name, profiles });
      } else if (action[1]!.toUpperCase() === 'REMOVE') {
        if (!profiles[name]) throw new MockRpcError(`Unknown bed mesh profile: ${name}`, 404);
        delete profiles[name];
        state.patch('bed_mesh', { profile_name: mesh.profile_name === name ? '' : mesh.profile_name, profiles });
      } else {
        const profile = profiles[name];
        if (!profile) throw new MockRpcError(`Unknown bed mesh profile: ${name}`, 404);
        state.patch('bed_mesh', { profile_name: name, probed_matrix: profile.points, mesh_matrix: profile.points });
      }
    } else if (command === 'PROBE_CALIBRATE' || command === 'MANUAL_PROBE') {
      state.patch('manual_probe', { is_active: true, z_position: 5, z_position_lower: null, z_position_upper: null });
      answer = 'Manual probe started';
    } else if (command === 'TESTZ') {
      const probe = state.objects.manual_probe;
      if (probe?.is_active !== true) throw new MockRpcError('Manual probe is not active');
      const offset = value('Z');
      if (offset === null) throw new MockRpcError('Missing Z offset');
      const before = Number(probe.z_position);
      state.patch('manual_probe', {
        z_position: Number((before + offset).toFixed(3)),
        ...(offset < 0 ? { z_position_upper: before } : { z_position_lower: before }),
      });
    } else if (command === 'ACCEPT' || command === 'ABORT') {
      if (state.objects.manual_probe?.is_active !== true) throw new MockRpcError('Manual probe is not active');
      state.patch('manual_probe', { is_active: false });
      if (command === 'ACCEPT') {
        state.patch('configfile', { save_config_pending: true });
        answer = 'Probe calibration accepted; SAVE_CONFIG to persist';
      }
    } else if (command === 'SAVE_CONFIG') {
      state.patch('configfile', { save_config_pending: false });
      state.setKlippyState('ready');
    } else if (command === 'SET_GCODE_OFFSET') {
      const offset = value('Z_ADJUST');
      const absolute = value('Z');
      if (offset === null && absolute === null) throw new MockRpcError('Missing Z offset');
      const current = state.objects.gcode_move?.homing_origin;
      const origin = Array.isArray(current) ? [...current] as number[] : [0, 0, 0, 0];
      origin[2] = absolute ?? ((origin[2] ?? 0) + offset!);
      state.patch('gcode_move', { homing_origin: origin });
    } else if (command === 'M400' || command === 'G4') {
      // A completed mock command already has no queued motion to wait for.
    } else if (command === 'TEST_MOCK') {
      answer = 'Mock macro complete';
    } else if (command === 'M112') {
      state.setKlippyState('shutdown');
    } else if (command === 'RESTART' || command === 'FIRMWARE_RESTART') {
      state.setKlippyState('ready');
    } else if (command === 'M105') {
      answer = `T:${state.objects.extruder?.temperature} /${state.objects.extruder?.target} B:${state.objects.heater_bed?.temperature} /${state.objects.heater_bed?.target}`;
    } else if (command === 'RESPOND' || command === 'M118') {
      answer = /MSG="?([^"\n]+)"?/i.exec(line)?.[1] ?? line;
    } else {
      throw new MockRpcError(`Unsupported mock G-code: ${command}`, -32601);
    }
    state.recordGcode(answer, 'response');
    state.notify('notify_gcode_response', answer);
  }
  return answer;
}

/** Handles the documented JSON-RPC subset used by Tessera's bundled plugins. */
export function handleRpc(
  state: MockPrinterState,
  method: string,
  rawParams: unknown,
  connection?: MockConnection,
): unknown {
  const params = record(rawParams);
  switch (method) {
    case 'server.info': return {
      klippy_connected: true, klippy_state: state.klippyState,
      components: ['database', 'file_manager', 'history', 'machine', 'webcam'],
      failed_components: [], registered_directories: ['gcodes', 'config', 'logs', 'docs'],
      moonraker_version: 'v0.9.0-mock', api_version: [1, 0, 0], warnings: [],
    };
    case 'printer.info': return {
      state: state.klippyState, state_message: state.objects.webhooks?.state_message,
      hostname: 'tessera-mock', software_version: 'v0.12.0-mock',
      config_file: '/mock/config/printer.cfg', log_file: '/mock/logs/klippy.log',
    };
    case 'printer.objects.list': return { objects: Object.keys(state.objects) };
    case 'printer.objects.query':
      return { eventtime: Date.now() / 1000, status: selectStatus(state, record(params.objects) as Record<string, string[] | null>) };
    case 'printer.objects.subscribe': {
      if (!connection) throw new MockRpcError('A WebSocket connection is required');
      connection.subscribed = record(params.objects) as Record<string, string[] | null>;
      return { eventtime: Date.now() / 1000, status: selectStatus(state, connection.subscribed) };
    }
    case 'printer.objects.unsubscribe': {
      if (!connection) throw new MockRpcError('A WebSocket connection is required');
      for (const name of Object.keys(record(params.objects))) delete connection.subscribed[name];
      return 'ok';
    }
    case 'printer.gcode.help': return { ...MOCK_GCODE_COMMANDS };
    case 'printer.gcode.script': return gcode(state, requiredString(params.script, 'script'));
    case 'printer.print.start': state.startPrint(requiredString(params.filename, 'filename')); return 'ok';
    case 'printer.print.pause': state.setPaused(true); return 'ok';
    case 'printer.print.resume': state.setPaused(false); return 'ok';
    case 'printer.print.cancel': state.finishPrint('cancelled'); return 'ok';
    case 'printer.restart':
    case 'printer.firmware_restart': state.restartKlipper(); return 'ok';
    case 'printer.emergency_stop': state.setKlippyState('shutdown'); return 'ok';
    case 'machine.services.restart': {
      const service = requiredString(params.service, 'service');
      if (service === 'klipper') state.restartKlipper();
      else if (service === 'moonraker') connection?.close?.();
      else throw new MockRpcError(`Unknown service: ${service}`);
      return 'ok';
    }
    case 'server.temperature_store': return state.temperatureStore();
    case 'server.gcode_store': {
      const count = typeof params.count === 'number' ? Math.max(0, params.count) : 500;
      return { gcode_store: count === 0 ? [] : state.gcodeStore.slice(-count) };
    }
    case 'server.files.roots': return { roots: [...state.directories].filter((path) => !path.includes('/')).map((name) => ({ name, path: `/mock/${name}`, permissions: 'rw' })) };
    case 'server.files.list': {
      const root = typeof params.root === 'string' ? params.root : 'gcodes';
      return { files: [...state.files.keys()].filter((path) => path.startsWith(`${root}/`)).map((path) => ({ path: path.slice(root.length + 1), ...state.metadata(path) })) };
    }
    case 'server.files.get_directory': return directory(state, requiredString(params.path, 'path'));
    case 'server.files.metadata': return state.metadata(`gcodes/${requiredString(params.filename, 'filename')}`);
    case 'server.files.post_directory': {
      const path = requiredString(params.path, 'path');
      if (!state.directories.has(path.slice(0, path.lastIndexOf('/')))) throw new MockRpcError('Parent directory does not exist');
      state.directories.add(path);
      state.notify('notify_filelist_changed', { action: 'create_dir', item: { path } });
      return { item: { path } };
    }
    case 'server.files.delete_directory': {
      const path = requiredString(params.path, 'path');
      for (const name of [...state.files.keys()]) if (name.startsWith(`${path}/`)) state.deleteFile(name);
      for (const name of [...state.directories]) if (name === path || name.startsWith(`${path}/`)) state.directories.delete(name);
      state.notify('notify_filelist_changed', { action: 'delete_dir', item: { path } });
      return 'ok';
    }
    case 'server.files.delete_file': state.deleteFile(requiredString(params.path, 'path')); return 'ok';
    case 'server.files.copy':
    case 'server.files.move': {
      const source = requiredString(params.source, 'source');
      const dest = requiredString(params.dest, 'dest');
      const file = state.files.get(source);
      if (!file) throw new MockRpcError(`File not found: ${source}`, 404);
      state.putFile(dest, Buffer.from(file.content), file.metadata ? { ...file.metadata } : undefined);
      if (method === 'server.files.move') state.deleteFile(source);
      return { item: { path: dest } };
    }
    case 'server.history.list': {
      const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : state.history.length;
      return { jobs: state.history.slice(0, limit), count: state.history.length };
    }
    case 'server.history.totals': {
      // Moonraker resets counters without erasing the job list.
      const jobs = state.history.filter((job) => Number(job.end_time ?? 0) > state.totalsResetAt);
      return { job_totals: {
        total_jobs: jobs.length,
        total_time: jobs.reduce((sum, job) => sum + Number(job.total_duration ?? 0), 0),
        total_print_time: jobs.reduce((sum, job) => sum + Number(job.print_duration ?? 0), 0),
        total_filament_used: jobs.reduce((sum, job) => sum + Number(job.filament_used ?? 0), 0),
        longest_print: Math.max(0, ...jobs.map((job) => Number(job.print_duration ?? 0))),
      } };
    }
    case 'server.history.get_job': {
      const job = state.history.find((item) => item.job_id === params.uid || item.job_id === params.job_id);
      if (!job) throw new MockRpcError('History job not found', 404);
      return { job };
    }
    case 'server.history.delete_job': {
      const index = state.history.findIndex((item) => item.job_id === params.uid || item.job_id === params.job_id);
      if (index < 0) throw new MockRpcError('History job not found', 404);
      state.history.splice(index, 1);
      state.notify('notify_history_changed', { action: 'deleted' });
      return 'ok';
    }
    case 'server.history.delete_all': state.history.splice(0); state.notify('notify_history_changed', { action: 'deleted' }); return 'ok';
    case 'server.history.reset_totals': state.totalsResetAt = Date.now() / 1000; state.notify('notify_history_changed', { action: 'reset_totals' }); return 'ok';
    case 'server.database.get_item': {
      const namespace = requiredString(params.namespace, 'namespace');
      const entries = state.database.get(namespace);
      if (params.key === undefined) return { namespace, value: Object.fromEntries(entries ?? []) };
      return { namespace, key: params.key, value: entries?.get(String(params.key)) ?? null };
    }
    case 'server.database.post_item': {
      const namespace = requiredString(params.namespace, 'namespace');
      const key = requiredString(params.key, 'key');
      const entries = state.database.get(namespace) ?? new Map<string, unknown>();
      entries.set(key, params.value);
      state.database.set(namespace, entries);
      return { namespace, key, value: params.value };
    }
    case 'server.database.delete_item': {
      const namespace = requiredString(params.namespace, 'namespace');
      state.database.get(namespace)?.delete(requiredString(params.key, 'key'));
      return 'ok';
    }
    case 'server.webcams.list': return { webcams: state.webcams.map((webcam) => ({ ...webcam })) };
    case 'server.webcams.post_item': {
      const name = requiredString(params.name, 'name');
      const uid = typeof params.uid === 'string' && params.uid ? params.uid : `mock-${Date.now()}`;
      const index = state.webcams.findIndex((camera) => camera.uid === uid);
      const camera = { ...params, uid, name };
      if (index < 0) state.webcams.push(camera);
      else state.webcams[index] = camera;
      state.notify('notify_webcams_changed', { webcams: state.webcams.map((item) => ({ ...item })) });
      return { webcam: camera };
    }
    case 'server.webcams.delete_item': {
      const index = state.webcams.findIndex((camera) => camera.uid === params.uid || camera.name === params.name);
      if (index < 0) throw new MockRpcError('Camera not found', 404);
      const [camera] = state.webcams.splice(index, 1);
      state.notify('notify_webcams_changed', { webcams: state.webcams.map((item) => ({ ...item })) });
      return { webcam: camera };
    }
    case 'server.job_queue.status': return { queued_jobs: state.queuedJobs.map((job) => ({ ...job })), queue_state: state.queueState };
    case 'server.job_queue.post_job': {
      const filenames = Array.isArray(params.filenames) ? params.filenames : [params.filenames];
      if (!filenames.length || filenames.some((name) => typeof name !== 'string' || !name)) {
        throw new MockRpcError('Missing filenames');
      }
      if (params.reset === true) state.queuedJobs.splice(0);
      state.enqueue(filenames as string[]);
      return { queued_jobs: state.queuedJobs.map((job) => ({ ...job })), queue_state: state.queueState };
    }
    case 'server.job_queue.delete_job': {
      const ids = Array.isArray(params.job_ids) ? params.job_ids : [];
      if (params.all === true) state.queuedJobs.splice(0);
      else {
        for (const id of ids) {
          const index = state.queuedJobs.findIndex((job) => job.job_id === id);
          if (index < 0) throw new MockRpcError(`Queued job not found: ${String(id)}`, 404);
          state.queuedJobs.splice(index, 1);
        }
      }
      state.notifyQueue('jobs_removed');
      return { queued_jobs: state.queuedJobs.map((job) => ({ ...job })), queue_state: state.queueState };
    }
    case 'server.job_queue.pause': state.queueState = 'paused'; state.notifyQueue('queue_paused'); return { queued_jobs: [...state.queuedJobs], queue_state: state.queueState };
    case 'server.job_queue.start': state.queueState = 'ready'; state.notifyQueue('queue_started'); return { queued_jobs: [...state.queuedJobs], queue_state: state.queueState };
    case 'server.job_queue.jump': {
      const index = state.queuedJobs.findIndex((job) => job.job_id === params.job_id);
      if (index < 0) throw new MockRpcError('Queued job not found', 404);
      const [job] = state.queuedJobs.splice(index, 1);
      state.queuedJobs.unshift(job!);
      state.notifyQueue('jobs_reordered');
      return { queued_jobs: [...state.queuedJobs], queue_state: state.queueState };
    }
    case 'machine.device_power.devices': return { devices: [] };
    case 'machine.update.status': return { busy: false, version_info: {} };
    case 'machine.system_info': return { system_info: {
      cpu_info: { cpu_count: 4, model: 'Tessera Mock CPU' },
      distribution: { name: 'Tessera Mock', version: '1.0' },
      memory: { total: 2_000_000, available: 1_000_000 },
      network: {}, available_services: ['klipper', 'moonraker'],
    } };
    default: throw new MockRpcError(`Method not found: ${method}`, -32601);
  }
}
