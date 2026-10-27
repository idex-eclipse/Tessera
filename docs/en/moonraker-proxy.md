# MoonrakerProxy and `MoonrakerProxyHandle`

Plugins do not open WebSockets themselves. The host keeps a **proxy pool** — one
connection per Moonraker (the printer's normalized origin) — and gives a plugin a
**handle**: `api.moonraker()` for the active printer or
`api.moonrakerFor(printerId)` for any printer.

What the proxy provides:

- one WebSocket per printer, shared by all plugins;
- a **snapshot cache**: a new subscriber instantly gets the current state;
- a **TTL cache** for safe reads, with invalidation by events;
- merging of subscriptions from different plugins into one set of objects;
- background reconnection with exponential backoff;
- **poll-on-demand** for data Moonraker does not push by itself;
- a single place for authorization (401 → login overlay).

Switching the printer tab **does not drop** connections; a proxy lives as long as
the printer is in the registry.

---

## The handle interface

```ts
interface MoonrakerProxyHandle {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;

  subscribe(
    objects: Record<string, string[]>,
    callback: (delta: any) => void,
    options?: { immediate?: boolean },
  ): () => void;

  onNotify(event: string, callback: (params: any) => void): () => void;

  poll(method: string, params: unknown, intervalMs: number): () => void;

  readonly httpBaseUrl: string;
  readonly readyState: 'connecting' | 'open' | 'closed';
  readonly authToken: string | null;

  onReady(callback: () => void): () => void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void;
}
```

---

## `request(method, params?)`

A JSON-RPC call to Moonraker over the WebSocket. Returns the response's `result`.

```ts
const info = await api.moonraker().request<{ state: string }>('printer.info');

await api.moonraker().request('printer.gcode.script', { script: 'G28' });
```

The request path:

```
plugin → GuardAgent (preflight) → cache → WebSocket → Moonraker
```

### Errors

`request` returns a Promise that is rejected with one of:

| Cause | Type | Marker |
|---|---|---|
| Moonraker returned a JSON-RPC error | `MoonrakerRequestError` | `error.name === 'MoonrakerRequestError'`, `error.message`, `error.code`, `error.data` |
| The connection is not open | `Error` | `message: 'Moonraker connection is not open'` |
| The connection dropped while the request was in flight | `Error` | `message: 'Moonraker connection closed'` |
| A socket send error | `Error` | as is |
| A guard vetoed it | `GuardError` | `error.rejection.code === 'denied_by_guard'` |
| A guard did not answer / parking expired | `GuardError` | `'guard_timeout'` |
| An identical request is already waiting for a decision | `GuardError` | `'already_pending'` |
| The printer was removed (for `moonrakerFor`) | `Error` | `printer '…' is not configured` |

```ts
try {
  await api.moonraker().request('printer.print.start', { filename });
} catch (e) {
  const r = (e as { rejection?: { code: string; pluginId?: string; reasonKey?: string } }).rejection;
  if (r?.code === 'denied_by_guard') showDenied(api.i18n.t(r.reasonKey ?? 'guards.denied'));
  else if (r?.code === 'already_pending') return;      // the dialog is already open
  else showError(e);
}
```

> **A request can hang for a long time.** If a guard answered `freeze`, `request`
> waits for the user's decision — up to 10 minutes. Do not put short timeouts on it.

The JSON-RPC request to Moonraker itself has no timeout in the proxy: the response
arrives or the request is rejected when the connection drops (pending requests are
rejected when the socket closes).

### What is cached

Responses are cached **transparently**: your code is the same, but a repeated
identical `request` may not go to the network.

**Snapshot cache** — lives while the socket is open (reset on `notify_klippy_*`):

- `server.info`, `printer.info`.

**TTL cache** (method + params → value, invalidated by a notification):

| Method | TTL | Reset by |
|---|---|---|
| `server.files.list` | 10 s | `notify_filelist_changed` |
| `server.files.get_directory` | 10 s | `notify_filelist_changed` |
| `server.files.metadata` | 10 s | `notify_filelist_changed` |
| `server.history.list` | 10 s | `notify_history_changed` |
| `printer.configfile.*` | 30 s | `notify_config_changed` |

**Never cached:**

`printer.gcode.script`, `printer.emergency_stop`, `printer.restart`,
`printer.firmware_restart`, `printer.objects.(un)subscribe`,
`server.files.upload|delete_file|move|copy|post_directory|delete_directory`,
everything under `server.webcams.*` and any `server.files.(upload|delete|move|copy|post)*`.

If `poll()` runs on a method, values go into the same cache with
`TTL = max(ruleTTL, interval × 2)`.

Practical takeaway: **to read a "fresh" value, prefer a subscription**
(`subscribe`) over a repeated `request`. For data that is not in status objects and
needs periodic refresh, use `poll()`.

---

## `subscribe(objects, callback, options?)`

A subscription to Klipper status objects (`printer.objects.subscribe`).

```ts
const off = api.moonraker().subscribe(
  { extruder: ['temperature', 'target'], heater_bed: ['temperature', 'target'] },
  (delta) => {
    // delta: { extruder?: { temperature?: number, target?: number }, heater_bed?: {...} }
    if (delta.extruder?.temperature !== undefined) setHotend(delta.extruder.temperature);
  },
);
// off() — unsubscribe
```

### The `objects` format

`{ "<object name>": ["field", …] }`. The object name is as in Klipper, including
spaces: `'heater_generic chamber'`, `'temperature_sensor mcu'`, `'gcode_macro T0'`.
An empty field array (`[]`) means *all* fields of the object.

### The `delta` format

`{ "<object>": { "<field>": value } }`. Only **changed fields** arrive, and only
for the objects/fields you subscribed to. A delta is not the full state: keep the
last known value yourself.

### The first call

By default (`immediate: true`) a new subscriber receives a **snapshot** of the
already-known values of its objects from the snapshot cache. If your subscription
does not add new fields to the shared union (somebody already requested them, for
example the proxy's baseline), the snapshot arrives almost immediately; if it does
— after Moonraker answers `printer.objects.subscribe`. Values not yet in the cache
arrive as ordinary deltas. With `{ immediate: false }` no snapshot is sent — only
subsequent deltas.

### Merging subscriptions

All subscriptions of all plugins are folded into one **union of objects and
fields** and sent to Moonraker as a single set. An object is unsubscribed when its
last subscriber leaves. Duplicate subscriptions from different plugins are free.

### Things to remember

- Subscriptions are bound to the printer's **ProxyInstance**. After
  `moonraker()` → a tab switch, the handle points to another printer; your
  subscriptions to the previous one stay with the previous one. Re-subscribe in
  `onPrinterChange`.
- Subscribing to an object that does not exist in Klipper (a typo, an unconfigured
  module) raises no error — no data simply arrives.
- The `spoolman` object is **not** a Klipper object; subscribing to it does not
  work (use the Moonraker endpoints, see `server.spoolman.*`).
- The callback is invoked inside the proxy's `try/catch`: an exception in it is
  logged and does not break other subscriptions.
- Do not subscribe to heavy objects "just in case": `[]` (all fields) on
  `motion_report` or `bed_mesh` creates extra traffic for every plugin.

### The proxy's baseline subscription

Independently of plugins, the proxy keeps its own **baseline subscription** to the
printer's key objects (`extruder*`, `heater_bed`, `toolhead`, `print_stats`,
`display_status`, `virtual_sdcard`, `gcode_move`, `webhooks`, `bed_mesh`,
`motion_report`, `idle_timeout`, `heater_generic *`) so that the snapshot cache is
warm. That is why the first subscription to those objects usually answers
instantly. The list is refreshed when the socket opens, on
`notify_klippy_ready/started` and on `notify_config_changed`.

---

## `onNotify(event, callback)`

A subscription to arbitrary Moonraker JSON-RPC notifications by method name:

```ts
api.moonraker().onNotify('notify_gcode_response', (params) => {
  const line = Array.isArray(params) ? params[0] : params;   // Moonraker sends an array of strings
});
api.moonraker().onNotify('notify_filelist_changed', () => reload());
```

`params` are passed "as is" (usually an array). Many notifications wrap their payload in a
single-element array: `notify_webcams_changed` delivers `[{ webcams: [...] }]`, not the list
itself. Unwrap `params[0]` and tolerate an unexpected shape (re-request the data instead of
treating it as "empty"). Frequently used events:

| Event | When |
|---|---|
| `notify_gcode_response` | G-code console output |
| `notify_klippy_ready` / `notify_klippy_shutdown` / `notify_klippy_disconnected` | Klipper lifecycle |
| `notify_filelist_changed` | files changed |
| `notify_history_changed` | history changed |
| `notify_config_changed` | config changed |
| `notify_active_spool_set` | Spoolman: the active spool changed |
| `notify_status_update` | internal: status-object deltas (use `subscribe` for this) |

Use `subscribe` instead of `notify_status_update` — it filters the objects you need
and delivers an initial snapshot.

---

## `poll(method, params, intervalMs)`

A declaration that "I need fresh data from this method". The proxy periodically
calls the method itself and refreshes the cache `request()` reads from. Returns a
cancel function.

```ts
const stop = api.moonraker().poll('server.history.totals', undefined, 5000);
// …
const totals = await api.moonraker().request('server.history.totals'); // from cache
stop();
```

Rules:

- the minimum interval is 250 ms;
- several registrations of the same `method+params` are merged: the **minimum**
  interval is used, counting is by reference count; polling stops with the last
  cancel;
- at most one request in flight per method; the first tick is immediate on
  registration and on (re)connect of the socket;
- **methods with side effects are rejected** (see the "Never cached" list) with a
  console warning, and `poll` returns an empty function;
- `poll` bypasses GuardAgent (it is an internal refresh, reads only).

---

## Connection state

```ts
api.moonraker().readyState;                 // 'connecting' | 'open' | 'closed'

const off = api.moonraker().onConnectionStatusChange((status) => { … });
const offReady = api.moonraker().onReady(() => initialLoad());
```

- `readyState` is the socket state (not Klipper's!). `'closed'` also holds between
  reconnection attempts.
- `onConnectionStatusChange` fires on every transition.
- `onReady(cb)` is called **every time the socket opens**, and immediately (via a
  microtask) if you subscribe while the socket is already open. Suitable for
  "reload everything after (re)connect".
- Reconnection is automatic with exponential backoff (1 s → 2 s → 4 s … up to
  30 s). Offline **does not break** host loading.
- Subscriptions made before a drop are re-sent after the connection is restored
  (the proxy remembers the desired state).
- You do not need to show "no connection" to the user yourself: the host draws the
  offline overlay. But your element must not crash on rejected `request`s.

### Klipper is not ready

Moonraker may be reachable while `klippy is not ready`. Then `printer.info` returns
`state: 'startup' | 'shutdown' | 'error'`, and most `printer.*` requests and
subscriptions do not work. Read `printer.info` and `notify_klippy_ready`, and show a
"Klippy not ready" placeholder instead of errors.

---

## HTTP bypassing the WebSocket: `httpBaseUrl` and `authToken`

Binary operations (uploading and downloading files, thumbnails, camera snapshots)
go over plain HTTP to Moonraker, **bypassing the proxy, cache and guards**:

```ts
const base = api.moonraker().httpBaseUrl;           // e.g. http://printer.local:7125
const thumb = `${base}/server/files/gcodes/${encodeURIComponent(path)}`;
```

Headers for an authorized Moonraker:

```ts
const token = api.moonraker().authToken;            // string | null
fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
```

Rules:

- **Uploading files** — `POST {httpBaseUrl}/server/files/upload`, `FormData`.
  After success Moonraker sends `notify_filelist_changed` and the file cache is
  invalidated.
- **Reading file contents** (editor, etc.) — `fetch(..., { cache: 'no-store' })`.
  Otherwise the browser returns a stale body after saving.
- Direct HTTP **does not pass guards**. If an action must be protected (for example
  starting a print), use `request('printer.print.start')`, not direct HTTP.

---

## Authorization

The password never reaches plugins. The host handles sign-in itself:

1. Moonraker answers `401` (to a WebSocket request or HTTP) → the proxy flags
   "authorization required" → the host shows the sign-in overlay.
2. After sign-in the token is stored for the printer and passed to the proxy; your
   handle starts returning it in `authToken`.
3. Sign-out is initiated by the right panel; plugins can tell the host about a
   sign-out with the `window` event `mpu:auth-logout` (`detail: { printerId }`) —
   this is an infrastructure signal, not a plugin bus.

For a plugin it is enough to use `httpBaseUrl` + `authToken` for HTTP and `request`
for RPC.

---

## Recommendations

- One `subscribe` with several objects beats several subscriptions.
- Unsubscribe on unmount: leaked subscriptions keep objects in the union and load
  the connection.
- Do not call `request` in a loop or on a timer: use `subscribe` or `poll`.
- Do not hang `request('printer.gcode.script', …)` on events that may repeat: if a
  request is frozen by a guard, identical repeats are rejected as `already_pending`.
- For several printers keep one handle per printer (`moonrakerFor`) and release it
  when the printer is removed (`onPrintersChange`).
