import type { GuardDecision } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
}

/** Moonraker methods that irreversibly erase print history or accumulated totals. */
const DESTRUCTIVE_HISTORY_METHODS = new Set([
  'server.history.delete_job',
  'server.history.reset_totals',
]);

/**
 * Restricts destructive history methods to the History owner, which provides confirmation.
 * Requests made by the owning plugin bypass its own guard and remain protected by the UI.
 */
export const guardHistoryOwnerOnly = (request: GuardRequest): GuardDecision =>
  DESTRUCTIVE_HISTORY_METHODS.has(request.method)
    ? { action: 'deny', reasonKey: 'history.guard.owner_only' }
    : { action: 'allow' };
