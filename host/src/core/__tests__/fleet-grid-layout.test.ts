import { describe, expect, it } from 'vitest';

import { fleetPanelHeightPixels, mergeFleetGridLayout, projectFleetGridLayout, resizeFleetPanel, settleFleetGridLayout } from '../fleet-grid-layout.ts';

/** The shared card template must survive both plugin arrivals and old settings. */
describe('fleet card grid layout', () => {
  const panels = [
    { pluginId: 'system', contributionId: 'status' },
    { pluginId: 'widgets', contributionId: 'temperature' },
    { pluginId: 'widgets', contributionId: 'camera' },
  ];

  it('keeps old order as full-width rows and places new panels after it', () => {
    const stored = [
      { ...panels[1]!, visible: true, x: 0, y: 0, w: 12, h: 4 },
      { ...panels[0]!, visible: false, x: 0, y: 4, w: 12, h: 4 },
    ];
    const layout = mergeFleetGridLayout(panels, stored, true);
    expect(layout.map(({ contributionId, y, visible }) => ({ contributionId, y, visible }))).toEqual([
      { contributionId: 'temperature', y: 0, visible: true },
      { contributionId: 'status', y: 4, visible: false },
      { contributionId: 'camera', y: 8, visible: true },
    ]);
  });

  it('repairs overlapping or out-of-bounds saved panels', () => {
    const layout = mergeFleetGridLayout(panels.slice(0, 2), [
      { ...panels[0]!, visible: true, x: 8, y: 0, w: 12, h: 4 },
      { ...panels[1]!, visible: true, x: 0, y: 0, w: 12, h: 4 },
    ], true);
    expect(layout[0]).toMatchObject({ x: 0, y: 0, w: 12 });
    expect(layout[1]).toMatchObject({ x: 0, y: 4 });
  });

  it('pushes colliding neighbors below the moved panel without losing identity', () => {
    const layout = mergeFleetGridLayout(panels.slice(0, 2), [], false);
    const moved = layout.map((item) => item.contributionId === 'temperature' ? { ...item, y: 0 } : item);
    const settled = settleFleetGridLayout(moved, 'widgets:temperature');
    expect(settled.find((item) => item.contributionId === 'status')?.y).toBe(4);
    expect(settled.find((item) => item.contributionId === 'temperature')?.y).toBe(0);
  });

  it('fills the gap left when a panel moves down the card', () => {
    const layout = mergeFleetGridLayout(panels.slice(0, 2), [], false);
    const moved = layout.map((item) => item.contributionId === 'status' ? { ...item, y: 4 } : item);
    const settled = settleFleetGridLayout(moved, 'system:status');
    expect(settled.find((item) => item.contributionId === 'temperature')?.y).toBe(0);
    expect(settled.find((item) => item.contributionId === 'status')?.y).toBe(4);
  });

  it('resizes from all four sides and allows a one-row panel', () => {
    const item = { ...panels[0]!, visible: true, x: 2, y: 3, w: 8, h: 3 };
    expect(resizeFleetPanel(item, 'n', 0, 2)).toMatchObject({ y: 5, h: 1 });
    expect(resizeFleetPanel(item, 's', 0, -2)).toMatchObject({ y: 3, h: 1 });
    expect(resizeFleetPanel(item, 'w', 2, 0)).toMatchObject({ x: 4, w: 6 });
    expect(resizeFleetPanel(item, 'e', -2, 0)).toMatchObject({ x: 2, w: 6 });
    expect(resizeFleetPanel(item, 'nw', -2, -2)).toMatchObject({ x: 0, y: 1, w: 10, h: 5 });
  });

  it('projects content heights per printer without changing saved row counts', () => {
    const saved = mergeFleetGridLayout(panels, [], false);
    saved[0]!.autoHeight = true;
    saved[1]!.autoHeight = true;
    const first = projectFleetGridLayout(saved, { 'system:status': 50, 'widgets:temperature': 110 });
    expect(first.map(({ topPx, heightPx }) => ({ topPx, heightPx }))).toEqual([
      { topPx: 0, heightPx: 50 }, { topPx: 54, heightPx: 110 }, { topPx: 168, heightPx: 188 },
    ]);
    expect(projectFleetGridLayout(saved, { 'system:status': 200 })[1]).toMatchObject({ topPx: 204, heightPx: 188 });
    expect(saved.map(({ y, h }) => ({ y, h }))).toEqual([
      { y: 0, h: 4 }, { y: 4, h: 4 }, { y: 8, h: 4 },
    ]);
  });

  it('keeps measured pixel heights rather than rounding to a grid row', () => {
    expect(fleetPanelHeightPixels(1)).toBe(44);
    expect(fleetPanelHeightPixels(4)).toBe(188);
    const layout = [{ ...panels[0]!, visible: true, x: 0, y: 0, w: 12, h: 4, autoHeight: true }];
    expect(projectFleetGridLayout(layout, { 'system:status': 45 })[0]).toMatchObject({ heightPx: 45 });
    expect(resizeFleetPanel({ ...panels[0]!, visible: true, x: 0, y: 0, w: 12, h: 4, autoHeight: true },
      'e', -1, 0).autoHeight).toBe(false);
  });
});
