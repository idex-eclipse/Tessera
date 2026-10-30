import { describe, expect, it } from 'vitest';

import { HELP_WIDTH, placePopup } from '../help-position';

const vp = { w: 1280, h: 800 };
const size = { w: HELP_WIDTH, h: 360 };

describe('placePopup', () => {
  it('по умолчанию раскрывается вниз под якорем', () => {
    const p = placePopup({ left: 100, top: 100, bottom: 120 }, size, vp);
    expect(p.left).toBe(100);
    expect(p.top).toBe(124);
    expect(p.bottom).toBeNull();
    expect(p.maxHeight).toBe(800 - 120 - 4 - 8);
  });

  it('у нижнего края разворачивается вверх, bottom считается от низа окна', () => {
    const p = placePopup({ left: 100, top: 700, bottom: 720 }, size, vp);
    expect(p.top).toBeNull();
    expect(p.bottom).toBe(800 - 700 + 4);
    expect(p.maxHeight).toBe(700 - 4 - 8);
  });

  it('если внизу места больше, чем вверху, остаётся внизу даже при нехватке', () => {
    const p = placePopup({ left: 0, top: 100, bottom: 120 }, size, { w: 1280, h: 300 });
    expect(p.top).toBe(124);
    expect(p.maxHeight).toBeGreaterThanOrEqual(140);
  });

  it('зажимает по горизонтали с отступом', () => {
    expect(placePopup({ left: -400, top: 0, bottom: 10 }, size, vp).left).toBe(8);
    expect(placePopup({ left: 1200, top: 0, bottom: 10 }, size, vp).left).toBe(1280 - HELP_WIDTH - 8);
  });

  it('на очень узком окне ширина не превышает окно', () => {
    const p = placePopup({ left: 200, top: 0, bottom: 10 }, size, { w: 360, h: 640 });
    expect(p.left).toBe(8);
  });
});
