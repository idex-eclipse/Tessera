import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import type { HistoryJobEntry } from '../../shared/file-table/use-history-files.svelte.ts';

/** One material row derived from the retained Moonraker job history. */
export interface MaterialStats {
  type: string | null;
  jobs: number;
  failed: number;
  filamentUsed: number;
  partialFilament: boolean;
}

/** Outcome and material statistics derived from terminal history jobs. */
export interface HistoryAnalysis {
  terminalJobs: number;
  failedJobs: number;
  failureRate: number;
  materials: MaterialStats[];
}

/** A slicer estimate comparison using print time only, without pauses. */
export interface PrintEstimateComparison {
  estimate: number;
  actual: number;
  delta: number;
  percent: number;
}

const ACTIVE_STATUSES = new Set(['in_progress', 'printing', 'paused', 'standby']);
const SUCCESS_STATUSES = new Set(['completed', 'complete']);

/** Returns true when a Moonraker history status still represents a live job. */
export function isActiveHistoryStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status.trim().toLowerCase());
}

/** Returns true for every terminal status that did not complete successfully. */
export function isFailedHistoryStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized !== '' && !ACTIVE_STATUSES.has(normalized) && !SUCCESS_STATUSES.has(normalized);
}

/** Compares valid positive durations and returns null when either duration is unavailable. */
export function comparePrintEstimate(estimate: unknown, actual: unknown): PrintEstimateComparison | null {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate <= 0) return null;
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0) return null;
  const delta = actual - estimate;
  return { estimate, actual, delta, percent: delta / estimate };
}

// Slicer metadata uses several encodings for multi-extruder values.
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      // Invalid slicer metadata falls back to the ordinary string representation.
    }
  }
  return trimmed.includes(';') ? trimmed.split(';').map((item) => item.trim()).filter(Boolean) : [trimmed];
}

// Only non-negative finite lengths can participate in proportional allocation.
function numbers(value: unknown): number[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? strings(value) : [];
  return source
    .map((item) => typeof item === 'number' ? item : Number(item))
    .filter((item): item is number => Number.isFinite(item) && item >= 0);
}

/** One material's attributed share of a job's actual filament usage. */
interface MaterialShare {
  type: string | null;
  filament: number;
  complete: boolean;
}

/**
 * Attributes actual filament to material types without counting a multi-material job twice.
 * Slicer per-tool lengths provide proportions only; Moonraker's filament_used remains the total.
 */
export function materialShares(job: HistoryJobEntry): MaterialShare[] {
  const types = strings(job.metadata.filament_type);
  const actual = job.filamentUsed;
  if (types.length === 0) return [{ type: null, filament: actual, complete: true }];
  if (types.length === 1) return [{ type: types[0]!, filament: actual, complete: true }];

  const estimates = numbers(job.metadata.filament_total);
  if (estimates.length === types.length) {
    const totalEstimate = estimates.reduce((sum, value) => sum + value, 0);
    if (totalEstimate > 0) {
      const byType = new Map<string, number>();
      for (let index = 0; index < types.length; index++) {
        const type = types[index]!;
        const estimate = estimates[index] ?? 0;
        byType.set(type, (byType.get(type) ?? 0) + actual * estimate / totalEstimate);
      }
      return [...byType].map(([type, filament]) => ({ type, filament, complete: true }));
    }
  }

  // Counts remain useful, but assigning the whole actual total to every type would inflate usage.
  return [...new Set(types)].map((type) => ({ type, filament: 0, complete: false }));
}

/** Builds the failure summary and per-material rows shown by the History statistics panel. */
export function analyzeHistory(jobs: readonly HistoryJobEntry[]): HistoryAnalysis {
  const rows = new Map<string | null, MaterialStats>();
  let terminalJobs = 0;
  let failedJobs = 0;

  for (const job of jobs) {
    if (isActiveHistoryStatus(job.status)) continue;
    terminalJobs++;
    const failed = isFailedHistoryStatus(job.status);
    if (failed) failedJobs++;

    for (const share of materialShares(job)) {
      const row = rows.get(share.type) ?? {
        type: share.type,
        jobs: 0,
        failed: 0,
        filamentUsed: 0,
        partialFilament: false,
      };
      row.jobs++;
      if (failed) row.failed++;
      row.filamentUsed += share.filament;
      row.partialFilament ||= !share.complete;
      rows.set(share.type, row);
    }
  }

  const materials = [...rows.values()].sort((a, b) => {
    if (a.type === null) return 1;
    if (b.type === null) return -1;
    return b.jobs - a.jobs || a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
  });

  return {
    terminalJobs,
    failedJobs,
    failureRate: terminalJobs > 0 ? failedJobs / terminalJobs : 0,
    materials,
  };
}

/** Explains whether the selected historical file can safely be started again. */
export function reprintBlockReason(
  job: HistoryJobEntry,
  klippyReady: boolean,
  printing: boolean,
): 'file' | 'klippy' | 'printing' | null {
  if (!job.exists) return 'file';
  if (!klippyReady) return 'klippy';
  if (printing) return 'printing';
  return null;
}

/** Starts the exact unchanged G-code path represented by a history entry. */
export async function startHistoryReprint(
  moonraker: MoonrakerProxyHandle,
  job: HistoryJobEntry,
): Promise<void> {
  await moonraker.request('printer.print.start', { filename: job.filename });
}
