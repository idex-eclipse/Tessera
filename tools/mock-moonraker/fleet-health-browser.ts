import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

import { startMockDev } from './dev.js';

/** Assert that neither the page nor the popover widens the viewport. */
async function assertNoOverflow(page: Page, popover?: import('playwright').Locator): Promise<void> {
  const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(width.document <= width.viewport + 1, `page overflow: ${width.document} > ${width.viewport}`);
  if (popover) {
    const box = await popover.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width.viewport + 1, 'popover stays inside the viewport');
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Exercise the Machine Health fleet indicator, its popover, deep link, narrow widths and RTL. */
async function main(): Promise<void> {
  const app = await startMockDev({ uiPort: 5186, readyPort: 17186, errorPort: 17187 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${app.url}/#/p/mock-ready`);
    await page.getByRole('button', { name: 'Fleet Overview' }).click();
    const cards = page.locator('.fleet-card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);

    const readyCard = cards.first();
    const indicator = readyCard.locator('.fh-indicator');
    await indicator.waitFor();
    // cpu_temp arrives with the mock's one-second proc-stats tick (there is no mcu object in the mock)
    await indicator.getByText('OK', { exact: true }).waitFor();
    assert.match(await indicator.innerText(), /OK/i, 'healthy printer shows a green OK chip');

    await indicator.click();
    let popover = page.getByRole('dialog', { name: 'Machine Health' });
    await popover.waitFor();
    await assertNoOverflow(page, popover);
    await popover.getByText('All systems OK').waitFor();
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-health-ok.png') });

    // The popover button deep-links this card's printer to Machine → Monitoring.
    await popover.getByRole('button', { name: 'Machine → Monitoring' }).click();
    await waitFor(() => page.url().includes('machine?section=monitoring'), 'deep link did not open Machine → Monitoring');
    // closing fleet is a reactive effect on the hash change, not synchronous with the click
    await page.locator('.fleet-drawer').waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-health-monitoring.png') });

    // A throttling event turns the indicator red and lists the problem.
    await page.goto(`${app.url}/#/p/mock-ready`);
    await page.getByRole('button', { name: 'Fleet Overview' }).click();
    await cards.first().waitFor();
    app.session.ready.notify('notify_cpu_throttled', { bits: 1 });
    await indicator.getByText('Problem', { exact: true }).waitFor();
    await indicator.click();
    popover = page.getByRole('dialog', { name: 'Machine Health' });
    await popover.waitFor();
    await popover.getByText('Under-voltage').waitFor();
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-health-crit.png') });
    // Escape would close the whole fleet drawer (host keydown), so dismiss via the popover backdrop
    await page.locator('.fh-backdrop').click();

    // The Klipper-error card has no health data: grey "No data", still opens the popover.
    const errorIndicator = cards.nth(1).locator('.fh-indicator');
    await errorIndicator.getByText('No data', { exact: true }).waitFor();
    await errorIndicator.click();
    popover = page.getByRole('dialog', { name: 'Machine Health' });
    await popover.waitFor();
    await assertNoOverflow(page, popover);
    await page.locator('.fh-backdrop').click();

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 840 });
      for (const direction of ['ltr', 'rtl']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('dir', value), direction);
        await indicator.scrollIntoViewIfNeeded();
        await indicator.click();
        popover = page.getByRole('dialog', { name: 'Machine Health' });
        await popover.waitFor();
        await assertNoOverflow(page, popover);
        await page.screenshot({ path: join(tmpdir(), `tessera-fleet-health-${width}-${direction}.png`) });
        await page.locator('.fh-backdrop').click();
      }
    }

    await page.close();
    console.log('Fleet health browser checks passed');
  } finally {
    await browser.close();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('[fleet-health-browser]', error);
  process.exitCode = 1;
});
