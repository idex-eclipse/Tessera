import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { startMockDev } from './dev.js';

/** Waits for a visible page and its Moonraker connection without relying on arbitrary long sleeps. */
async function open(page: Page, base: string, hash: string, marker: string): Promise<void> {
  await page.goto(`${base}/${hash}`);
  await page.getByText(marker, { exact: true }).first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.waitForTimeout(150);
}

/** The UI sends requests asynchronously; poll the server state to assert their actual effect. */
async function eventually(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

/** Checks document width while allowing content inside tables to scroll within its own panel. */
async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1, `${label}: document ${widths.document}px exceeds viewport ${widths.viewport}px`);
}

/** Uses the same command field a person uses on the Console page. */
async function consoleCommand(page: Page, command: string): Promise<void> {
  const input = page.locator('input.console-input');
  await input.fill(command);
  await input.press('Escape');
  await input.press('Enter');
}

/** Exercises visible screens and verifies the resulting state through the shared mock engine. */
async function main(): Promise<void> {
  const app = await startMockDev();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page, app.url, '#/p/mock-ready', 'Mock Ready');
    await page.getByText('Bed camera', { exact: true }).first().waitFor();
    await page.getByText('Case Light', { exact: true }).first().waitFor();
    await eventually(() => app.session.ready.webcams.length === 1, 'seeded camera');
    await page.locator('img[alt="Bed camera"]').first().waitFor();
    await page.waitForFunction(() => [...document.images].some((image) => image.alt === 'Bed camera' && image.naturalWidth > 0));
    await page.getByTitle('Camera settings').first().click();
    await page.getByRole('button', { name: 'Add camera' }).last().click();
    await page.locator('.dlg').getByLabel('Name').fill('Nozzle camera');
    await page.locator('.dlg').getByRole('button', { name: 'Add camera' }).click();
    await eventually(() => app.session.ready.webcams.length === 2, 'camera added from UI');

    await open(page, app.url, '#/p/mock-ready/console', 'Console');
    await consoleCommand(page, 'M104 S210');
    await eventually(() => app.session.ready.objects.extruder?.target === 210, 'hotend target from Console');
    await consoleCommand(page, 'G1 X5 F1200');
    await eventually(() => (app.session.ready.objects.toolhead?.position as number[])[0] === 5, 'toolhead move');

    await open(page, app.url, '#/p/mock-ready/jobs', 'demo-bracket.gcode');
    assert.ok((await page.locator('body').innerText()).includes('Mock PETG'));
    await page.locator('tr.row-file').filter({ hasText: 'mock-cube.gcode' }).click();
    await page.getByRole('menuitem', { name: 'G-code preview' }).click();
    await page.waitForURL(/gcode-preview/);
    await page.getByText('mock-cube.gcode', { exact: false }).first().waitFor();
    await open(page, app.url, '#/p/mock-ready/jobs', 'mock-cube.gcode');
    await page.locator('tr.row-file').filter({ hasText: 'demo-bracket.gcode' }).click();
    await page.getByRole('menuitem', { name: 'Create copy' }).click();
    await eventually(() => app.session.ready.files.has('gcodes/demo-bracket_copy.gcode'), 'file copy');
    await page.locator('tr.row-file').filter({ hasText: 'mock-cube.gcode' }).click();
    await page.getByRole('menuitem', { name: 'Print', exact: true }).click();
    await eventually(() => app.session.ready.objects.print_stats?.state === 'printing', 'print start');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await eventually(() => app.session.ready.objects.print_stats?.state === 'paused', 'print pause');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await eventually(() => app.session.ready.objects.print_stats?.state === 'printing', 'print resume');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Cancel the current print?').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await eventually(() => app.session.ready.objects.print_stats?.state === 'cancelled', 'print cancel');

    await open(page, app.url, '#/p/mock-ready/history', 'History');
    await page.locator('tr.row-file').filter({ hasText: 'mock-cube.gcode' }).first().waitFor();
    await open(page, app.url, '#/p/mock-ready/calibrations', 'Saved Profiles');
    await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
    await eventually(() => app.session.ready.objects.bed_mesh?.profile_name === '', 'new bed mesh');
    await page.getByRole('tab', { name: 'Probe & Z Offset' }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await eventually(() => app.session.ready.objects.manual_probe?.is_active === true, 'manual Z session');
    await page.locator('.overlay-panel[role="dialog"] .step.down').first().click();
    await eventually(() => Number(app.session.ready.objects.manual_probe?.z_position) < 5, 'manual Z step');
    await page.locator('.overlay-panel[role="dialog"]').getByRole('button', { name: 'Accept' }).click();
    await eventually(() => app.session.ready.objects.manual_probe?.is_active === false, 'manual Z accept');
    await open(page, app.url, '#/p/mock-ready/config', 'printer.cfg');
    await open(page, app.url, '#/p/mock-ready/machine', 'Machine');
    await open(page, app.url, '#/settings/general', 'General');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

    // Reopen each built-in screen at three widths; RTL is checked on the dense screens.
    const routes = ['#/', '#/p/mock-ready/console', '#/p/mock-ready/jobs', '#/p/mock-ready/history',
      '#/p/mock-ready/gcode-preview', '#/p/mock-ready/calibrations', '#/p/mock-ready/config',
      '#/p/mock-ready/machine', '#/settings/general'];
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(`${app.url}/${route}`);
        await page.waitForTimeout(200);
        await assertNoPageOverflow(page, `${width}px ${route}`);
      }
    }
    await page.setViewportSize({ width: 768, height: 900 });
    for (const route of ['#/', '#/p/mock-ready/jobs', '#/p/mock-ready/calibrations', '#/settings/general']) {
      await page.goto(`${app.url}/${route}`);
      await page.locator('html').evaluate((element) => element.setAttribute('dir', 'rtl'));
      await page.waitForTimeout(150);
      await assertNoPageOverflow(page, `RTL ${route}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app.url, '#/p/mock-error', 'Mock Klipper configuration error');
    assert.equal(app.session.error.klippyState, 'error');
    await page.getByRole('button', { name: 'Restart Klipper' }).click();
    await eventually(() => app.session.error.klippyState === 'ready', 'Klipper recovery');
    assert.equal(app.session.ready.objects.extruder?.target, 210);
    await context.close();
    console.log('Mock browser interactions passed');
  } finally {
    await browser?.close();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('[test:mock-browser]', error);
  process.exitCode = 1;
});
