import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { handleRpc, MockRpcError, selectStatus, type MockConnection } from './handlers.js';
import { MockPrinterState, type MockEvent } from './state.js';

/** Network settings stay outside the simulator so local and site hosts can reuse it. */
export interface MockServerOptions {
  /** A site router may select a visitor's printer from the request host. */
  state: MockPrinterState | ((request: IncomingMessage) => MockPrinterState);
  host: string;
  port: number;
  allowedOrigin: string;
  /** Public origin for a site router; local mode uses the bound server address. */
  publicBaseUrl?: (request: IncomingMessage) => string;
}

/** The caller owns the server lifetime and can shut it down with the dev launcher. */
export interface RunningMockServer {
  url: string;
  close(): Promise<void>;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Reads a bounded body so a public demo cannot keep unlimited upload data in memory. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += part.length;
    if (size > MAX_UPLOAD_BYTES) throw new MockRpcError('Upload too large', 413);
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

/** Replies with the normal Moonraker HTTP JSON envelope. */
function json(response: ServerResponse, status: number, result: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(status >= 400 ? { error: result } : { result }));
}

/** Accepts only the same origin as the local UI or the configured project site. */
function cors(request: IncomingMessage, response: ServerResponse, allowedOrigin: string): boolean {
  const origin = request.headers.origin;
  if (origin && origin !== allowedOrigin) {
    json(response, 403, { message: 'Origin not allowed' });
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return false;
  }
  return true;
}

/** Extracts the few FormData fields Tessera uses for Moonraker uploads. */
function multipart(body: Buffer, contentType: string): { filename: string; root: string; path: string; file: Buffer } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary) throw new MockRpcError('Missing multipart boundary');
  const marker = Buffer.from(`--${boundary}`);
  const fields = new Map<string, Buffer>();
  let filename = '';
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    const next = body.indexOf(marker, cursor + marker.length);
    if (next < 0) break;
    const part = body.subarray(cursor + marker.length + 2, next - 2);
    const split = part.indexOf(Buffer.from('\r\n\r\n'));
    if (split >= 0) {
      const headers = part.subarray(0, split).toString('utf8');
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      if (name) {
        fields.set(name, part.subarray(split + 4));
        if (name === 'file') filename = /filename="([^"]+)"/i.exec(headers)?.[1] ?? '';
      }
    }
    cursor = next;
  }
  const file = fields.get('file');
  const root = fields.get('root')?.toString('utf8') ?? 'gcodes';
  const path = fields.get('path')?.toString('utf8') ?? '';
  if (!filename || !file) throw new MockRpcError('Missing uploaded file');
  return { filename, root, path, file };
}

/** Prevents uploaded paths from escaping their virtual Moonraker file root. */
function filePath(root: string, path: string, filename: string): string {
  if (!['gcodes', 'config', 'logs', 'docs'].includes(root)) throw new MockRpcError(`Unknown root: ${root}`);
  const segments = [root, ...path.split('/'), filename].filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\\'))) {
    throw new MockRpcError('Invalid file path');
  }
  return segments.join('/');
}

/** Camera URLs must be absolute because Tessera resolves relative camera URLs on the host's default port. */
function absoluteWebcams(webcams: Array<Record<string, unknown>>, baseUrl: string): Array<Record<string, unknown>> {
  return webcams.map((camera) => ({
    ...camera,
    stream_url: new URL(String(camera.stream_url ?? '/webcam/?action=snapshot'), baseUrl).href,
    snapshot_url: new URL(String(camera.snapshot_url ?? '/webcam/?action=snapshot'), baseUrl).href,
  }));
}

/** Handles direct HTTP access used for files, settings sync, and the auth probe. */
async function handleHttp(
  state: MockPrinterState,
  request: IncomingMessage,
  response: ServerResponse,
  baseUrl: string,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://mock.local');
  try {
    if (request.method === 'GET' && url.pathname === '/access/info') {
      json(response, 200, { login_required: false, default_source: 'moonraker' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/access/user') {
      json(response, 200, { username: 'mock' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/access/users/list') {
      json(response, 200, { users: [{ username: 'mock' }] });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/server/info') {
      json(response, 200, handleRpc(state, 'server.info', {}));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/server/webcams/list') {
      json(response, 200, { webcams: absoluteWebcams(state.webcams, baseUrl) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/webcam/') {
      // A changing SVG snapshot exercises the real image-loading path without an MJPEG stream.
      const frame = Math.floor(Date.now() / 1000) % 1000;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#1b2732"/><path d="M95 255h450v25H95z" fill="#657380"/><path d="M245 240h150v-90H245z" fill="#83b7d4"/><path d="M305 145h30v-75h-30z" fill="#bbc7cc"/><text x="320" y="325" text-anchor="middle" fill="white" font-size="20" font-family="sans-serif">Tessera Mock · frame ${frame}</text></svg>`;
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      response.end(svg);
      return;
    }
    if (url.pathname === '/server/database/item') {
      if (request.method === 'GET') {
        const namespace = url.searchParams.get('namespace') ?? '';
        const key = url.searchParams.get('key');
        if (!state.database.has(namespace) || (key !== null && !state.database.get(namespace)?.has(key))) {
          json(response, 404, { message: 'Database item not found' });
          return;
        }
        json(response, 200, handleRpc(state, 'server.database.get_item', { namespace, ...(key === null ? {} : { key }) }));
        return;
      }
      if (request.method === 'POST') {
        json(response, 200, handleRpc(state, 'server.database.post_item', JSON.parse((await readBody(request)).toString('utf8'))));
        return;
      }
      if (request.method === 'DELETE') {
        json(response, 200, handleRpc(state, 'server.database.delete_item', {
          namespace: url.searchParams.get('namespace'), key: url.searchParams.get('key'),
        }));
        return;
      }
    }
    if (request.method === 'POST' && url.pathname === '/server/files/upload') {
      const upload = multipart(await readBody(request), request.headers['content-type'] ?? '');
      const path = filePath(upload.root, upload.path, upload.filename);
      state.putFile(path, upload.file);
      json(response, 200, { item: { path }, print_started: false, print_queued: false });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/server/files/')) {
      const requested = decodeURIComponent(url.pathname.slice('/server/files/'.length));
      // Moonraker exposes the two logs directly, outside the named file roots.
      const path = requested === 'klippy.log' || requested === 'moonraker.log'
        ? `logs/${requested}` : requested;
      const file = state.files.get(path);
      if (!file) {
        json(response, 404, { message: `File not found: ${path}` });
        return;
      }
      response.writeHead(200, {
        'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream',
        'Content-Length': file.content.length,
        'Cache-Control': 'no-store',
      });
      response.end(file.content);
      return;
    }
    json(response, 404, { message: `Path not found: ${url.pathname}` });
  } catch (error) {
    const status = error instanceof MockRpcError && error.code === 413 ? 413 : 400;
    json(response, status, { message: error instanceof Error ? error.message : String(error) });
  }
}

/** Sends only status fields that the current socket asked Moonraker to stream. */
function forwardEvent(state: MockPrinterState, socket: WebSocket, connection: MockConnection, event: MockEvent, baseUrl: string): void {
  if (socket.readyState !== socket.OPEN) return;
  if (event.kind === 'notify') {
    const params = event.method === 'notify_webcams_changed'
      ? [{ webcams: absoluteWebcams(state.webcams, baseUrl) }] : event.params;
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: event.method, params }));
    return;
  }
  const selected = selectStatus(state, connection.subscribed, event.status);
  if (Object.keys(selected).length) {
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [selected, Date.now() / 1000] }));
  }
}

/** Starts one Moonraker-compatible origin for a single virtual printer. */
export async function startMockMoonrakerServer(options: MockServerOptions): Promise<RunningMockServer> {
  const { host, port, allowedOrigin } = options;
  let boundBaseUrl = '';
  const publicBaseUrl = (request: IncomingMessage): string => options.publicBaseUrl?.(request) ?? boundBaseUrl;
  const stateFor = (request: IncomingMessage): MockPrinterState => {
    const state = typeof options.state === 'function' ? options.state(request) : options.state;
    state.startClock();
    return state;
  };
  const upgradedStates = new WeakMap<IncomingMessage, MockPrinterState>();
  const httpServer = createServer((request, response) => {
    // Reject foreign origins before a public router can allocate a visitor session.
    if (!cors(request, response, allowedOrigin)) return;
    try {
      void handleHttp(stateFor(request), request, response, publicBaseUrl(request));
    } catch {
      json(response, 404, { message: 'Mock session not found' });
    }
  });
  const sockets = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  sockets.on('connection', (socket, request) => {
    const state = upgradedStates.get(request);
    if (!state) { socket.close(); return; }
    clients.add(socket);
    const baseUrl = publicBaseUrl(request);
    const connection: MockConnection = { subscribed: {}, close: () => setTimeout(() => socket.close(), 50) };
    const raw = new URL(request.url ?? '/', 'http://mock.local').pathname === '/klippysocket';
    const off = state.onEvent((event) => {
      if (!raw) forwardEvent(state, socket, connection, event, baseUrl);
    });
    socket.on('message', (data) => {
      let id: unknown = null;
      try {
        const requestData = JSON.parse(data.toString()) as { id?: unknown; method?: unknown; params?: unknown };
        id = requestData.id ?? null;
        if (typeof requestData.method !== 'string') throw new MockRpcError('Missing method');
        const method = raw ? ({ 'objects/list': 'printer.objects.list', info: 'printer.info' } as Record<string, string>)[requestData.method] : requestData.method;
        if (!method) throw new MockRpcError(`Method not found: ${requestData.method}`, -32601);
        const result = handleRpc(state, method, requestData.params, connection);
        const publicResult = method === 'server.webcams.list'
          ? { webcams: absoluteWebcams(state.webcams, baseUrl) } : result;
        socket.send(JSON.stringify(raw ? { id, result: publicResult } : { jsonrpc: '2.0', id, result: publicResult }));
      } catch (error) {
        const code = error instanceof MockRpcError ? error.code : -32603;
        const message = error instanceof Error ? error.message : String(error);
        socket.send(JSON.stringify(raw ? { id, error: { code, message } } : { jsonrpc: '2.0', id, error: { code, message } }));
      }
    });
    socket.on('close', () => { off(); clients.delete(socket); });
  });
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://mock.local').pathname;
    if (!['/websocket', '/klippysocket'].includes(pathname) || (request.headers.origin && request.headers.origin !== allowedOrigin)) {
      socket.destroy();
      return;
    }
    try {
      upgradedStates.set(request, stateFor(request));
    } catch {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client, request));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve(); });
    });
  } catch (error) {
    sockets.close();
    throw error;
  }
  const actual = (httpServer.address() as AddressInfo).port;
  boundBaseUrl = `http://${host}:${actual}`;
  return {
    url: boundBaseUrl,
    async close() {
      for (const client of clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      if (options.state instanceof MockPrinterState) options.state.dispose();
    },
  };
}
