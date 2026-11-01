import { describe, expect, it } from 'vitest';

import { moveInStack, overlaps, setHeight, settle, stackLayout } from '../layout-utils';

const item = (instanceId: string, x: number, y: number, w: number, h: number) => ({ instanceId, x, y, w, h });

describe('settle', () => {
  it('pushes overlapped items down, chaining', () => {
    const out = settle([item('a', 0, 0, 6, 4), item('b', 0, 2, 6, 3), item('c', 0, 5, 6, 2)], 'a');
    expect(out.find((i) => i.instanceId === 'b')!.y).toBe(4);
    expect(out.find((i) => i.instanceId === 'c')!.y).toBe(7);
  });

  it('does not mutate the input', () => {
    const input = [item('a', 0, 0, 6, 4), item('b', 0, 2, 6, 3)];
    settle(input, 'a');
    expect(input[1]!.y).toBe(2);
  });
});

describe('stackLayout', () => {
  it('orders by y then x and packs into one column', () => {
    const out = stackLayout([item('b', 6, 0, 6, 3), item('c', 0, 4, 12, 2), item('a', 0, 0, 6, 5)]);
    expect(out.map((i) => i.instanceId)).toEqual(['a', 'b', 'c']);
    expect(out.map((i) => i.y)).toEqual([0, 5, 8]);
    expect(out.every((i) => i.x === 0 && i.w === 12)).toBe(true);
  });
});

describe('moveInStack', () => {
  const base = [item('a', 0, 0, 6, 2), item('b', 6, 0, 6, 3), item('c', 0, 3, 12, 2)];

  it('moves an item down and repacks', () => {
    const out = moveInStack(base, 'a', 1);
    expect(out.map((i) => i.instanceId)).toEqual(['b', 'a', 'c']);
    expect(out.map((i) => i.y)).toEqual([0, 3, 5]);
  });

  it('moves an item up', () => {
    expect(moveInStack(base, 'c', -1).map((i) => i.instanceId)).toEqual(['a', 'c', 'b']);
  });

  it('keeps the order at the edges', () => {
    expect(moveInStack(base, 'a', -1).map((i) => i.instanceId)).toEqual(['a', 'b', 'c']);
    expect(moveInStack(base, 'c', 1).map((i) => i.instanceId)).toEqual(['a', 'b', 'c']);
  });
});

describe('setHeight', () => {
  const mobileOrder = (items: ReturnType<typeof item>[]) =>
    [...items].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.instanceId);
  const anyOverlap = (items: ReturnType<typeof item>[]) =>
    items.some((a, n) => items.slice(n + 1).some((b) => overlaps(a, b)));

  // A и B рядом, под ними C и D: settle сдвинул бы только C, и D оказался бы раньше него
  const twoColumns = [item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 4), item('c', 0, 4, 6, 4), item('d', 6, 4, 6, 4)];

  it('growing keeps the mobile order and creates no overlaps', () => {
    const out = setHeight(twoColumns, 'a', 7, 2, 16);
    expect(mobileOrder(out)).toEqual(['a', 'b', 'c', 'd']);
    expect(anyOverlap(out)).toBe(false);
    expect(out.find((i) => i.instanceId === 'c')!.y).toBe(7);
    expect(out.find((i) => i.instanceId === 'd')!.y).toBe(7);
  });

  it('leaves a widget beside the growing one in place', () => {
    expect(setHeight(twoColumns, 'a', 7, 2, 16).find((i) => i.instanceId === 'b')!.y).toBe(0);
  });

  it('shrinking changes only the height', () => {
    const out = setHeight(twoColumns, 'a', 2, 2, 16);
    expect(out[0]!.h).toBe(2);
    expect(out.slice(1)).toEqual(twoColumns.slice(1));
  });

  it('clamps to the range', () => {
    expect(setHeight(twoColumns, 'a', 99, 2, 16)[0]!.h).toBe(16);
    expect(setHeight(twoColumns, 'a', 0, 2, 16)[0]!.h).toBe(2);
  });

  it('does not mutate the input and ignores an unknown id', () => {
    setHeight(twoColumns, 'a', 7, 2, 16);
    expect(twoColumns[0]!.h).toBe(4);
    expect(setHeight(twoColumns, 'nope', 7, 2, 16)).toEqual(twoColumns);
  });
});
