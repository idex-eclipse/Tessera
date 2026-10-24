# GuardAgent: preflight checks of requests

A guard is a declarative plugin check that runs **before** another plugin's
`request()` is sent to Moonraker. Guards implement rules such as "do not start a
print until the spools are confirmed" or "do not run `SAVE_CONFIG` during a print".

GuardAgent is host infrastructure. It is **not a bus**: plugins do not exchange
messages, the agent only polls guards one after another.

Limits of the mechanism (important to understand what it does NOT do):

- Only `request()` is guarded. `subscribe()`, `onNotify()`, `poll()` and direct HTTP
  (`httpBaseUrl`) are outside the pipeline.
- Guards cover only actions made **from this UI**. A print started from another
  Moonraker client is invisible to the pipeline. For that case use reactive plugins
  driven by printer state (subscribe to `print_stats.state` and react).
- It is a **preflight check, not a security boundary.**
- The agent matches only the *method string*. Parsing parameters (for example which
  G-code is inside `printer.gcode.script`) is the guard handler's job.
- Guards **do not modify** the request. They have three verdicts: `allow`, `deny`,
  `freeze`.

---

## Declaring a guard

In the manifest:

```json
{
  "guards": [
    {
      "id": "acme-print-check",
      "match": ["printer.print.start", "printer.gcode.script"],
      "handler": "printCheck"
    }
  ]
}
```

| Field | Description |
|---|---|
| `id` | the guard's identifier within the plugin (visible in rejection attribution) |
| `match` | a list of method matchers: an exact string or a glob with `*` |
| `handler` | the name of the entry module's **export** holding the handler |

Matchers are compared with the **whole method name**. `*` is any substring:

- `'printer.print.start'` — only this method;
- `'printer.*'` — all `printer.…` methods;
- `'server.files.*'` — all file methods;
- `'*'` — absolutely any request.

Request parameters do not take part in matching.

In the plugin module:

```ts
import type { GuardDecision } from '@sdk/types';

export const printCheck = (
  request: { method: string; params: unknown; targetPrinterId: string },
  token: string,
  ctx: { targetPrinterId: string },
): GuardDecision | Promise<GuardDecision> => {
  if (request.method === 'printer.gcode.script') {
    const script = String((request.params as { script?: string })?.script ?? '');
    if (!/^\s*SAVE_CONFIG\b/i.test(script)) return { action: 'allow' };
  }
  return { action: 'deny', reasonKey: 'acme.guard.notNow' };
};
```

If an export named `handler` is missing or is not a function, the guard is skipped
with the warning `[guard-agent] …: handler export "…" not found`.

---

## Verdicts

```ts
type GuardDecision =
  | { action: 'allow' }
  | { action: 'deny'; reasonKey?: string }
  | { action: 'freeze' };
```

| Verdict | What happens |
|---|---|
| `allow` | the chain moves to the next guard; after the last one the request goes to the proxy |
| `deny` | the request is rejected immediately (`denied_by_guard` with your `pluginId`, `guardId`, `reasonKey`); the remaining guards are not polled |
| `freeze` | the request is **parked**; the plugin shows its own overlay and later calls `api.guards.resume(token, …)` |

The handler may return a decision synchronously or via a Promise.

> Return **exactly** one of the three objects. An object with an unknown `action`
> is treated as `freeze` (the request is parked and waits for `resume` until the
> timeout). If the handler returns `undefined`/a non-object, the request is
> rejected as `guard_timeout` without attribution.

### Handler errors

An exception or a Promise rejection in the handler is treated as **`deny`**
(fail-closed): the request is rejected and the error is written to the console.
Write handlers defensively.

---

## Freeze and resume

An example of "confirm before starting a print":

```ts
let pendingToken: string | null = null;

export const printCheck = (request, token) => {
  if (request.method !== 'printer.print.start') return { action: 'allow' };
  pendingToken = token;           // remember BEFORE returning the decision
  showConfirmDialog(request);     // show your own overlay (the plugin's overlays[])
  return { action: 'freeze' };
};

// when the user pressed a button in the overlay:
function onUserDecision(ok: boolean) {
  if (!pendingToken) return;
  api.guards.resume(pendingToken, ok ? 'accept' : 'deny', ok ? undefined : 'acme.guard.cancelled');
  pendingToken = null;
}
```

- `token` arrives as the handler's second argument — before the decision. It is
  unique for each request.
- `resume(token, 'accept')` continues the walk **from the chain's next guard**
  (dialogs of several guards are shown strictly one after another); `'deny'`
  rejects the request with the attribution of the guard that froze it.
- The dialog is shown by **the plugin itself** (usually via its own `overlays[]`):
  the overlay's visibility is its decision.
- **Re-sending a command is not a resume.** It is a new chain; an identical request
  while a parking exists is rejected as `already_pending`. Resuming is only via the
  token.
- An unknown token (a repeated `resume`, expired parking) is ignored with a console
  warning.

---

## How the chain is built

1. All guards whose matchers match the method are taken.
2. **Minus the initiating plugin's own guards** — a guard does not guard its own
   plugin's requests (protection against recursion).
3. Order = registration order: core plugins first in bundle order, then remote ones
   in the order of the `mpu:v2:plugins` records. There are no priorities.
4. The walk is sequential. A veto from any guard wins (intersection).

Practical takeaway: you do not need to (and cannot) "intercept first". Assume the
other guards will also run.

---

## Timeouts (fail-closed)

| What | Limit | Outcome |
|---|---|---|
| The handler did not return a decision | 10 s | the request is rejected (`guard_timeout`) + a notification |
| Parking (`freeze`) without `resume` | 10 minutes | the request is rejected (`guard_timeout`) + a notification |

If a plugin with a parked chain is disabled or removed, the parking is rejected
(`denied_by_guard`).

---

## What the initiator sees

`request()` is rejected with a `GuardError` that has a `rejection` field:

```ts
interface GuardRejection {
  code: 'denied_by_guard' | 'guard_timeout' | 'already_pending';
  guardId?: string;
  pluginId?: string;      // who rejected it
  reasonKey?: string;     // i18n key of the reason from deny/resume
}
```

Translate `reasonKey` with `api.i18n.t`. The key must be in the dictionary of the
plugin that assigned it — or in a shared one (`common.*`) if you want it to be
understood by any initiator.

## Notifications

On a veto, a decision timeout and a parking timeout the host sends the `window`
event `mpu:guard-notify` (`detail`: `{ kind: 'denied' | 'decision_timeout' |
'park_timeout', pluginId, guardId, method, targetPrinterId, reasonKey? }`), which
is shown in the notification center. This is an infrastructure transport, not a
channel for plugins.

---

## Target-scoped guards

A request knows its target printer:

- `api.moonraker().request()` → the active printer at the time of the call;
- `api.moonrakerFor(pid).request()` → `pid`.

The handler receives the target in its **third argument** `ctx.targetPrinterId`
(and in `request.targetPrinterId`). The `already_pending` key and parkings include
the printer: a freeze on printer A does not block the same request on B.

If a guard keeps state (is a print running, is homing done), keep it **per
printer** and **do not tie it to the lifecycle of a page or a hook core**: a data
core is created lazily for a consumer and may not exist for the printer the request
targets — the guard would see default values and decide wrongly. A reliable
approach is a module-level tracker started by an always-mounted surface of the
plugin (for example, an overlay), with the guard handler fetching the data from
Moonraker once when it is missing. See `plugins/calibrations/printer-tracker.ts`
for a reference. Keep the state like this: `Map<printerId, State>`, subscribing to all printers through
`moonrakerFor` and syncing with `onPrintersChange`. A guard that reads only the
active printer's state will decide based on the wrong printer when called for a
non-active one (fleet).

---

## Observability

Settings → About / Debug shows the registered guards (plugin, matchers) and the
parked chains (token-method, who froze it, age) in real time.

## What guards do not do

- they do not modify the request or substitute parameters;
- they have no priorities or reordering;
- they do not guard `subscribe`/`poll`/HTTP;
- they do not replace Moonraker authorization.
