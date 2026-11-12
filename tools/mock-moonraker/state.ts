import { Buffer } from 'node:buffer';
import { createGcodeFixture, createThumbnail, SAMPLE_CONFIG, SAMPLE_LOGS } from './fixtures.js';

/** A deliberately small printer profile used by the development simulator. */
export type MockProfile = 'ready' | 'error';

/** Status fields are kept in Moonraker's object shape so responses need no translation. */
export type MockStatus = Record<string, Record<string, unknown>>;

/** Files remain in memory so every new session starts with the same safe fixtures. */
export interface MockFile {
  content: Buffer;
  modified: number;
  metadata?: Record<string, unknown>;
}

/** A change can be sent to every connection, which filters it to its own subscription. */
export type MockEvent =
  | { kind: 'delta'; status: MockStatus }
  | { kind: 'notify'; method: string; params: unknown[] };

/** Klipper exposes the same command catalog through gcode status and printer.gcode.help. */
export const MOCK_GCODE_COMMANDS = {
  G28: 'Home all axes', M105: 'Report temperatures', TEST_MOCK: 'Mock macro',
  BED_MESH_CALIBRATE: 'Calibrate the bed mesh', BED_MESH_CLEAR: 'Clear the active mesh',
  BED_MESH_PROFILE: 'Save, load or remove a mesh', PROBE_CALIBRATE: 'Calibrate the Z probe',
  MANUAL_PROBE: 'Start manual probing', TESTZ: 'Adjust manual probe Z',
  ACCEPT: 'Accept manual probe', ABORT: 'Abort manual probe', SAVE_CONFIG: 'Save Klipper configuration',
};

/** Owns one virtual printer; no state is shared between sessions or profiles. */
export class MockPrinterState {
  readonly profile: MockProfile;
  readonly objects: MockStatus;
  readonly files = new Map<string, MockFile>();
  readonly directories = new Set(['gcodes', 'config', 'config/.backup', 'logs', 'docs']);
  readonly database = new Map<string, Map<string, unknown>>();
  readonly history: Array<Record<string, unknown>> = [];
  readonly gcodeStore: Array<{ message: string; time: number; type: 'command' | 'response' }> = [];
  readonly queuedJobs: Array<{ job_id: string; filename: string; time_added: number; time_in_queue: number }> = [];
  queueState: 'ready' | 'paused' = 'ready';
  readonly webcams: Array<Record<string, unknown>> = [{
    uid: 'mock-bed', name: 'Bed camera', enabled: true, source: 'database', location: 'printer',
    service: 'mjpegstreamer-adaptive', target_fps: 2, target_fps_idle: 1,
    stream_url: '/webcam/?action=snapshot', snapshot_url: '/webcam/?action=snapshot',
    rotation: 0, flip_horizontal: false, flip_vertical: false,
  }];
  totalsResetAt = 0;

  private readonly listeners = new Set<(event: MockEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextJobId = 1;
  private nextQueueId = 1;
  private elapsed = 0;
  private printStartedAt = 0;
  private readonly temperatures = new Map<string, { temperatures: number[]; targets: number[]; powers: number[] }>();

  constructor(profile: MockProfile) {
    this.profile = profile;
    this.objects = {
      webhooks: {
        state: profile === 'ready' ? 'ready' : 'error',
        state_message: profile === 'ready' ? 'Printer is ready' : 'Mock Klipper configuration error',
      },
      extruder: { temperature: 25, target: 0, power: 0, pressure_advance: 0.04, smooth_time: 0.04 },
      heater_bed: { temperature: 24, target: 0, power: 0 },
      heaters: { available_heaters: ['extruder', 'heater_bed'], available_sensors: ['extruder', 'heater_bed'] },
      fan: { speed: 0 },
      'fan_generic chamber': { speed: 0.35 },
      'output_pin case_light': { value: 1 },
      'filament_switch_sensor runout': { filament_detected: true, enabled: true },
      toolhead: {
        position: [0, 0, 0, 0], homed_axes: 'xyz', extruder: 'extruder',
        max_velocity: 300, max_accel: 3000, square_corner_velocity: 5,
      },
      gcode_move: {
        position: [0, 0, 0, 0], gcode_position: [0, 0, 0, 0],
        speed: 100, speed_factor: 1, extrude_factor: 1, homing_origin: [0, 0, 0, 0],
      },
      print_stats: {
        state: 'standby', filename: '', print_duration: 0, total_duration: 0,
        filament_used: 0, info: {}, message: '',
      },
      display_status: { progress: 0, message: '' },
      virtual_sdcard: { progress: 0, file_position: 0, file_path: '', is_active: false, file_size: 0 },
      motion_report: { live_velocity: 0, live_extruder_velocity: 0 },
      idle_timeout: { state: 'Idle' },
      bed_mesh: {
        profile_name: 'default', mesh_min: [20, 20], mesh_max: [200, 200],
        probed_matrix: [[0.02, 0.01, -0.01], [0.01, 0, -0.02], [0.03, 0.01, -0.01]],
        mesh_matrix: [[0.02, 0.01, -0.01], [0.01, 0, -0.02], [0.03, 0.01, -0.01]],
        profiles: {
          default: { points: [[0.02, 0.01, -0.01], [0.01, 0, -0.02], [0.03, 0.01, -0.01]] },
          textured: { points: [[0.04, 0.02, 0], [0.02, 0, -0.01], [0.03, 0.01, -0.02]] },
        },
      },
      manual_probe: { is_active: false, z_position: 5, z_position_lower: null, z_position_upper: null },
      probe: { last_query: true, last_z_result: 1.25 },
      configfile: {
        settings: {
          printer: { kinematics: 'cartesian', max_velocity: 300, max_accel: 3000 },
          extruder: { nozzle_diameter: 0.4, filament_diameter: 1.75, min_temp: 0, max_temp: 280 },
          heater_bed: { min_temp: 0, max_temp: 120 },
          probe: { z_offset: 1.25 },
          bed_mesh: { mesh_min: '20,20', mesh_max: '200,200', probe_count: '3,3' },
          'fan_generic chamber': { pin: 'mock:fan' },
          'output_pin case_light': { pin: 'mock:light', value: 1 },
          'filament_switch_sensor runout': { switch_pin: 'mock:filament' },
        },
        config: { 'gcode_macro TEST_MOCK': { gcode: 'RESPOND MSG="Mock macro complete"' } },
        warnings: [],
      },
      'gcode_macro TEST_MOCK': {},
      gcode: { commands: { ...MOCK_GCODE_COMMANDS } },
    };

    // The files contain actual layers and thumbnails, so Jobs and Preview can show useful content.
    this.putFile('gcodes/mock-cube.gcode', createGcodeFixture('cube'), {
      estimated_time: 2400, filament_total: 1800, object_height: 5.6, layer_count: 28,
      thumbnails: [{ width: 160, height: 120, size: 500, relative_path: '.thumbs/mock-cube.svg' }],
    });
    this.putFile('gcodes/demo-bracket.gcode', createGcodeFixture('bracket'), {
      estimated_time: 3900, filament_total: 3400, object_height: 5.6, layer_count: 28,
      filament_type: 'PETG', filament_name: 'Mock PETG',
      thumbnails: [{ width: 160, height: 120, size: 500, relative_path: '.thumbs/demo-bracket.svg' }],
    });
    this.putFile('gcodes/calibration-strip.gcode', createGcodeFixture('strip'), {
      estimated_time: 600, filament_total: 400, object_height: 1.6, layer_count: 8,
      thumbnails: [{ width: 160, height: 120, size: 500, relative_path: '.thumbs/calibration-strip.svg' }],
    });
    this.putFile('gcodes/.thumbs/mock-cube.svg', createThumbnail('CUBE', '#6fb7e5'));
    this.putFile('gcodes/.thumbs/demo-bracket.svg', createThumbnail('BRACKET', '#e0aa73'));
    this.putFile('gcodes/.thumbs/calibration-strip.svg', createThumbnail('STRIP', '#98cc91'));
    this.putFile('config/printer.cfg', Buffer.from(SAMPLE_CONFIG));
    this.putFile('config/moonraker.conf', Buffer.from('[server]\nhost: 0.0.0.0\nport: 7125\n'));
    this.putFile('config/macros.cfg', Buffer.from('[gcode_macro TEST_MOCK]\ngcode:\n  RESPOND MSG="Mock macro complete"\n'));
    this.putFile('logs/klippy.log', Buffer.from(SAMPLE_LOGS.klippy));
    this.putFile('logs/moonraker.log', Buffer.from(SAMPLE_LOGS.moonraker));
    this.putFile('docs/Config_Reference.md', Buffer.from('# Mock Klipper Config Reference\n'));
    this.putFile('docs/G-Codes.md', Buffer.from('# Mock G-Code Reference\n'));
    this.history.push({
      job_id: this.nextJobId++, filename: 'mock-cube.gcode', status: 'completed',
      start_time: Date.now() / 1000 - 3600, end_time: Date.now() / 1000 - 1200,
      print_duration: 2400, total_duration: 2400, filament_used: 1800,
      metadata: this.metadata('gcodes/mock-cube.gcode'),
    });
    this.history.push({
      job_id: this.nextJobId++, filename: 'demo-bracket.gcode', status: 'cancelled',
      start_time: Date.now() / 1000 - 7200, end_time: Date.now() / 1000 - 6800,
      print_duration: 400, total_duration: 400, filament_used: 380,
      metadata: this.metadata('gcodes/demo-bracket.gcode'),
    });
    this.history.push({
      job_id: this.nextJobId++, filename: 'calibration-strip.gcode', status: 'completed',
      start_time: Date.now() / 1000 - 12_000, end_time: Date.now() / 1000 - 11_400,
      print_duration: 600, total_duration: 600, filament_used: 400,
      metadata: this.metadata('gcodes/calibration-strip.gcode'),
    });
    // A short seeded history makes the graph useful before the first heater command.
    for (const name of ['extruder', 'heater_bed']) {
      const ambient = name === 'extruder' ? 25 : 24;
      this.temperatures.set(name, {
        temperatures: Array.from({ length: 120 }, (_, i) => ambient + Math.max(0, i - 45) * (name === 'extruder' ? 0.55 : 0.25)),
        targets: Array.from({ length: 120 }, (_, i) => i < 45 ? 0 : name === 'extruder' ? 205 : 60),
        powers: Array.from({ length: 120 }, (_, i) => i < 45 ? 0 : 0.7),
      });
    }
  }

  /** Returns the current Klippy state from the same object subscriptions expose. */
  get klippyState(): string {
    return String(this.objects.webhooks?.state ?? 'ready');
  }

  /** Publishes state changes to the network adapter without coupling it to WebSocket. */
  onEvent(listener: (event: MockEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts a deterministic one-second simulation clock for the live server. */
  startClock(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(1), 1000);
  }

  /** Stops the clock and drops listeners when a session expires. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /** Runs one simulation step; tests call this directly instead of waiting in real time. */
  tick(seconds: number): void {
    const delta: MockStatus = {};
    for (const name of ['extruder', 'heater_bed']) {
      const heater = this.objects[name];
      if (!heater) continue;
      const current = Number(heater.temperature);
      const target = Number(heater.target);
      const ambient = name === 'extruder' ? 25 : 24;
      const destination = target > 0 ? target : ambient;
      const step = (target > current ? 2 : 0.5) * seconds;
      const next = Math.abs(destination - current) <= step
        ? destination : current + Math.sign(destination - current) * step;
      if (next !== current) {
        heater.temperature = next;
        heater.power = target > current ? 0.7 : 0;
        delta[name] = { temperature: next, power: heater.power };
      }
      const samples = this.temperatures.get(name);
      if (samples) {
        samples.temperatures.push(Number(heater.temperature));
        samples.targets.push(target);
        samples.powers.push(Number(heater.power));
        for (const values of [samples.temperatures, samples.targets, samples.powers]) {
          if (values.length > 300) values.shift();
        }
      }
    }
    if (this.objects.print_stats?.state === 'printing') {
      this.elapsed += seconds;
      const progress = Math.min(1, this.elapsed / 40);
      this.objects.print_stats.print_duration = this.elapsed;
      this.objects.print_stats.total_duration = this.elapsed;
      this.objects.print_stats.filament_used = Math.round(progress * 1800);
      this.objects.display_status!.progress = progress;
      this.objects.virtual_sdcard!.progress = progress;
      this.objects.virtual_sdcard!.file_position = Math.round(Number(this.objects.virtual_sdcard!.file_size) * progress);
      delta.print_stats = {
        print_duration: this.elapsed, total_duration: this.elapsed,
        filament_used: this.objects.print_stats.filament_used,
      };
      delta.display_status = { progress };
      delta.virtual_sdcard = { progress, file_position: this.objects.virtual_sdcard!.file_position };
      if (progress >= 1) this.finishPrint('completed');
    }
    // These values feed Machine monitoring through Moonraker's normal notification channel.
    this.notify('notify_proc_stat_update', {
      system_cpu_usage: { cpu: this.objects.print_stats?.state === 'printing' ? 22 : 6 },
      system_memory: { total: 2_000_000, used: 730_000 }, cpu_temp: 42,
      websocket_connections: this.listeners.size,
      moonraker_stats: [{ time: Date.now() / 1000, cpu_usage: 3, memory: 120_000 }],
      klipper_stats: { cpu_usage: this.objects.print_stats?.state === 'printing' ? 12 : 2 },
    });
    if (Object.keys(delta).length) this.emit({ kind: 'delta', status: delta });
  }

  /** Returns copied bounded temperature samples so callers cannot mutate live simulation state. */
  temperatureStore(): Record<string, unknown> {
    return Object.fromEntries([...this.temperatures].map(([name, samples]) => [name, {
      temperatures: [...samples.temperatures], targets: [...samples.targets], powers: [...samples.powers],
    }]));
  }

  /** Moonraker queue notifications mirror the status response consumed by the bundled widget. */
  notifyQueue(action: string): void {
    this.notify('notify_job_queue_changed', {
      action, updated_queue: this.queuedJobs.map((job) => ({ ...job })), queue_state: this.queueState,
    });
  }

  /** Adds only existing G-code files so a queue action cannot claim a missing job succeeded. */
  enqueue(filenames: string[]): void {
    for (const filename of filenames) {
      if (!this.files.has(`gcodes/${filename}`)) throw new Error(`File not found: ${filename}`);
    }
    for (const filename of filenames) {
      this.queuedJobs.push({ job_id: `mock-q-${this.nextQueueId++}`, filename, time_added: Date.now() / 1000, time_in_queue: 0 });
    }
    this.notifyQueue('jobs_added');
  }

  /** Changes Klippy lifecycle state and emits the notification expected by the proxy. */
  setKlippyState(state: 'ready' | 'error' | 'shutdown'): void {
    const message = state === 'ready' ? 'Printer is ready' : state === 'error'
      ? 'Mock Klipper configuration error' : 'Mock emergency stop';
    this.patch('webhooks', { state, state_message: message });
    this.notify(state === 'ready' ? 'notify_klippy_ready' : 'notify_klippy_shutdown');
  }

  /** Updates one object and emits only the changed fields, as Moonraker does. */
  patch(name: string, fields: Record<string, unknown>): void {
    this.objects[name] = { ...(this.objects[name] ?? {}), ...fields };
    this.emit({ kind: 'delta', status: { [name]: fields } });
  }

  /** Sends a Moonraker notification with positional parameters. */
  notify(method: string, ...params: unknown[]): void {
    this.emit({ kind: 'notify', method, params });
  }

  /** Keeps Console's Moonraker-backed log in the same state as live responses. */
  recordGcode(message: string, type: 'command' | 'response'): void {
    this.gcodeStore.push({ message, time: Date.now() / 1000, type });
    if (this.gcodeStore.length > 500) this.gcodeStore.splice(0, this.gcodeStore.length - 500);
  }

  /** Starts a print from a fixture or an uploaded G-code file. */
  startPrint(filename: string): void {
    if (this.klippyState !== 'ready') throw new Error('Klippy is not ready');
    const file = this.files.get(`gcodes/${filename}`);
    if (!file) throw new Error(`File not found: ${filename}`);
    this.elapsed = 0;
    this.printStartedAt = Date.now() / 1000;
    this.patch('print_stats', {
      state: 'printing', filename, print_duration: 0, total_duration: 0,
      filament_used: 0, message: '',
    });
    this.patch('virtual_sdcard', {
      progress: 0, file_position: 0, file_path: filename,
      is_active: true, file_size: file.content.length,
    });
    this.patch('display_status', { progress: 0 });
    this.patch('idle_timeout', { state: 'Printing' });
  }

  /** Pauses or resumes the active job, preserving its elapsed time. */
  setPaused(paused: boolean): void {
    const expected = paused ? 'printing' : 'paused';
    if (this.objects.print_stats?.state !== expected) throw new Error(`Printer is not ${expected}`);
    this.patch('print_stats', { state: paused ? 'paused' : 'printing' });
  }

  /** Finishes the active job and adds an entry visible on the History page. */
  finishPrint(status: 'completed' | 'cancelled'): void {
    const stats = this.objects.print_stats;
    if (!stats || !['printing', 'paused'].includes(String(stats.state))) return;
    const filename = String(stats.filename);
    this.history.unshift({
      job_id: this.nextJobId++, filename, status,
      start_time: this.printStartedAt, end_time: Date.now() / 1000,
      print_duration: this.elapsed, total_duration: this.elapsed,
      filament_used: stats.filament_used,
      metadata: this.metadata(`gcodes/${filename}`),
    });
    this.patch('print_stats', { state: status, message: '' });
    this.patch('virtual_sdcard', { is_active: false });
    this.patch('idle_timeout', { state: 'Idle' });
    this.notify('notify_history_changed', { action: 'added' });
  }

  /** Stores a file and notifies pages which cache directory listings. */
  putFile(path: string, content: Buffer, metadata?: Record<string, unknown>): void {
    this.files.set(path, { content, modified: Date.now() / 1000, metadata });
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.directories.add(parts.slice(0, i).join('/'));
    this.notify('notify_filelist_changed', { action: 'create_file', item: { path } });
  }

  /** Deletes one file and invalidates the proxy's file-list cache. */
  deleteFile(path: string): void {
    if (!this.files.delete(path)) throw new Error(`File not found: ${path}`);
    this.notify('notify_filelist_changed', { action: 'delete_file', item: { path } });
  }

  /** Returns stable metadata for the G-code fixture and uploaded files. */
  metadata(path: string): Record<string, unknown> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return {
      filename: path.slice(path.indexOf('/') + 1), size: file.content.length,
      modified: file.modified, slicer: 'Tessera Mock', filament_type: 'PLA',
      filament_name: 'Mock PLA', filament_total: 1800, estimated_time: 2400,
      layer_height: 0.2, object_height: 20, thumbnails: [], ...file.metadata,
    };
  }

  private emit(event: MockEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
