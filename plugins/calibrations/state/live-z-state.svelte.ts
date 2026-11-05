/**
 * Machine-state LiveZ: виджет и чип делят одну машинку состояний (per-printer
 * внутри ядра calibrations).
 * baseline — probe offset НА ДИСКЕ на момент последнего (ре)старта Klipper;
 * staged   — накопленный запечённый (Z_OFFSET_APPLY_PROBE) offset с тех пор.
 * Save config показываем ТОЛЬКО когда staged отличается от baseline.
 */
export interface LiveZState {
  baseline: number | null;
  staged: number | null;
  hasUnsavedApply: boolean;
}

export function initialLiveZState(): LiveZState {
  return { baseline: null, staged: null, hasUnsavedApply: false };
}