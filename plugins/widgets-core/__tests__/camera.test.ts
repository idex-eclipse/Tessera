import { describe, expect, it } from 'vitest';

import {
  createFpsMeter,
  cycleIndex,
  extractWebcams,
  swipeDirection,
} from '../camera/camera-utils';

describe('swipeDirection', () => {
  it('LTR: swipe left = next, swipe right = prev', () => {
    expect(swipeDirection(-80, 5, 200, false)).toBe('next');
    expect(swipeDirection(80, 5, 200, false)).toBe('prev');
  });

  it('RTL mirrors the direction', () => {
    expect(swipeDirection(-80, 5, 200, true)).toBe('prev');
    expect(swipeDirection(80, 5, 200, true)).toBe('next');
  });

  it('ignores short, diagonal/vertical and slow gestures', () => {
    expect(swipeDirection(-20, 0, 100, false)).toBeNull();
    expect(swipeDirection(-60, 60, 100, false)).toBeNull();
    expect(swipeDirection(-10, 120, 100, false)).toBeNull();
    expect(swipeDirection(-100, 0, 2000, false)).toBeNull();
  });
});

describe('createFpsMeter', () => {
  it('is null until two frames, then measures frames per second', () => {
    let t = 0;
    const m = createFpsMeter(() => t);
    expect(m.fps()).toBeNull();
    m.tick();
    expect(m.fps()).toBeNull();
    for (let i = 0; i < 5; i++) {
      t += 100;
      m.tick();
    }
    expect(m.fps()).toBeCloseTo(10, 5);
  });

  it('forgets old frames and resets', () => {
    let t = 0;
    const m = createFpsMeter(() => t);
    m.tick();
    t = 100;
    m.tick();
    t = 5000;
    expect(m.fps()).toBeNull();
    m.tick();
    m.reset();
    expect(m.fps()).toBeNull();
  });
});

describe('cycleIndex', () => {
  it('wraps around both edges', () => {
    expect(cycleIndex(2, 1, 3)).toBe(0);
    expect(cycleIndex(0, -1, 3)).toBe(2);
    expect(cycleIndex(1, 1, 3)).toBe(2);
  });

  it('single and empty lists stay at 0', () => {
    expect(cycleIndex(0, 1, 1)).toBe(0);
    expect(cycleIndex(0, 1, 0)).toBe(0);
  });
});

describe('extractWebcams', () => {
  const cams = [{ name: 'a' }, { name: 'b' }];

  it('unwraps the notify_webcams_changed params array', () => {
    expect(extractWebcams([{ webcams: cams }])).toEqual(cams);
  });

  it('accepts a server.webcams.list result and a bare list', () => {
    expect(extractWebcams({ webcams: cams })).toEqual(cams);
    expect(extractWebcams(cams)).toEqual(cams);
  });

  it('returns null for unknown shapes', () => {
    expect(extractWebcams(null)).toBeNull();
    expect(extractWebcams({})).toBeNull();
    expect(extractWebcams('x')).toBeNull();
  });
});
