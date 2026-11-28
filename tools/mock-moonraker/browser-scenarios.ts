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

/** Exercise every chip that substitutes the Klippy-not-ready placeholder. */
async function assertChipReadiness(page: Page, app: Awaited<ReturnType<typeof startMockDev>>): Promise<void> {
  await page.goto(`${app.url}/#/p/mock-ready?edit=1`);
  await page.locator('.qa-btn').first().click();
  const dialog = page.locator('.dialog[role="dialog"]');
  // The default layout already includes temperature and Live Z chips.
  for (const type of ['macro', 'output', 'led', 'tuning', 'filament']) {
    const section = dialog.locator(`[data-chip-type="${type}"]`);
    await section.locator('.pacc-head').first().click();
    await section.locator('.picker-item').first().click();
  }
  await dialog.locator('.dialog-footer .btn').click();
  await page.locator('.edit-toolbar .btn-primary').click();
  await page.locator('.edit-toolbar').waitFor({ state: 'detached' });
  const accordion = page.locator('.qa-toggle');
  if (await accordion.count() && await accordion.getAttribute('aria-expanded') === 'false') await accordion.click();

  const tags = [
    'mpu-core-widgets-chip-temperature', 'mpu-core-calibrations-chip-livez',
    'mpu-core-widgets-chip-macro', 'mpu-core-widgets-chip-output',
    'mpu-core-widgets-chip-led', 'mpu-core-widgets-chip-tuning',
    'mpu-core-widgets-chip-filament',
  ];
  for (const tag of tags) {
    const chip = page.locator(`${tag} .chip`).first();
    await chip.waitFor();
    assert.equal(await chip.locator('.knr').count(), 0, `${tag} starts ready`);
    assert.equal(await chip.evaluate((el) => el.classList.contains('interactive')), true, `${tag} starts interactive`);
    await chip.dispatchEvent('click');
    assert.equal(await page.locator(`${tag} .chip-popover`).count(), 1, `${tag} opens its controls`);
  }

  app.session.ready.setKlippyState('error');
  for (const tag of tags) {
    const chip = page.locator(`${tag} .chip`).first();
    await chip.locator('.knr').waitFor();
    assert.equal(await chip.evaluate((el) => el.classList.contains('interactive')), false, `${tag} is not interactive`);
    // A temperature chip may lose its sensor metadata and become a plain div.
    if (tag.endsWith('-led')) assert.equal(await chip.evaluate((el) => (el as HTMLButtonElement).disabled), true);
    else assert.ok(await chip.evaluate((el) => el.tabIndex < 0), `${tag} leaves keyboard navigation`);
    assert.equal(await page.locator(`${tag} .chip-popover`).count(), 0, `${tag} closes its controls`);
    await chip.dispatchEvent('click');
    await chip.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
    assert.equal(await page.locator(`${tag} .chip-popover`).count(), 0, `${tag} ignores input`);
  }

  // The placeholder must still fit the chip strip when layout direction changes.
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator('html').evaluate((element) => element.setAttribute('dir', 'rtl'));
  await assertNoPageOverflow(page, 'Klippy-not-ready chips at 768px RTL');

  app.session.ready.setKlippyState('ready');
  const output = page.locator('mpu-core-widgets-chip-output .chip').first();
  await output.locator('.knr').waitFor({ state: 'detached' });
  assert.equal(await output.evaluate((el) => el.classList.contains('interactive')), true);
  await output.dispatchEvent('click');
  assert.equal(await page.locator('mpu-core-widgets-chip-output .chip-popover').count(), 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
}

/** Exercises visible screens and verifies the resulting state through the shared mock engine. */
async function main(): Promise<void> {
  const app = await startMockDev({ uiPort: 5175, readyPort: 17135, errorPort: 17136 });
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
    // The cfg editor must keep a live source buffer while a second macro is edited in a peek.
    await page.locator('tr.row-file').filter({ hasText: 'printer.cfg' }).first().click();
    const configEditor = page.locator('.editor-overlay .cm-editor').first();
    await configEditor.waitFor();
    await configEditor.locator('.cm-content').click();
    // Compare theme tokens directly without changing the user's stored theme preference.
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
    const darkCaret = await configEditor.evaluate((element) => {
      const content = element.querySelector('.cm-content');
      if (!content) throw new Error('CodeMirror content is missing');
      const color = getComputedStyle(content).caretColor;
      return { color, text: getComputedStyle(element).color };
    });
    assert.equal(darkCaret.color, darkCaret.text);
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'light'));
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# TAB_CHECK');
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    assert.ok((await configEditor.locator('.cm-content').innerText()).includes('    # TAB_CHECK'));
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n[gcode_macro TEST_CALLER]\ngcode:\n  TES');
    await page.locator('.ac-popup').waitFor({ state: 'visible' });
    // Completion keys must win over CodeMirror's Enter, Tab and cursor movement defaults.
    const firstChoice = await page.locator('.ac-item.selected .ac-label').innerText();
    assert.ok(await page.locator('.ac-item').count() > 1);
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.locator('.ac-item.selected .ac-label').innerText(), firstChoice);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.ac-item.selected .ac-label').innerText(), firstChoice);
    await page.keyboard.press('Tab');
    await page.locator('.ac-popup').waitFor({ state: 'hidden' });
    assert.ok((await configEditor.locator('.cm-content').innerText()).includes(`  ${firstChoice}`));
    await page.keyboard.type('\n  TES');
    await page.locator('.ac-popup').waitFor({ state: 'visible' });
    const enterChoice = await page.locator('.ac-item.selected .ac-label').innerText();
    await page.keyboard.press('Enter');
    await page.locator('.ac-popup').waitFor({ state: 'hidden' });
    assert.ok((await configEditor.locator('.cm-content').innerText()).includes(`  ${enterChoice}`));
    await page.keyboard.type('\n  TES');
    await page.locator('.ac-popup').waitFor({ state: 'visible' });
    await page.keyboard.down('Control');
    await page.locator('.ac-popup').waitFor({ state: 'hidden' });
    await page.keyboard.up('Control');
    await page.keyboard.type('T_MOCK\n');
    const callLine = configEditor.locator('.cm-line').filter({ hasText: '  TEST_MOCK' }).last();
    // Manifest shortcuts target the macro at the caret and preserve the editor's buffers.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+p');
    const choices = page.getByRole('dialog', { name: 'Choose macro definition' });
    await choices.waitFor();
    await choices.getByRole('button', { name: /macros.cfg:1/ }).click();
    const peek = page.locator('.cm-peek');
    await peek.waitFor();
    await page.keyboard.press('Escape');
    await peek.waitFor({ state: 'detached' });
    await page.keyboard.press('Control+o');
    await choices.waitFor();
    await choices.getByRole('button', { name: /macros.cfg:1/ }).click();
    await page.getByRole('tab', { name: /macros.cfg/ }).waitFor();
    await page.getByRole('tab', { name: /printer.cfg/ }).click();
    await configEditor.locator('.cm-content').click();
    await page.keyboard.press('Control+f');
    await page.locator('.search-bar .sb-input').first().waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('.search-bar').waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+h');
    await page.locator('.search-bar .sb-row').last().waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('.search-bar').waitFor({ state: 'hidden' });
    await page.keyboard.press('F1');
    await page.locator('.help-pop').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('.help-pop').waitFor({ state: 'hidden' });
    await callLine.click({ modifiers: ['Control'] });
    await choices.waitFor();
    await choices.getByRole('button', { name: /macros.cfg:1/ }).click();
    await peek.waitFor();
    await peek.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('  M118 PEEK_TEST\n');
    await page.keyboard.press('Control+s');
    await eventually(() => app.session.ready.files.get('config/macros.cfg')?.content.toString().includes('PEEK_TEST') ?? false, 'peek save');
    assert.ok(app.session.ready.files.get('config/macros.cfg')?.content.toString().includes('_HOME_X'), 'peek save preserves following macros');
    assert.ok(app.session.ready.files.get('config/macros.cfg')?.content.toString().includes('\n[gcode_macro _HOME_X]'), 'following macro starts at column zero');
    assert.ok(app.session.ready.files.has('config/.backup/macros.cfg.bak'));
    await peek.getByRole('button', { name: 'Close' }).click();
    await callLine.click({ button: 'right', modifiers: ['Control'] });
    await choices.getByRole('button', { name: /macros.cfg:1/ }).click();
    await page.getByRole('tab', { name: /macros.cfg/ }).waitFor();
    assert.ok(await page.getByRole('tab', { name: /printer.cfg/ }).count());
    const targetEditor = page.locator('.editor-overlay .cm-editor').first();
    await targetEditor.locator('.cm-content').click();
    await page.keyboard.press('Control+z');
    assert.ok(!(await targetEditor.locator('.cm-content').innerText()).includes('PEEK_TEST'));
    await page.keyboard.press('Control+y');
    assert.ok((await targetEditor.locator('.cm-content').innerText()).includes('PEEK_TEST'));
    await page.getByRole('tab', { name: /printer.cfg/ }).click();
    assert.ok((await configEditor.locator('.cm-content').innerText()).includes('TEST_CALLER'));
    assert.ok(await page.getByRole('button', { name: 'Save', exact: true }).first().isEnabled());
    await configEditor.locator('.cm-content').click();
    const beforeTabUndo = await configEditor.locator('.cm-content').innerText();
    await page.keyboard.press('Control+z');
    assert.notEqual(await configEditor.locator('.cm-content').innerText(), beforeTabUndo);
    await page.keyboard.press('Control+y');
    assert.equal(await configEditor.locator('.cm-content').innerText(), beforeTabUndo);
    await callLine.click({ modifiers: ['Control'] });
    await choices.getByRole('button', { name: /printer.cfg:/ }).click();
    const sameFilePeek = page.locator('.cm-peek');
    await sameFilePeek.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('  M118 SAME_FILE_TEST\n');
    assert.ok((await sameFilePeek.locator('.cm-content').innerText()).includes('SAME_FILE_TEST'));
    await sameFilePeek.getByRole('button', { name: 'Close' }).click();
    await sameFilePeek.waitFor({ state: 'detached' });
    assert.ok((await configEditor.locator('.cm-content').first().innerText()).includes('SAME_FILE_TEST'));
    await configEditor.locator('.cm-content').first().click();
    await page.keyboard.press('Control+z');
    assert.ok(!(await configEditor.locator('.cm-content').first().innerText()).includes('SAME_FILE_TEST'));
    await page.keyboard.press('Control+y');
    assert.ok((await configEditor.locator('.cm-content').first().innerText()).includes('SAME_FILE_TEST'));
    // A macro call in homing_override must navigate just like one inside gcode_macro.
    await configEditor.locator('.cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n[homing_override]\ngcode:\n  _HOME_X\n');
    const homeCall = configEditor.locator('.cm-line').filter({ hasText: '_HOME_X' }).last();
    await homeCall.click({ modifiers: ['Control'] });
    const homePeek = page.locator('.cm-peek');
    await homePeek.waitFor();
    assert.ok(await homePeek.locator('.cm-tok-cmd').count());
    await homePeek.getByRole('button', { name: 'Close' }).click();
    await homeCall.click({ button: 'right', modifiers: ['Control'] });
    await page.getByRole('tab', { name: /macros.cfg/ }).waitFor();
    await page.getByRole('tab', { name: /printer.cfg/ }).click();
    await page.setViewportSize({ width: 768, height: 900 });
    await page.locator('html').evaluate((element) => element.setAttribute('dir', 'rtl'));
    for (const name of ['Peek macro', 'Open macro file']) {
      const action = page.getByRole('button', { name });
      assert.equal(await action.locator('svg').count(), 1);
      assert.equal(await action.locator('.btn-label').count(), 0);
    }
    await assertNoPageOverflow(page, 'RTL config editor at 768px');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('alertdialog', { name: 'Some config files have unsaved changes.' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await configEditor.waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
    // The configurable save binding still writes through Config's backup path.
    await page.locator('tr.row-file').filter({ hasText: 'printer.cfg' }).first().click();
    await page.locator('.editor-overlay .cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# shortcut save\n');
    await page.keyboard.press('Control+s');
    await eventually(() => app.session.ready.files.get('config/printer.cfg')?.content.toString().includes('# shortcut save') ?? false, 'shortcut save');
    // Session actions live above the embedded editor, outside its former dialog shell.
    await page.locator('.session-window').getByRole('button', { name: 'Close', exact: true }).first().click();
    // The session-wide restart action must retain its check and separate recovery copy across F5.
    await page.locator('tr.row-file').filter({ hasText: 'printer.cfg' }).first().click();
    await page.locator('.editor-overlay .cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# mock restart check\n');
    await page.getByRole('button', { name: 'Save all & Restart', exact: true }).click();
    await page.getByText('Klipper is starting.', { exact: false }).waitFor();
    const safeContent = app.session.ready.files.get('config/printer.cfg')?.content.toString() ?? '';
    assert.ok(safeContent.includes('# mock restart check'));
    assert.ok([...app.session.ready.files.keys()].some((path) => /config\/\.backup\/printer\.cfg\..*\.restart\.bak$/.test(path)));
    await page.reload();
    await page.getByText('Klipper restarted and is ready.').waitFor();
    await page.locator('.restart-dismiss').click();

    // A failed startup offers the exact attempt copy, then warns before overwriting a newer file.
    app.session.ready.nextRestartOutcome = 'error';
    await page.locator('tr.row-file').filter({ hasText: 'printer.cfg' }).first().click();
    await page.locator('.editor-overlay .cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# mock bad config\n');
    await page.getByRole('button', { name: 'Save all & Restart', exact: true }).click();
    await page.getByText('Klipper is starting.', { exact: false }).waitFor();
    await eventually(() => app.session.ready.klippyState === 'error', 'failed Klipper startup');
    await page.evaluate(() => {
      const key = 'tessera:config-restart:mock-ready';
      const attempt = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { deadline?: number };
      attempt.deadline = Date.now() - 1;
      sessionStorage.setItem(key, JSON.stringify(attempt));
    });
    await page.reload();
    await page.getByText('Klipper started but did not become ready within 100 seconds.').waitFor();
    // The Config-owned error notification remains actionable after F5.
    const failureToast = page.locator('.toast').filter({ hasText: 'Klipper did not become ready after saving printer.cfg.' });
    await failureToast.waitFor();
    await failureToast.getByRole('button', { name: 'Open Config' }).waitFor();
    await failureToast.getByRole('button', { name: 'Restore file' }).waitFor();
    await page.evaluate(() => { location.hash = '#/p/mock-ready/machine'; });
    await page.getByText('Machine', { exact: true }).first().waitFor();
    await failureToast.getByRole('button', { name: 'Open Config' }).click();
    assert.ok(page.url().includes('#/p/mock-ready/config'));
    await page.setViewportSize({ width: 768, height: 900 });
    await page.locator('html').evaluate((element) => element.setAttribute('dir', 'rtl'));
    await assertNoPageOverflow(page, 'RTL restart recovery at 768px');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
    await page.getByRole('button', { name: 'Compare attempt copy' }).click();
    await page.locator('.compare-backup').waitFor();
    await page.locator('.session-window').getByRole('button', { name: 'Close', exact: true }).first().click();
    app.session.ready.putFile('config/printer.cfg', Buffer.from(`${app.session.ready.files.get('config/printer.cfg')?.content.toString()}\n# newer edit\n`));
    await page.evaluate(() => { location.hash = '#/p/mock-ready/machine'; });
    await page.getByText('Machine', { exact: true }).first().waitFor();
    await failureToast.getByRole('button', { name: 'Restore file' }).click();
    await page.getByText('This file has changed since the restart attempt.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Overwrite and restore' }).click();
    await page.waitForFunction(() => location.hash === '#/p/mock-ready/config');
    assert.ok(page.url().includes('#/p/mock-ready/config'));
    await eventually(() => app.session.ready.files.get('config/printer.cfg')?.content.toString() === safeContent, 'restored config');
    assert.ok(app.session.ready.files.get('config/.backup/printer.cfg.bak')?.content.toString().includes('# newer edit'));
    await page.getByText('Klipper restarted and is ready.').waitFor();
    await page.locator('.restart-dismiss').click();
    await open(page, app.url, '#/p/mock-ready/machine', 'Machine');
    await open(page, app.url, '#/settings/general', 'General');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.evaluate(() => { location.hash = '#/p/mock-ready/config'; });
    await page.locator('tr.row-file').filter({ hasText: 'printer.cfg' }).first().click();
    const lightCaret = await page.locator('.editor-overlay .cm-editor').first().evaluate((element) => {
      const content = element.querySelector('.cm-content');
      if (!content) throw new Error('CodeMirror content is missing');
      return { color: getComputedStyle(content).caretColor, text: getComputedStyle(element).color };
    });
    assert.equal(lightCaret.color, lightCaret.text);
    assert.notEqual(lightCaret.color, darkCaret.color);
    await page.locator('.session-window').getByRole('button', { name: 'Close', exact: true }).first().click();

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
    await assertChipReadiness(page, app);
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
