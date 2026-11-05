import type { MoonrakerProxyHandle } from '../../../../plugin-sdk/src/types';

/**
 * Opens a Klipper bulk stream, trying the parameter names in `variants` in turn.
 *
 * Klipper's API_Server.md documents `{ sensor: <name> }` for the load cell streams, but
 * some Klipper versions answer "Missing Argument [load_cell]" to it and want `load_cell`
 * (or `load_cell_probe` for the tap stream). The first variant is the documented one; a
 * stream that Klipper rejects (status `unavailable`) moves on to the next variant. The
 * variant that worked is remembered per method, so later starts go straight to it and do not
 * provoke an error in the Klipper log every time. When every variant is rejected the
 * caller sees `unavailable` once.
 *
 * Returns a cancel function that releases every attempt.
 */

export type StreamState = 'connecting' | 'live' | 'unavailable';

/** Index of the variant that last worked, per method. */
const working = new Map<string, number>();

/** Forgets the remembered variants (tests). */
export function resetStreamKeys(): void {
  working.clear();
}

export function openStream(
  handle: MoonrakerProxyHandle,
  method: string,
  variants: ReadonlyArray<Record<string, unknown>>,
  onData: (params: unknown) => void,
  onStatus?: (state: StreamState) => void,
): () => void {
  // the remembered variant goes first, the others follow in their documented order
  const first = working.get(method) ?? 0;
  const order = [first, ...variants.map((_, i) => i).filter((i) => i !== first)];

  const cancels: Array<(() => void) | undefined> = [];
  let stopped = false;
  // only the newest attempt may report: a rejected one must not override its successor
  let attempt = 0;

  const open = (n: number): void => {
    const mine = ++attempt;
    cancels.push(
      handle.klippyStream(method, variants[order[n]!]!, onData, (state) => {
        if (stopped || mine !== attempt) return;
        if (state === 'unavailable' && n + 1 < order.length) {
          open(n + 1);
          return;
        }
        if (state === 'live') working.set(method, order[n]!);
        onStatus?.(state);
      }),
    );
  };
  open(0);

  return () => {
    stopped = true;
    for (const c of cancels) c?.();
    cancels.length = 0;
  };
}
