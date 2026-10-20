import type {
  GuardContribution,
  GuardDecision,
} from '../../../plugin-sdk/src/types';

/**
 * GuardAgent — префлайт-конвейер request() (решение O, CONTEXT.md).
 *
 * - цепочка = гарды с совпавшими матчерами МИНУС гарды инициатора;
 * - порядок = порядок регистрации (core по бандлу, remote по mpu:v2:plugins);
 * - allow → следующий; deny → reject с атрибуцией; freeze → парковка с токеном,
 *   возобновление ТОЛЬКО через resume(token);
 * - таймауты fail-closed: решение 10с, парковка 10мин → deny + notify;
 * - идентичный (method+params) запрос при живой парковке → already_pending;
 * - выгрузка плагина атомарно снимает гарды и deny-ит его парковки;
 * - гарды НЕ мутируют запрос; subscribe/poll/HTTP мимо конвейера.
 */

export interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

export type GuardHandlerFn = (
  request: GuardRequest,
  token: string,
  ctx: { targetPrinterId: string },
) => GuardDecision | Promise<GuardDecision>;

export type GuardRejectionCode =
  | 'denied_by_guard'
  | 'guard_timeout'
  | 'already_pending';

export interface GuardRejection {
  code: GuardRejectionCode;
  guardId?: string;
  pluginId?: string;
  reasonKey?: string;
}

export class GuardError extends Error {
  readonly rejection: GuardRejection;

  constructor(rejection: GuardRejection) {
    super(rejectionMessage(rejection));
    this.name = 'GuardError';
    this.rejection = rejection;
  }
}

function rejectionMessage(r: GuardRejection): string {
  if (r.code === 'already_pending') return 'Identical request already pending';
  if (r.code === 'guard_timeout') {
    return `Guard timeout (${r.pluginId ?? '?'}/${r.guardId ?? '?'})`;
  }
  return `Denied by guard ${r.pluginId ?? '?'}/${r.guardId ?? '?'}`;
}

export interface RegisteredGuardView {
  pluginId: string;
  guardId: string;
  matchers: string[];
}

export interface ParkedChainView {
  token: string;
  method: string;
  targetPrinterId: string;
  initiatorPluginId: string;
  frozenByPluginId: string;
  frozenByGuardId: string;
  parkedAt: number;
  ageMs: number;
}

export interface GuardNotifyDetail {
  kind: 'decision_timeout' | 'park_timeout' | 'denied';
  pluginId: string;
  guardId: string;
  method: string;
  targetPrinterId: string;
  reasonKey?: string;
}

/** Транспорт fail-closed уведомлений: хост диспатчит, @core/system слушает.
 *  Дублируется строкой в use-notifications (плагины не импортируют host-core). */
export const GUARD_NOTIFY_EVENT = 'mpu:guard-notify';

export interface GuardAgentOptions {
  now?: () => number;
  decisionTimeoutMs?: number;
  parkTimeoutMs?: number;
  newToken?: () => string;
  onNotify?: (detail: GuardNotifyDetail) => void;
}

interface RegisteredGuard extends RegisteredGuardView {
  handler: GuardHandlerFn;
  seq: number;
}

interface ChainContext {
  initiatorPluginId: string;
  targetPrinterId: string;
  method: string;
  params: unknown;
  identityKey: string;
  settle: (o: { ok: true } | { ok: false; rejection: GuardRejection }) => void;
}

interface ParkedChain {
  token: string;
  ctx: ChainContext;
  chain: RegisteredGuard[];
  nextIndex: number;
  frozenBy: { pluginId: string; guardId: string };
  parkedAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolveWalk: () => void;
  rejectWalk: (rejection: GuardRejection) => void;
}

export function createGuardAgent(options: GuardAgentOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const onNotifySink = options.onNotify;
  const decisionTimeoutMs = options.decisionTimeoutMs ?? 10_000;
  const parkTimeoutMs = options.parkTimeoutMs ?? 10 * 60_000;
  const newToken = options.newToken ?? defaultNewToken;

  let guards: RegisteredGuard[] = [];   // порядок массива = порядок регистрации
  let seq = 0;
  const parked = new Map<string, ParkedChain>();
  const parkedByIdentity = new Map<string, string>();
  const changeListeners = new Set<() => void>();

  function emitChange(): void {
    for (const cb of Array.from(changeListeners)) {
      try {
        cb();
      } catch (e) {
        console.error('[guard-agent] change listener error', e);
      }
    }
  }
  
  function notify(detail: GuardNotifyDetail): void {
    if (onNotifySink) {
      onNotifySink(detail);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(GUARD_NOTIFY_EVENT, { detail }));
    }
  }

  // ------------------------------------------------------------------
  // Регистрация
  // ------------------------------------------------------------------

  function registerGuards(
    pluginId: string,
    contributions: GuardContribution[],
    module: Record<string, unknown> | null,
  ): void {
    unregisterGuards(pluginId);

    for (const c of contributions) {
      if (!c || typeof c.id !== 'string' || !Array.isArray(c.match) || typeof c.handler !== 'string') {
        console.warn(`[guard-agent] ${pluginId}: invalid guard contribution`, c);
        continue;
      }
      const fn = module?.[c.handler];
      if (typeof fn !== 'function') {
        console.warn(
          `[guard-agent] ${pluginId}: handler export "${c.handler}" not found; guard "${c.id}" skipped`,
        );
        continue;
      }
      guards.push({
        pluginId,
        guardId: c.id,
        matchers: c.match.filter((m): m is string => typeof m === 'string' && m.length > 0),
        handler: fn as GuardHandlerFn,
        seq: seq++,
      });
    }
    emitChange();
  }

  /** Атомарное снятие: новые цепочки гарды не видят; парковки плагина → deny. */
  function unregisterGuards(pluginId: string): void {
    const before = guards.length;
    guards = guards.filter((g) => g.pluginId !== pluginId);

    for (const token of Array.from(parked.keys())) {
      const p = parked.get(token);
      if (!p) continue;
      if (p.frozenBy.pluginId === pluginId || p.ctx.initiatorPluginId === pluginId) {
        removeParked(token);
        p.rejectWalk({
          code: 'denied_by_guard',
          guardId: p.frozenBy.guardId,
          pluginId: p.frozenBy.pluginId,
        });
      }
    }

    if (guards.length !== before) emitChange();
  }

  // ------------------------------------------------------------------
  // Конвейер
  // ------------------------------------------------------------------

  function buildChain(initiatorPluginId: string, method: string): RegisteredGuard[] {
    return guards.filter(
      (g) => g.pluginId !== initiatorPluginId && g.matchers.some((m) => matchMatcher(m, method)),
    );
  }

  function runPreflight(
    initiatorPluginId: string,
    targetPrinterId: string,
    method: string,
    params: unknown,
  ): Promise<void> {
    const chain = buildChain(initiatorPluginId, method);
    if (chain.length === 0) return Promise.resolve();

    const identityKey = identityKeyFor(targetPrinterId, method, params);
    if (parkedByIdentity.has(identityKey)) {
      return Promise.reject(new GuardError({ code: 'already_pending' }));
    }

    const ctx: ChainContext = {
      initiatorPluginId,
      targetPrinterId,
      method,
      params,
      identityKey,
      settle: () => {},
    };

    const outer = new Promise<void>((resolve, reject) => {
      ctx.settle = (o) => {
        if (o.ok) {
          resolve();
          return;
        }
        if (o.rejection.code === 'denied_by_guard') {
          notify({
            kind: 'denied',
            pluginId: o.rejection.pluginId ?? '',
            guardId: o.rejection.guardId ?? '',
            method,
            targetPrinterId,
            reasonKey: o.rejection.reasonKey,
          });
        }
        reject(new GuardError(o.rejection));
      };
    });

    walk(chain, 0, ctx).then(
      () => ctx.settle({ ok: true }),
      (e) => ctx.settle({ ok: false, rejection: rejectionFrom(e) }),
    );

    return outer;
  }

  async function walk(
    chain: RegisteredGuard[],
    index: number,
    ctx: ChainContext,
  ): Promise<void> {
    for (let i = index; i < chain.length; i++) {
      const guard = chain[i]!;
      const { decision, token } = await callGuard(guard, ctx);

      if (decision.action === 'allow') continue;

      if (decision.action === 'deny') {
        throw new GuardError({
          code: 'denied_by_guard',
          guardId: guard.guardId,
          pluginId: guard.pluginId,
          reasonKey: decision.reasonKey,
        });
      }

      // freeze: суспенд до resume(token); продолжение — walk(nextIndex)
      await park(chain, i, guard, ctx, token);
      return;
    }
  }

  function callGuard(
    guard: RegisteredGuard,
    ctx: ChainContext,
  ): Promise<{ decision: GuardDecision; token: string }> {
    const token = newToken();

    return new Promise<{ decision: GuardDecision; token: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        notify({
          kind: 'decision_timeout',
          pluginId: guard.pluginId,
          guardId: guard.guardId,
          method: ctx.method,
          targetPrinterId: ctx.targetPrinterId,
        });
        reject(
          new GuardError({
            code: 'guard_timeout',
            guardId: guard.guardId,
            pluginId: guard.pluginId,
          }),
        );
      }, decisionTimeoutMs);

      let out: GuardDecision | Promise<GuardDecision>;
      try {
        out = guard.handler(
          { method: ctx.method, params: ctx.params, targetPrinterId: ctx.targetPrinterId },
          token,
          { targetPrinterId: ctx.targetPrinterId },
        );
      } catch (e) {
        clearTimeout(timer);
        console.error('[guard-agent] handler threw', guard.pluginId, guard.guardId, e);
        reject(
          new GuardError({
            code: 'denied_by_guard',
            guardId: guard.guardId,
            pluginId: guard.pluginId,
          }),
        );
        return;
      }

      Promise.resolve(out).then(
        (d) => {
          clearTimeout(timer);
          resolve({ decision: d, token });
        },
        (e) => {
          clearTimeout(timer);
          console.error('[guard-agent] handler rejected', guard.pluginId, guard.guardId, e);
          reject(
            new GuardError({
              code: 'denied_by_guard',
              guardId: guard.guardId,
              pluginId: guard.pluginId,
            }),
          );
        },
      );
    });
  }

  function park(
    chain: RegisteredGuard[],
    index: number,
    guard: RegisteredGuard,
    ctx: ChainContext,
    token: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // гонка двух freeze по одной идентичности (оба handler'а уже прошли входной чек)
      if (parkedByIdentity.has(ctx.identityKey)) {
        reject(new GuardError({ code: 'already_pending' }));
        return;
      }

      const timer = setTimeout(() => {
        removeParked(token);
        notify({
          kind: 'park_timeout',
          pluginId: guard.pluginId,
          guardId: guard.guardId,
          method: ctx.method,
          targetPrinterId: ctx.targetPrinterId,
        });
        reject(
          new GuardError({
            code: 'guard_timeout',
            guardId: guard.guardId,
            pluginId: guard.pluginId,
          }),
        );
      }, parkTimeoutMs);

      const entry: ParkedChain = {
        token,
        ctx,
        chain,
        nextIndex: index + 1,
        frozenBy: { pluginId: guard.pluginId, guardId: guard.guardId },
        parkedAt: now(),
        timer,
        resolveWalk: resolve,
        rejectWalk: (rejection) => reject(new GuardError(rejection)),
      };

      parked.set(token, entry);
      parkedByIdentity.set(ctx.identityKey, token);
      emitChange();
    });
  }

  function resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void {
    const entry = parked.get(token);
    if (!entry) {
      console.warn('[guard-agent] resume: unknown or expired token', token);
      return;
    }
    removeParked(token);

    if (decision === 'deny') {
      entry.rejectWalk({
        code: 'denied_by_guard',
        guardId: entry.frozenBy.guardId,
        pluginId: entry.frozenBy.pluginId,
        reasonKey,
      });
      return;
    }

    // accept: обход продолжается со СЛЕДУЮЩЕГО гарда цепочки
    walk(entry.chain, entry.nextIndex, entry.ctx).then(
      () => entry.resolveWalk(),
      (e) => entry.rejectWalk(rejectionFrom(e)),
    );
  }

  function removeParked(token: string): void {
    const entry = parked.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    parked.delete(token);
    if (parkedByIdentity.get(entry.ctx.identityKey) === token) {
      parkedByIdentity.delete(entry.ctx.identityKey);
    }
    emitChange();
  }

  // ------------------------------------------------------------------
  // Наблюдаемость (About/Debug)
  // ------------------------------------------------------------------

  function getRegisteredGuards(): RegisteredGuardView[] {
    return guards.map((g) => ({
      pluginId: g.pluginId,
      guardId: g.guardId,
      matchers: [...g.matchers],
    }));
  }

  function getParkedChains(): ParkedChainView[] {
    const t = now();
    return Array.from(parked.values()).map((p) => ({
      token: p.token,
      method: p.ctx.method,
      targetPrinterId: p.ctx.targetPrinterId,
      initiatorPluginId: p.ctx.initiatorPluginId,
      frozenByPluginId: p.frozenBy.pluginId,
      frozenByGuardId: p.frozenBy.guardId,
      parkedAt: p.parkedAt,
      ageMs: Math.max(0, t - p.parkedAt),
    }));
  }

  function onChange(cb: () => void): () => void {
    changeListeners.add(cb);
    return () => {
      changeListeners.delete(cb);
    };
  }

  return {
    registerGuards,
    unregisterGuards,
    runPreflight,
    resume,
    getRegisteredGuards,
    getParkedChains,
    onChange,
  };
}

export type GuardAgent = ReturnType<typeof createGuardAgent>;

/** Единственный экземпляр на приложение (инфраструктура хоста). */
export const guardAgent = createGuardAgent();

// ------------------------------------------------------------------
// Хелперы
// ------------------------------------------------------------------

function matchMatcher(matcher: string, method: string): boolean {
  if (!matcher.includes('*')) return matcher === method;
  const escaped = matcher
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(method);
}

function identityKeyFor(printerId: string, method: string, params: unknown): string {
  const tail =
    params === undefined ? '' : (() => {
      try { return JSON.stringify(canonicalize(params)); }
      catch { return String(params); }
    })();
  return `${printerId}::${method}::${tail}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

function rejectionFrom(e: unknown): GuardRejection {
  if (e instanceof GuardError) return e.rejection;
  return { code: 'guard_timeout' };
}

function defaultNewToken(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } };
  if (c.crypto?.randomUUID) return c.crypto.randomUUID();
  return `gt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}