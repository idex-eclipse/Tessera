import type { FleetPanelLayoutItem } from './types.ts';
import { findFreeSpot, overlaps, settle } from './layout-utils.ts';

/** Fleet cards share a compact 12-column template across all printers. */
export const FLEET_GRID_COLUMNS = 12;
// Width 4 (a third of the card) is enough for compact one-row panels
// (health indicator, Jobs, Job Queue); resize clamps and saved-layout repair use this floor.
export const FLEET_MIN_WIDTH = 4;
export const FLEET_MIN_HEIGHT = 1;
export const FLEET_MAX_HEIGHT = 16;
export const FLEET_DEFAULT_HEIGHT = 4;
/** Saved rows remain 44px tall even though rendered rows use one-pixel tracks. */
export const FLEET_ROW_HEIGHT = 44;
/** Match the fleet card's --space-xs gap when projecting saved coordinates. */
export const FLEET_ROW_GAP = 4;
export type FleetResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Rendered geometry keeps exact content height while the saved layout stays in grid cells. */
export type FleetPanelDisplayItem = FleetPanelLayoutItem & { topPx: number; heightPx: number };

/** Resize around the opposite side, using logical horizontal coordinates for RTL. */
export function resizeFleetPanel(item: FleetPanelLayoutItem, dir: FleetResizeDir, dx: number, dy: number): FleetPanelLayoutItem {
  let { x, y, w, h } = item;
  if (dir.includes('e')) w = Math.min(FLEET_GRID_COLUMNS - x, Math.max(FLEET_MIN_WIDTH, w + dx));
  else if (dir.includes('w')) {
    const delta = Math.min(w - FLEET_MIN_WIDTH, Math.max(-x, dx));
    x += delta;
    w -= delta;
  }
  if (dir.includes('s')) h = Math.min(FLEET_MAX_HEIGHT, Math.max(FLEET_MIN_HEIGHT, h + dy));
  else if (dir.includes('n')) {
    const delta = Math.min(h - FLEET_MIN_HEIGHT, Math.max(-y, dy));
    y += delta;
    h -= delta;
  }
  return { ...item, x, y, w, h, autoHeight: w === FLEET_GRID_COLUMNS && item.autoHeight === true };
}

/** Stable identity survives plugin registration changes and DOM-preserving moves. */
export function fleetPanelKey(item: Pick<FleetPanelLayoutItem, 'pluginId' | 'contributionId'>): string {
  return `${item.pluginId}:${item.contributionId}`;
}

/** Reconcile saved cards with the registry without dropping a user's placement. */
export function mergeFleetGridLayout(
  registered: Array<Pick<FleetPanelLayoutItem, 'pluginId' | 'contributionId'> & { defaultSize?: { w: number; h: number } }>,
  stored: FleetPanelLayoutItem[],
  customized: boolean,
): FleetPanelLayoutItem[] {
  const keys = new Set(registered.map(fleetPanelKey));
  const result: FleetPanelLayoutItem[] = [];
  const saved = customized ? stored.filter((item) => keys.has(fleetPanelKey(item))) : [];
  const seen = new Set<string>();

  for (const item of saved) {
    const key = fleetPanelKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const w = Math.max(FLEET_MIN_WIDTH, Math.min(FLEET_GRID_COLUMNS, item.w));
    const h = Math.max(FLEET_MIN_HEIGHT, Math.min(FLEET_MAX_HEIGHT, item.h));
    const x = Math.max(0, Math.min(FLEET_GRID_COLUMNS - w, item.x));
    const y = Math.max(0, item.y);
    const wanted = { x, y, w, h };
    // An imported or corrupted layout may overlap; put only that item in a free cell.
    const position = result.some((other) => overlaps(other, wanted))
      ? findFreeSpot(result, w, h)
      : { x, y };
    result.push({ ...item, ...position, w, h, autoHeight: w === FLEET_GRID_COLUMNS && item.autoHeight === true });
  }

  for (const item of registered) {
    const key = fleetPanelKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    // Manifest defaults affect only newly registered or explicitly reset panels; saved geometry wins above.
    const w = Math.max(FLEET_MIN_WIDTH, Math.min(FLEET_GRID_COLUMNS, item.defaultSize?.w ?? FLEET_GRID_COLUMNS));
    const h = Math.max(FLEET_MIN_HEIGHT, Math.min(FLEET_MAX_HEIGHT, item.defaultSize?.h ?? FLEET_DEFAULT_HEIGHT));
    const position = findFreeSpot(result, w, h);
    const { defaultSize: _defaultSize, ...identity } = item;
    result.push({ ...identity, ...position, w, h, visible: true });
  }
  return result;
}

/** Fixed cell height includes internal row gaps, leaving one gap between panels. */
export function fleetPanelHeightPixels(rows: number): number {
  return rows * (FLEET_ROW_HEIGHT + FLEET_ROW_GAP) - FLEET_ROW_GAP;
}

/** Project each full-width auto panel's pixel height without changing saved grid coordinates. */
export function projectFleetGridLayout(
  items: FleetPanelLayoutItem[],
  measuredHeights: Readonly<Record<string, number>>,
): FleetPanelDisplayItem[] {
  const fullWidth = items
    .filter((item) => item.visible && item.autoHeight && item.w === FLEET_GRID_COLUMNS)
    .sort((a, b) => a.y - b.y);
  const heightFor = (item: FleetPanelLayoutItem): number => {
    const fixed = fleetPanelHeightPixels(item.h);
    const measured = measuredHeights[fleetPanelKey(item)];
    return item.autoHeight && item.w === FLEET_GRID_COLUMNS && measured !== undefined && Number.isFinite(measured)
      ? Math.max(FLEET_ROW_HEIGHT, Math.ceil(measured))
      : fixed;
  };
  return items.map((item) => {
    const shift = fullWidth
      .filter((above) => above.y + above.h <= item.y)
      .reduce((sum, above) => sum + heightFor(above) - fleetPanelHeightPixels(above.h), 0);
    return {
      ...item,
      topPx: Math.max(0, item.y * (FLEET_ROW_HEIGHT + FLEET_ROW_GAP) + shift),
      heightPx: heightFor(item),
    };
  });
}

/** Resolve collisions after a drag while preserving each panel's stable key. */
export function settleFleetGridLayout(items: FleetPanelLayoutItem[], key: string): FleetPanelLayoutItem[] {
  const settled = settle(items.map((item) => ({ ...item, instanceId: fleetPanelKey(item) })), key);
  const active = settled.find((item) => item.instanceId === key);
  if (!active) return items;

  // A card has a fixed viewport: fill holes left by a moved panel so the first
  // visible cells do not become empty while useful content is pushed offscreen.
  const placed = [active];
  for (const item of settled.filter((candidate) => candidate.instanceId !== key)
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = 0;
    while (placed.some((other) => overlaps(other, { ...item, y }))) y++;
    placed.push({ ...item, y });
  }
  const byKey = new Map(placed.map((item) => [item.instanceId, item]));
  return settled.map((item) => {
    const { instanceId: _instanceId, ...panel } = byKey.get(item.instanceId)!;
    return panel;
  });
}
