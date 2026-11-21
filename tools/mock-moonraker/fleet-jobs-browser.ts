import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';

import { startMockDev } from './dev.js';

/** Assert that neither the page nor the active fleet dialog widens the viewport. */
async function assertNoOverflow(page: Page, dialog?: Locator): Promise<void> {
  const pageWidth = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(pageWidth.document <= pageWidth.viewport + 1, `page overflow: ${pageWidth.document} > ${pageWidth.viewport}`);
  if (dialog) {
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= pageWidth.viewport + 1, 'dialog stays inside the viewport');
  }
}

/** Poll in-memory mock state without coupling browser assertions to transport timing. */
async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Exercise both fleet launchers, fixed-printer actions, responsive sizes and RTL in Chromium. */
async function main(): Promise<void> {
  const app = await startMockDev({ uiPort: 5184, readyPort: 17184, errorPort: 17185 });
  const browser = await chromium.launch({ headless: true });
  try {
    const longName = 'a-very-long-printer-job-name-that-must-ellipsis-without-page-overflow.gcode';
    app.session.error.putFile(`gcodes/${longName}`, Buffer.from('; mock long file\nG28\n'));

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${app.url}/#/p/mock-ready`);
    await page.getByRole('button', { name: 'Fleet Overview' }).click();
    const cards = page.locator('.fleet-card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);

    const errorCard = cards.nth(1);
    const jobs = errorCard.getByRole('button', { name: 'Jobs', exact: true });
    const queue = errorCard.getByRole('button', { name: 'Job queue', exact: true });
    await jobs.scrollIntoViewIfNeeded();
    assert.equal(await jobs.isVisible(), true);
    assert.equal(await queue.isVisible(), true);
    const jobsBox = await jobs.boundingBox();
    const queueBox = await queue.boundingBox();
    assert.ok(jobsBox && queueBox && Math.abs(jobsBox.y - queueBox.y) < 3, '6×1 launchers share a row');

    await jobs.click();
    let dialog = page.getByRole('dialog', { name: 'Jobs — Mock Klipper Error' });
    await dialog.waitFor();
    await assertNoOverflow(page, dialog);
    assert.equal(await dialog.getByTitle('Refresh').isVisible(), true);
    assert.equal(await dialog.getByTitle('Add').isVisible(), true);
    assert.equal(await dialog.getByTitle('Columns').isVisible(), true);
    await dialog.getByText(longName).waitFor();

    // Queue a file from the non-active card and verify only that mock printer changed.
    const row = dialog.locator('tr').filter({ hasText: 'demo-bracket.gcode' }).first();
    await row.click({ button: 'right' });
    await page.getByText('Add to queue', { exact: true }).click();
    await waitUntil(() => app.session.error.queuedJobs.length === 1, 'target queue did not receive the file');
    assert.equal(app.session.ready.queuedJobs.length, 0);
    assert.deepEqual(app.session.error.queuedJobs.map((job) => job.filename), ['demo-bracket.gcode']);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    await queue.click();
    dialog = page.getByRole('dialog', { name: 'Job Queue — Mock Klipper Error' });
    await dialog.waitFor();
    await dialog.getByText('demo-bracket.gcode').waitFor();
    await dialog.getByRole('button', { name: /Pause/ }).click();
    await waitUntil(() => app.session.error.queueState === 'paused', 'target queue did not pause');
    assert.equal(app.session.error.queueState, 'paused');
    assert.equal(app.session.ready.queueState, 'ready');

    // Nested confirmation must remain above the fleet shell and clear only the target queue.
    await dialog.getByRole('button', { name: /Clear/ }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor();
    const shellZ = Number(await dialog.evaluate((element) => getComputedStyle(element).zIndex));
    const confirmZ = Number(await confirm.evaluate((element) => getComputedStyle(element).zIndex));
    assert.ok(confirmZ > shellZ);
    await confirm.getByRole('button', { name: 'Clear', exact: true }).click();
    await waitUntil(() => app.session.error.queuedJobs.length === 0, 'target queue did not clear');
    assert.equal(app.session.error.queuedJobs.length, 0);
    await page.keyboard.press('Escape');

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 840 });
      for (const direction of ['ltr', 'rtl']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('dir', value), direction);
        await jobs.scrollIntoViewIfNeeded();
        await jobs.click();
        dialog = page.getByRole('dialog', { name: 'Jobs — Mock Klipper Error' });
        await dialog.waitFor();
        await assertNoOverflow(page, dialog);
        // Long localized titles must truncate inside the header rather than widen the dialog.
        await dialog.locator('h2').evaluate((element) => { element.textContent += ' — an exceptionally long printer name for overflow testing'; });
        await assertNoOverflow(page, dialog);
        await page.screenshot({ path: join(tmpdir(), `tessera-fleet-jobs-${width}-${direction}.png`) });
        await page.keyboard.press('Escape');
      }
    }

    await page.close();
    console.log('Fleet Jobs and Job Queue browser checks passed');
  } finally {
    await browser.close();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('[fleet-jobs-browser]', error);
  process.exitCode = 1;
});
