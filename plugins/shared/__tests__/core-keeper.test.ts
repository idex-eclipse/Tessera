import { describe, expect, it } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createCoreKeeper } from '../core-keeper/core-keeper';

const api = {} as PluginApi;

function makeKeeper(cap = 2) {
  const destroyed: string[] = [];
  const keeper = createCoreKeeper({
    cap,
    create: (pid) => ({ pid, destroy: () => void destroyed.push(pid) }),
  });
  return { keeper, destroyed };
}

describe('createCoreKeeper', () => {
  it('creates a core once per printer and returns the same instance', () => {
    const { keeper } = makeKeeper();
    const a = keeper.acquire('p1', api);
    expect(keeper.acquire('p1', api)).toBe(a);
    expect(keeper.get('p1', api)).toBe(a);
    expect(keeper.size).toBe(1);
  });

  it('keeps an idle core alive until the cap is exceeded, then evicts the oldest idle one', () => {
    const { keeper, destroyed } = makeKeeper(2);
    keeper.acquire('p1', api);
    keeper.release('p1');
    keeper.acquire('p2', api);
    keeper.release('p2');
    expect(destroyed).toEqual([]); // two idle cores fit into the cap

    keeper.acquire('p3', api); // third core: the least recently used idle one goes
    expect(destroyed).toEqual(['p1']);
  });

  it('never evicts a core that is still held', () => {
    const { keeper, destroyed } = makeKeeper(1);
    keeper.acquire('p1', api);
    keeper.acquire('p2', api); // over the cap but nothing is idle: exceeded temporarily
    expect(destroyed).toEqual([]);
    keeper.release('p1');
    expect(destroyed).toEqual(['p1']);
  });

  it('drop destroys exactly once', () => {
    const { keeper, destroyed } = makeKeeper();
    keeper.acquire('p1', api);
    keeper.drop('p1');
    keeper.drop('p1');
    expect(destroyed).toEqual(['p1']);
    expect(keeper.size).toBe(0);
  });

  it('prune destroys idle cores of printers that are gone, never held ones', () => {
    const { keeper, destroyed } = makeKeeper(4);
    keeper.acquire('gone-idle', api);
    keeper.release('gone-idle');
    keeper.acquire('gone-held', api);
    keeper.acquire('alive', api);
    keeper.prune(['alive']);
    expect(destroyed).toEqual(['gone-idle']);
  });

  it('a failing destroy is contained and the core is still removed', () => {
    const keeper = createCoreKeeper({
      create: () => ({
        destroy: () => {
          throw new Error('boom');
        },
      }),
    });
    keeper.acquire('p1', api);
    const err = console.error;
    console.error = () => {};
    try {
      keeper.drop('p1');
    } finally {
      console.error = err;
    }
    expect(keeper.size).toBe(0);
  });
});
