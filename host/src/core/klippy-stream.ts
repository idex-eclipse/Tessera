import type { KlippyStreamStatus } from '../../../plugin-sdk/src/types';
import type { WebSocketFactory, WebSocketLike } from './moonraker-proxy';

/**
 * Klippy-stream: bulk-потоки Klipper через raw-мост Moonraker `/klippysocket`.
 *
 * Обычный `/websocket` Moonraker такие данные не отдаёт: вебхук Klipper
 * (`load_cell/dump_force`) доставляет пакеты по `response_template`, и это
 * работает только на raw-мосте. Протокол моста: запрос без `jsonrpc`
 * `{id, method, params: {…, response_template: {key}}}`, ответ `{id, result|error}`,
 * далее сообщения `{key, params}`.
 *
 * У Klipper нет отписки: поток идёт, пока открыт сокет. Поэтому:
 * - сокет открывается лениво, с первой подписки, один на прокси принтера;
 * - подписки с одинаковым method+params делят один поток Klipper (refcount);
 * - отмена подписки, после которой поток группы остаётся без слушателей, закрывает
 *   сокет, а оставшиеся группы подписываются заново на новом сокете; с последней
 *   отменой сокет закрыт и не переоткрывается.
 *
 * Плагин сокетов не видит: он вызывает `handle.klippyStream(...)`, как `poll`.
 */

/** Методы, разрешённые плагинам. Только чтение; расширяется строкой. */
export const KLIPPY_STREAM_METHODS: ReadonlySet<string> = new Set(['load_cell/dump_force']);

export interface KlippyStreamDeps {
  /** Полный адрес моста (с `?token=`, если он есть) на момент подключения. */
  url: () => string;
  webSocketFactory: WebSocketFactory;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
}

export interface KlippyStream {
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onData: (data: unknown) => void,
    onStatus?: (status: KlippyStreamStatus) => void,
  ): () => void;
  dispose(): void;
}

interface Sub {
  onData: (data: unknown) => void;
  onStatus?: (status: KlippyStreamStatus) => void;
}

interface Group {
  groupKey: string;
  method: string;
  params: Record<string, unknown>;
  /** Ключ response_template текущей подписки Klipper; null — ещё не отправлена. */
  streamKey: string | null;
  failed: boolean;
  subs: Set<Sub>;
}

/** `ws(s)://host/websocket` → `ws(s)://host/klippysocket` (сохраняет префикс пути и query). */
export function toKlippySocketUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    url.pathname = url.pathname.replace(/\/websocket\/?$/, '') + '/klippysocket';
    return url.toString();
  } catch {
    return wsUrl.replace(/\/websocket(\?|$)/, '/klippysocket$1');
  }
}

export function createKlippyStream(deps: KlippyStreamDeps): KlippyStream {
  const groups = new Map<string, Group>();
  const pending = new Map<number, Group>();

  let ws: WebSocketLike | null = null;
  let open = false;
  let status: KlippyStreamStatus = 'connecting';
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  let nextKey = 1;
  let disposed = false;

  function groupKeyFor(method: string, params: Record<string, unknown>): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  function setStatus(next: KlippyStreamStatus): void {
    if (status === next) return;
    status = next;
    for (const g of groups.values()) {
      if (!g.failed) notify(g, next);
    }
  }

  function notify(group: Group, s: KlippyStreamStatus): void {
    for (const sub of Array.from(group.subs)) {
      try {
        sub.onStatus?.(s);
      } catch (e) {
        console.error('[klippy-stream] status callback failed', e);
      }
    }
  }

  function closeSocket(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending.clear();
    open = false;
    const socket = ws;
    ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  function connect(): void {
    if (disposed || ws || groups.size === 0) return;

    let socket: WebSocketLike;
    try {
      socket = deps.webSocketFactory(deps.url());
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      open = true;
      attempts = 0;
      setStatus('live');
      for (const g of groups.values()) sendSubscribe(g);
    };
    socket.onmessage = (event) => {
      if (ws === socket) handleMessage(event.data);
    };
    const lost = () => {
      if (ws !== socket) return;
      ws = null;
      open = false;
      pending.clear();
      for (const g of groups.values()) g.streamKey = null;
      setStatus('unavailable');
      scheduleReconnect();
    };
    socket.onclose = lost;
    socket.onerror = lost;
  }

  function scheduleReconnect(): void {
    if (disposed || timer !== null || groups.size === 0) return;
    const delay = Math.min(deps.baseReconnectDelay * 2 ** attempts, deps.maxReconnectDelay);
    attempts += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  }

  function sendSubscribe(group: Group): void {
    if (!ws || !open || group.streamKey !== null) return;
    const id = nextId++;
    const streamKey = `tessera:${nextKey++}`;
    group.streamKey = streamKey;
    group.failed = false;
    pending.set(id, group);
    try {
      ws.send(
        JSON.stringify({
          id,
          method: group.method,
          params: { ...group.params, response_template: { key: streamKey } },
        }),
      );
    } catch {
      pending.delete(id);
      group.streamKey = null;
    }
  }

  function handleMessage(raw: string): void {
    let msg: { id?: unknown; key?: unknown; params?: unknown; error?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const group = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) {
        // Klipper отклонил подписку (нет такого load_cell, не готов): без ретраев,
        // сокет остаётся для других групп.
        group.failed = true;
        notify(group, 'unavailable');
      }
      return;
    }
    if (typeof msg.key !== 'string') return;
    for (const g of groups.values()) {
      if (g.streamKey !== msg.key) continue;
      for (const sub of Array.from(g.subs)) {
        try {
          sub.onData(msg.params);
        } catch (e) {
          console.error('[klippy-stream] data callback failed', e);
        }
      }
      return;
    }
  }

  function subscribe(
    method: string,
    params: Record<string, unknown>,
    onData: (data: unknown) => void,
    onStatus?: (s: KlippyStreamStatus) => void,
  ): () => void {
    if (disposed) return () => {};
    if (!KLIPPY_STREAM_METHODS.has(method)) {
      console.warn(`[moonraker-proxy] klippyStream() refused for method: ${method}`);
      return () => {};
    }

    const key = groupKeyFor(method, params);
    let group = groups.get(key);
    if (!group) {
      group = { groupKey: key, method, params, streamKey: null, failed: false, subs: new Set() };
      groups.set(key, group);
    }
    const sub: Sub = { onData, onStatus };
    group.subs.add(sub);

    if (onStatus) {
      try {
        onStatus(group.failed ? 'unavailable' : status);
      } catch (e) {
        console.error('[klippy-stream] status callback failed', e);
      }
    }

    if (!ws) connect();
    else sendSubscribe(group);

    return () => {
      const g = groups.get(key);
      if (!g || !g.subs.delete(sub)) return;
      if (g.subs.size > 0) return;
      groups.delete(key);
      const streaming = g.streamKey !== null;
      if (groups.size === 0) {
        closeSocket();
        attempts = 0;
        status = 'connecting';
      } else if (streaming) {
        // Отписки в Klipper нет: гасим поток, пересоздав сокет для оставшихся групп.
        closeSocket();
        status = 'connecting';
        for (const other of groups.values()) other.streamKey = null;
        connect();
      }
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    closeSocket();
    groups.clear();
  }

  return { subscribe, dispose };
}
