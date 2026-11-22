import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

import { startMockDev } from './dev.js';

/** Asserts that neither the page nor the popover widens the viewport. */
async function assertNoOverflow(page: Page, popover?: import('playwright').Locator): Promise<void> {
  const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(width.document <= width.viewport + 1, `page overflow: ${width.document} > ${width.viewport}`);
  if (popover) {
    const box = await popover.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width.viewport + 1, 'popover stays inside the viewport');
  }
}

/**
 * Clicks at the button's currently visible spot without scrolling it into view first
 * (locator.click() would), like a real user clicking a half-clipped panel at the card's edge.
 */
async function clickWithoutAutoScroll(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const btn = document.querySelector('.fleet-card .fleet-leds-button');
    const body = btn?.closest('.fleet-card-body');
    if (!btn || !body) return null;
    const b = btn.getBoundingClientRect();
    const c = body.getBoundingClientRect();
    const top = Math.max(b.top, c.top) + 2;
    const bottom = Math.min(b.bottom, c.bottom) - 2;
    return { x: (b.left + b.right) / 2, y: (top + bottom) / 2 };
  });
  assert.ok(point, 'Lights button not found');
  await page.mouse.click(point.x, point.y);
}

async function cardBodyScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const led = document.querySelector('mpu-core-widgets-fleet-leds');
    return led?.closest('.fleet-card-body')?.scrollTop ?? -1;
  });
}

/** Exercises the Lights fleet panel: popover, LED controls, the lit-bulb indicator and scroll stability. */
async function main(): Promise<void> {
  const app = await startMockDev({ uiPort: 5189, readyPort: 17191, errorPort: 17192 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${app.url}/#/p/mock-ready`);
    await page.getByRole('button', { name: 'Fleet Overview' }).click();
    const cards = page.locator('.fleet-card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);

    const readyCard = cards.first();
    const button = readyCard.locator('.fleet-leds-button');
    await button.waitFor();
    // Everything starts off: the outline bulb, no lit highlight.
    const initialClass = await button.getAttribute('class');
    assert.equal(initialClass?.includes('lit'), false);

    await button.click();
    const popover = page.locator('.leds-popover');
    await popover.waitFor();
    await assertNoOverflow(page, popover);
    await popover.getByText('Case', { exact: true }).waitFor();
    await popover.getByText('Chamber', { exact: true }).waitFor();
    // The RGBW chamber LED exposes the white channel; the plain neopixel does not.
    assert.equal(await popover.getByText('White', { exact: true }).count(), 1);
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-leds.png') });

    // Toggling power sends SET_LED to the card's printer and lights the button icon.
    await popover.locator('.led', { hasText: 'Case' }).locator('.power').click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('.fleet-card .fleet-leds-button');
      return btn?.classList.contains('lit');
    });
    const colorData = app.session.ready.objects['neopixel case']?.color_data as number[][];
    assert.ok(colorData.some((px) => px.some((v) => v > 0)), 'mock recorded the SET_LED color');

    // A click on a half-clipped button must not scroll the card body (no focus jerk).
    await page.locator('.leds-popover-backdrop').click({ position: { x: 5, y: 5 } });
    await popover.waitFor({ state: 'detached' });
    await page.evaluate(() => {
      const btn = document.querySelector('.fleet-card .fleet-leds-button');
      const body = btn?.closest('.fleet-card-body') as HTMLElement | null;
      if (!btn || !body) return;
      const b = btn.getBoundingClientRect();
      body.scrollTop += b.top - body.getBoundingClientRect().bottom + 22;
    });
    const scrollBefore = await cardBodyScrollTop(page);
    await clickWithoutAutoScroll(page);
    await popover.waitFor();
    assert.equal(await cardBodyScrollTop(page), scrollBefore, 'clicking a half-clipped button must not scroll the card body');
    await assertNoOverflow(page, popover);
    await page.close();
    console.log('Fleet leds browser checks passed');
  } finally {
    await browser.close();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('[fleet-leds-browser]', error);
  process.exitCode = 1;
});
