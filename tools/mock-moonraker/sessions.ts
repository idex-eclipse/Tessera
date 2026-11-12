import { randomUUID } from 'node:crypto';
import { MockPrinterState } from './state.js';

/** A future site visitor and the local launcher both own exactly two virtual printers. */
export interface MockSession {
  id: string;
  ready: MockPrinterState;
  error: MockPrinterState;
  lastAccess: number;
}

/** Session ownership stays separate from HTTP routing so the site can choose its own URLs. */
export function createMockSessionStore(idleMs = 30 * 60 * 1000, now = () => Date.now()) {
  const sessions = new Map<string, MockSession>();

  /** Reuses a visitor's pair after refresh or creates an isolated pair on first use. */
  function getOrCreate(id: string = randomUUID()): MockSession {
    const existing = sessions.get(id);
    if (existing) {
      existing.lastAccess = now();
      return existing;
    }
    const session: MockSession = {
      id, ready: new MockPrinterState('ready'), error: new MockPrinterState('error'), lastAccess: now(),
    };
    sessions.set(id, session);
    return session;
  }

  /** Releases printers after inactivity, which bounds memory in the future public demo. */
  function sweep(): number {
    let removed = 0;
    for (const [id, session] of sessions) {
      if (now() - session.lastAccess < idleMs) continue;
      session.ready.dispose();
      session.error.dispose();
      sessions.delete(id);
      removed++;
    }
    return removed;
  }

  // A public site must release abandoned visitors even when no new request arrives.
  const sweepTimer = setInterval(sweep, Math.max(1000, Math.min(idleMs, 60_000)));
  sweepTimer.unref();

  /** Closes all remaining sessions when a local or public server shuts down. */
  function dispose(): void {
    clearInterval(sweepTimer);
    for (const session of sessions.values()) {
      session.ready.dispose();
      session.error.dispose();
    }
    sessions.clear();
  }

  return { getOrCreate, sweep, dispose, get size() { return sessions.size; } };
}
