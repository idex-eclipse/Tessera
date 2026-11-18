import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createMoonrakerProxy, type WebSocketLike } from '../../host/src/core/moonraker-proxy.js';
import { handleRpc, MockRpcError } from './handlers.js';
import { startMockMoonrakerServer, type RunningMockServer } from './server.js';
import { createMockSessionStore } from './sessions.js';
import { MockPrinterState } from './state.js';

const servers: RunningMockServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.useRealTimers();
});

/** Waits for a real socket message so wire-format tests cover the network adapter. */
function message(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
  });
}

/** Opens a test socket with the same origin as the local browser. */
async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/websocket', { origin: 'http://127.0.0.1:5174' });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

describe('mock Moonraker state and sessions', () => {
  it('keeps two printers and two visitors independent, then expires idle sessions', () => {
    let now = 1000;
    const sessions = createMockSessionStore(100, () => now);
    const a = sessions.getOrCreate('a');
    const b = sessions.getOrCreate('b');
    expect(a.ready.klippyState).toBe('ready');
    expect(a.error.klippyState).toBe('error');
    handleRpc(a.ready, 'printer.gcode.script', { script: 'M104 S210' });
    expect(a.ready.objects.extruder?.target).toBe(210);
    expect(a.error.objects.extruder?.target).toBe(0);
    expect(b.ready.objects.extruder?.target).toBe(0);
    now = 1110;
    sessions.getOrCreate('b');
    expect(sessions.sweep()).toBe(1);
    expect(sessions.size).toBe(1);
    sessions.dispose();
  });

  it('advances a job, pauses it, finishes it, and emits meaningful deltas', () => {
    const state = new MockPrinterState('ready');
    const events: string[] = [];
    state.onEvent((event) => events.push(event.kind === 'delta' ? Object.keys(event.status).join(',') : event.method));
    handleRpc(state, 'printer.print.start', { filename: 'mock-cube.gcode' });
    state.tick(10);
    expect(state.objects.display_status?.progress).toBe(0.25);
    handleRpc(state, 'printer.print.pause', {});
    state.tick(10);
    expect(state.objects.display_status?.progress).toBe(0.25);
    handleRpc(state, 'printer.print.resume', {});
    state.tick(30);
    expect(state.objects.print_stats?.state).toBe('completed');
    expect(state.history[0]?.status).toBe('completed');
    expect(events).toContain('notify_history_changed');
    expect(events.some((event) => event.includes('display_status'))).toBe(true);
    state.dispose();
  });

  it('recovers the error profile through an observable startup and rejects unsupported commands explicitly', async () => {
    vi.useFakeTimers();
    const state = new MockPrinterState('error');
    expect(() => handleRpc(state, 'printer.print.start', { filename: 'mock-cube.gcode' })).toThrow('Klippy is not ready');
    handleRpc(state, 'printer.restart', {});
    expect(state.klippyState).toBe('startup');
    await vi.advanceTimersByTimeAsync(2500);
    expect(state.klippyState).toBe('ready');
    expect(() => handleRpc(state, 'printer.gcode.script', { script: 'UNKNOWN_COMMAND' })).toThrow(MockRpcError);
    expect(() => handleRpc(state, 'server.unimplemented', {})).toThrow('Method not found');
    state.dispose();
  });

  it('applies bundled temperature and relative jog commands to subscribed objects', () => {
    const state = new MockPrinterState('ready');
    handleRpc(state, 'printer.gcode.script', { script: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=205' });
    handleRpc(state, 'printer.gcode.script', { script: 'G91\nG0 X10 F1200\nG90' });
    handleRpc(state, 'printer.gcode.script', { script: 'M83\nG1 E5 F120' });
    expect(state.objects.extruder?.target).toBe(205);
    expect(state.objects.toolhead?.position).toEqual([10, 0, 0, 5]);
    expect(handleRpc(state, 'server.gcode_store', { count: 2 })).toMatchObject({
      gcode_store: [{ message: 'G1 E5 F120', type: 'command' }, { message: 'ok', type: 'response' }],
    });
    state.dispose();
  });

  it('keeps rich file metadata, thumbnails, temperature samples and history in each printer', () => {
    const state = new MockPrinterState('ready');
    const files = handleRpc(state, 'server.files.list', { root: 'gcodes' }) as { files: Array<Record<string, unknown>> };
    const bracket = files.files.find((file) => file.path === 'demo-bracket.gcode');
    expect(bracket).toMatchObject({ filament_type: 'PETG', layer_count: 28 });
    expect(bracket?.thumbnails).toMatchObject([{ relative_path: '.thumbs/demo-bracket.svg' }]);
    expect(state.files.get('gcodes/demo-bracket.gcode')?.content.toString()).toContain(';LAYER:27');
    expect(state.history.map((job) => job.status)).toEqual(['completed', 'cancelled', 'completed']);
    const temperatures = handleRpc(state, 'server.temperature_store', {}) as Record<string, { temperatures: number[] }>;
    expect(temperatures.extruder?.temperatures.length).toBeGreaterThan(100);
    state.tick(1);
    expect((handleRpc(state, 'server.temperature_store', {}) as typeof temperatures).extruder?.temperatures.length).toBe(121);
    state.dispose();
  });

  it('keeps bed mesh and manual Z actions consistent with object queries and deltas', () => {
    const state = new MockPrinterState('ready');
    const deltas: Array<Record<string, unknown>> = [];
    state.onEvent((event) => { if (event.kind === 'delta') deltas.push(event.status); });
    handleRpc(state, 'printer.gcode.script', { script: 'BED_MESH_CALIBRATE' });
    handleRpc(state, 'printer.gcode.script', { script: 'BED_MESH_PROFILE SAVE=demo' });
    expect(state.objects.bed_mesh?.profile_name).toBe('demo');
    handleRpc(state, 'printer.gcode.script', { script: 'BED_MESH_CLEAR' });
    expect(state.objects.bed_mesh?.mesh_matrix).toEqual([]);
    handleRpc(state, 'printer.gcode.script', { script: 'BED_MESH_PROFILE LOAD=demo' });
    expect((state.objects.bed_mesh?.mesh_matrix as unknown[]).length).toBe(3);
    handleRpc(state, 'printer.gcode.script', { script: 'PROBE_CALIBRATE' });
    handleRpc(state, 'printer.gcode.script', { script: 'TESTZ Z=-0.1' });
    expect(state.objects.manual_probe).toMatchObject({ is_active: true, z_position: 4.9, z_position_upper: 5 });
    handleRpc(state, 'printer.gcode.script', { script: 'ACCEPT' });
    expect(state.objects.manual_probe?.is_active).toBe(false);
    expect(state.objects.configfile?.save_config_pending).toBe(true);
    expect(deltas.some((delta) => 'manual_probe' in delta)).toBe(true);
    expect(() => handleRpc(state, 'printer.gcode.script', { script: 'TESTZ Z=1' })).toThrow('not active');
    state.dispose();
  });

  it('updates only the owning printer camera list and rejects missing cameras', () => {
    const ready = new MockPrinterState('ready');
    const error = new MockPrinterState('error');
    const notifications: string[] = [];
    ready.onEvent((event) => { if (event.kind === 'notify') notifications.push(event.method); });
    handleRpc(ready, 'server.webcams.post_item', { name: 'Nozzle', snapshot_url: '/webcam/?action=snapshot' });
    expect((handleRpc(ready, 'server.webcams.list', {}) as { webcams: unknown[] }).webcams).toHaveLength(2);
    expect((handleRpc(error, 'server.webcams.list', {}) as { webcams: unknown[] }).webcams).toHaveLength(1);
    handleRpc(ready, 'server.webcams.delete_item', { name: 'Nozzle' });
    expect(notifications).toEqual(['notify_webcams_changed', 'notify_webcams_changed']);
    expect(() => handleRpc(ready, 'server.webcams.delete_item', { name: 'Nozzle' })).toThrow('Camera not found');
    ready.dispose();
    error.dispose();
  });

  it('keeps the queue response and notifications in sync with file actions', () => {
    const state = new MockPrinterState('ready');
    const notifications: Array<Record<string, unknown>> = [];
    state.onEvent((event) => {
      if (event.kind === 'notify' && event.method === 'notify_job_queue_changed') {
        notifications.push(event.params[0] as Record<string, unknown>);
      }
    });
    expect(() => handleRpc(state, 'server.job_queue.post_job', { filenames: ['missing.gcode'] })).toThrow('File not found');
    expect(state.queuedJobs).toHaveLength(0);
    const added = handleRpc(state, 'server.job_queue.post_job', { filenames: ['mock-cube.gcode'] }) as {
      queued_jobs: Array<{ job_id: string }>;
    };
    expect(added.queued_jobs).toHaveLength(1);
    expect(notifications.at(-1)).toMatchObject({ action: 'jobs_added', updated_queue: added.queued_jobs });
    handleRpc(state, 'server.job_queue.pause', {});
    expect(handleRpc(state, 'server.job_queue.status', {})).toMatchObject({ queue_state: 'paused' });
    handleRpc(state, 'server.job_queue.delete_job', { job_ids: [added.queued_jobs[0]!.job_id] });
    expect(notifications.at(-1)).toMatchObject({ action: 'jobs_removed', updated_queue: [] });
    state.dispose();
  });
});

describe('mock Moonraker HTTP and WebSocket', () => {
  it('serves files and database items without a printer', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const headers = { Origin: 'http://127.0.0.1:5174' };
    expect((await (await fetch(`${server.url}/access/info`, { headers })).json()).result.login_required).toBe(false);
    const file = await fetch(`${server.url}/server/files/config/printer.cfg`, { headers });
    expect(await file.text()).toContain('[printer]');
    const log = await fetch(`${server.url}/server/files/klippy.log`, { headers });
    expect(await log.text()).toContain('Mock Klipper');
    const upload = new FormData();
    upload.append('root', 'gcodes');
    upload.append('file', new Blob(['G28\n']), 'uploaded.gcode');
    const saved = await fetch(`${server.url}/server/files/upload`, { method: 'POST', headers, body: upload });
    expect(saved.ok).toBe(true);
    expect((await fetch(`${server.url}/server/files/gcodes/uploaded.gcode`, { headers })).ok).toBe(true);
    const posted = await fetch(`${server.url}/server/database/item`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: 'tessera', key: 'layout', value: { columns: 2 } }),
    });
    expect(posted.ok).toBe(true);
    const item = await fetch(`${server.url}/server/database/item?namespace=tessera&key=layout`, { headers });
    expect((await item.json()).result.value).toEqual({ columns: 2 });
    const refused = await fetch(`${server.url}/server/info`, { headers: { Origin: 'http://evil.local' } });
    expect(refused.status).toBe(403);
    const thumbnail = await fetch(`${server.url}/server/files/gcodes/.thumbs/demo-bracket.svg`, { headers });
    expect(thumbnail.headers.get('content-type')).toBe('image/svg+xml');
    expect(await thumbnail.text()).toContain('BRACKET');
    const camera = await fetch(`${server.url}/webcam/?action=snapshot`, { headers });
    expect(camera.headers.get('content-type')).toBe('image/svg+xml');
    expect(await camera.text()).toContain('Tessera Mock');
  });

  it('returns absolute camera URLs and broadcasts edits to WebSocket clients', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const socket = await connect(server.url);
    const list = message(socket);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server.webcams.list' }));
    expect((await list).result).toMatchObject({ webcams: [{ snapshot_url: `${server.url}/webcam/?action=snapshot` }] });
    const notification = message(socket);
    handleRpc(state, 'server.webcams.post_item', { name: 'Nozzle', snapshot_url: '/webcam/?action=snapshot' });
    expect((await notification).method).toBe('notify_webcams_changed');
    socket.close();
  });

  it('streams calibration changes only to subscribed WebSocket objects', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const socket = await connect(server.url);
    const initial = message(socket);
    socket.send(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'printer.objects.subscribe',
      params: { objects: { bed_mesh: ['profile_name'], manual_probe: ['is_active'] } },
    }));
    expect((await initial).result).toMatchObject({ status: { bed_mesh: { profile_name: 'default' } } });
    const meshUpdate = message(socket);
    handleRpc(state, 'printer.gcode.script', { script: 'BED_MESH_CALIBRATE' });
    expect(((await meshUpdate).params as unknown[])[0]).toMatchObject({ bed_mesh: { profile_name: '' } });
    const probeUpdate = message(socket);
    handleRpc(state, 'printer.gcode.script', { script: 'PROBE_CALIBRATE' });
    expect(((await probeUpdate).params as unknown[])[0]).toMatchObject({ manual_probe: { is_active: true } });
    socket.close();
  });

  it('answers JSON-RPC and streams only subscribed fields', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const socket = await connect(server.url);
    const answer = message(socket);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'printer.objects.subscribe', params: { objects: { extruder: ['target'] } } }));
    expect((await answer).result).toMatchObject({ status: { extruder: { target: 0 } } });
    const update = message(socket);
    state.patch('extruder', { target: 205, temperature: 30 });
    const notification = await update;
    expect(notification.method).toBe('notify_status_update');
    expect((notification.params as unknown[])[0]).toEqual({ extruder: { target: 205 } });
    const missing = message(socket);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'missing.method' }));
    expect((await missing).error).toMatchObject({ code: -32601 });
    socket.close();
  });

  it('drives the real Tessera proxy through its normal subscription path', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const proxy = createMoonrakerProxy(server.url, {
      WebSocket: (url) => new WebSocket(url, { origin: 'http://127.0.0.1:5174' }) as unknown as WebSocketLike,
    });
    try {
      await new Promise<void>((resolve) => proxy.handle.onReady(resolve));
      expect(await proxy.handle.request<{ klippy_state: string }>('server.info')).toMatchObject({ klippy_state: 'ready' });
      let readyToPatch = () => {};
      const subscribed = new Promise<void>((resolve) => { readyToPatch = resolve; });
      const delta = new Promise<Record<string, unknown>>((resolve) => {
        proxy.handle.subscribe({ extruder: ['target'] }, (status) => {
          const target = (status as { extruder?: { target?: number } }).extruder?.target;
          if (target === 0) readyToPatch();
          if (target === 215) {
            resolve(status as Record<string, unknown>);
          }
        });
      });
      await subscribed;
      state.patch('extruder', { target: 215 });
      expect(await delta).toMatchObject({ extruder: { target: 215 } });
    } finally {
      proxy.dispose();
    }
  });

  it('routes requests to a visitor-specific state without starting another server', async () => {
    const sessions = createMockSessionStore();
    const a = sessions.getOrCreate('a');
    const b = sessions.getOrCreate('b');
    a.ready.putFile('config/visitor.txt', Buffer.from('only a'));
    const server = await startMockMoonrakerServer({
      state: (request) => request.headers['x-mock-session'] === 'a' ? a.ready : b.ready,
      host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const fileUrl = `${server.url}/server/files/config/visitor.txt`;
    const own = await fetch(fileUrl, { headers: { 'X-Mock-Session': 'a' } });
    const other = await fetch(fileUrl, { headers: { 'X-Mock-Session': 'b' } });
    expect(await own.text()).toBe('only a');
    expect(other.status).toBe(404);
    sessions.dispose();
  });

  it('drops and accepts a socket again after the Moonraker restart action', async () => {
    const state = new MockPrinterState('ready');
    const server = await startMockMoonrakerServer({
      state, host: '127.0.0.1', port: 0, allowedOrigin: 'http://127.0.0.1:5174',
    });
    servers.push(server);
    const socket = await connect(server.url);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    const reply = message(socket);
    socket.send(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'machine.services.restart', params: { service: 'moonraker' },
    }));
    expect((await reply).result).toBe('ok');
    await closed;
    const reconnected = await connect(server.url);
    const info = message(reconnected);
    reconnected.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'server.info' }));
    expect((await info).result).toMatchObject({ klippy_state: 'ready' });
    reconnected.close();
  });
});
