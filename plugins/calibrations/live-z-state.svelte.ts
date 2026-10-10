/**
 * Machine-state LiveZ: виджет и чип делят одну машинку состояний.
 * baseline — probe offset НА ДИСКЕ на момент последнего (ре)старта Klipper;
 * staged   — накопленный запечённый (Z_OFFSET_APPLY_PROBE) offset с тех пор.
 * Save config показываем ТОЛЬКО когда staged отличается от baseline:
 * обратный apply гасит pending — флаг «был apply» такой семантики не даёт.
 */
export const livez = $state({
  baseline: null as number | null,
  staged: null as number | null,
});

export function resetLivezState(): void {
  livez.baseline = null;
  livez.staged = null;
}