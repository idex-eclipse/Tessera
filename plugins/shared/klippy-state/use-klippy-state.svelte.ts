import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

export type KlippyState =
  | 'ready'
  | 'startup'
  | 'shutdown'
  | 'error'
  | 'disconnected'
  | 'unknown';

const DEBUG = false;
const log = (...a: unknown[]) => DEBUG && console.debug('[klippy-state]', ...a);

/**
 * ЕДИНСТВЕННЫЙ источник состояния Klipper.
 * Module-level $state keyed по printerId; одна подписка на принтер (refcount).
 *
 * ОСНОВНОЙ КАНАЛ: poll printer.info раз в 1.5с при нестабильном состоянии
 * (startup/shutdown/error/disconnected). Это самый надёжный источник —
 * Moonraker отвечает всегда, даже когда Klipper disconnected.
 * webhooks-подписка и notify_klippy_* — вторичные ускорители.
 */

let stateByPrinter = $state<Record<string, KlippyState>>({});
let messageByPrinter = $state<Record<string, string>>({});

interface Attachment {
  unsubs: Array<() => void>;
  consumers: number;
  poll: ReturnType<typeof setInterval> | null;
  api: PluginApi;
}
const attachments = new Map<string, Attachment>();

const UNSTABLE: ReadonlySet<KlippyState> = new Set([
  'startup',
  'shutdown',
  'error',
  'disconnected',
]);

function safeHandle(api: PluginApi): MoonrakerProxyHandle | null {
  try {
    return api.moonraker();
  } catch {
    return null;
  }
}

function setMessage(pid: string, m: string): void {
  messageByPrinter = { ...messageByPrinter, [pid]: m };
}

async function doPoll(pid: string, att: Attachment): Promise<void> {
  log('poll-tick', pid);
  const cur = stateByPrinter[pid] ?? 'unknown';
  
  if (cur === 'ready') {
    log('poll: state is ready, stopping');
    stopPoll(att);
    return;
  }
  
  const h = safeHandle(att.api);
  if (!h) {
    log('poll: no handle (proxy unavailable)');
    return;
  }
  
  let info: any = null;
  try {
    info = await h.request<any>('printer.info');
  } catch (e) {
    log('poll: request failed', e);
    return;
  }
  
  if (!info || typeof info !== 'object') {
    log('poll: invalid response');
    return;
  }
  
  if (typeof info.state !== 'string') {
    log('poll: no state field');
    return;
  }
  
  log('poll got', pid, info.state, 'current:', cur);
  const ns = info.state as KlippyState;
  
  if (ns !== cur) {
    log('poll→set', pid, ns);
    stateByPrinter = { ...stateByPrinter, [pid]: ns };
    if (typeof info.state_message === 'string') {
      setMessage(pid, info.state_message);
    }
    if (ns === 'ready') {
      stopPoll(att);
    }
  }
}

function startPoll(pid: string, att: Attachment): void {
  if (att.poll) return;
  log('start-poll', pid);
  att.poll = setInterval(() => doPoll(pid, att), 1500);
}

function stopPoll(att: Attachment): void {
  if (att.poll) {
    log('stop-poll');
    clearInterval(att.poll);
    att.poll = null;
  }
}

function setState(pid: string, s: KlippyState): void {
  const prev = stateByPrinter[pid] ?? 'unknown';
  if (prev === s) return;
  log('set', pid, s, '(was', prev + ')');
  stateByPrinter = { ...stateByPrinter, [pid]: s };

  const att = attachments.get(pid);
  if (!att) {
    log('setState: no attachment for', pid);
    return;
  }

  if (s === 'ready') {
    stopPoll(att);
  } else if (UNSTABLE.has(s) && !att.poll) {
    startPoll(pid, att);
  }
}

function attach(api: PluginApi, pid: string): Attachment {
  const ex = attachments.get(pid);
  if (ex) {
    ex.consumers++;
    log('attach+', pid, ex.consumers);
    return ex;
  }

  const att: Attachment = { unsubs: [], consumers: 1, poll: null, api };
  log('attach', pid);

  const h = safeHandle(api);
  if (h) {
    att.unsubs.push(h.poll('printer.info', undefined, 1500));
    // webhooks-подписка (ускоритель)
    att.unsubs.push(
      h.subscribe(
        { webhooks: ['state', 'state_message'] },
        (d: any) => {
          const w = d?.webhooks;
          if (!w || typeof w !== 'object') return;
          if (typeof w.state === 'string') {
            log('webhooks delta', w.state);
            setState(pid, w.state as KlippyState);
          }
          if (typeof w.state_message === 'string') setMessage(pid, w.state_message);
        },
        { immediate: true },
      ),
    );

    // notify (ускоритель)
    att.unsubs.push(
      h.onNotify('notify_klippy_started', () => {
        log('notify started');
        setState(pid, 'startup');
      }),
    );
    att.unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        log('notify ready');
        setState(pid, 'ready');
        setMessage(pid, '');
      }),
    );
    att.unsubs.push(
      h.onNotify('notify_klippy_shutdown', () => {
        log('notify shutdown');
        setState(pid, 'shutdown');
      }),
    );
    att.unsubs.push(
      h.onNotify('notify_klippy_disconnected', () => {
        log('notify disconnected');
        setState(pid, 'disconnected');
        setMessage(pid, '');
      }),
    );

    // conn
    att.unsubs.push(
      h.onConnectionStatusChange((s) => {
        log('conn', pid, s);
        if (s === 'closed') {
          setState(pid, 'disconnected');
          setMessage(pid, '');
        }
        if (s === 'open') {
          void h
            .request<any>('printer.info')
            .catch(() => null)
            .then((info) => {
              if (info && typeof info.state === 'string') {
                log('conn-open bootstrap', info.state);
                setState(pid, info.state as KlippyState);
                setMessage(
                  pid,
                  typeof info.state_message === 'string' ? info.state_message : '',
                );
              }
            });
        }
      }),
    );

    att.unsubs.push(h.onReady(() => {}));
  }

  attachments.set(pid, att);
  return att;
}

function detach(pid: string, att: Attachment): void {
  att.consumers--;
  log('detach', pid, att.consumers);
  if (att.consumers > 0) return;
  stopPoll(att);
  for (const u of att.unsubs) u();
  attachments.delete(pid);
}

export function useKlippyState(api: PluginApi) {
  let printerId = $state(api.printer.id);
  let att = attach(api, printerId);

  const offPrinter = api.onPrinterChange((p) => {
    detach(printerId, att);
    printerId = p.id;
    att = attach(api, printerId);
  });

  onDestroy(() => {
    offPrinter();
    detach(printerId, att);
  });

  return {
    get state(): KlippyState {
      return stateByPrinter[printerId] ?? 'unknown';
    },
    get stateMessage(): string {
      return messageByPrinter[printerId] ?? '';
    },
    get ready(): boolean {
      return (stateByPrinter[printerId] ?? 'unknown') === 'ready';
    },
    get error(): boolean {
      const s = stateByPrinter[printerId] ?? 'unknown';
      return s === 'error' || s === 'shutdown';
    },
  };
}

export type KlippyStateStore = ReturnType<typeof useKlippyState>;