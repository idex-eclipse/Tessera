import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { startMockDev } from './dev.js';

/** Exercise shared and private Fleet grids in a real browser with isolated mock printers. */
async function main(): Promise<void> {
  const app = await startMockDev({ uiPort: 5180, readyPort: 17180, errorPort: 17181 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${app.url}/#/p/mock-ready`);
    await page.getByRole('button', { name: 'Fleet Overview' }).click();
    const cards = page.locator('.fleet-card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);

    await page.getByRole('button', { name: 'Edit card grid' }).click();
    const first = cards.first().locator('.fleet-panel-slot').first();
    const second = cards.nth(1).locator('.fleet-panel-slot').first();
    assert.equal(await cards.first().locator('.fleet-sync input').isChecked(), true);
    assert.equal(await cards.nth(1).locator('.fleet-sync input').isChecked(), true);
    const topHandle = first.locator('.resize-n');
    const tileBox = await first.boundingBox();
    const topBox = await topHandle.boundingBox();
    const providerBox = await first.locator('.fleet-provider').boundingBox();
    const sizeBox = await first.locator('.fleet-edit-size').boundingBox();
    assert.ok(tileBox && topBox && providerBox && sizeBox);
    assert.ok(Math.abs(topBox.width - tileBox.width) <= 2.1, `top handle spans the whole side: ${topBox.width} / ${tileBox.width}`);
    assert.ok(Math.abs((sizeBox.x + sizeBox.width / 2) - (tileBox.x + tileBox.width / 2)) < 2);
    assert.ok(providerBox.x < tileBox.x + tileBox.width / 4, 'plugin ID stays at the left');
    assert.equal(await topHandle.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    await topHandle.hover();
    assert.notEqual(await topHandle.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');

    // The same saved template can project different intrinsic heights for each printer.
    await first.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = '600px'; });
    await second.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = '300px'; });
    await first.locator('.fleet-auto-height input').check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.fleet-card .fleet-panel-slot')!).gridRowEnd === 'span 600');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 300');
    assert.equal(await cards.first().locator('.fleet-panel-slot').nth(1).evaluate((element) => getComputedStyle(element).gridRowStart), '605');
    await first.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = '700px'; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.fleet-card .fleet-panel-slot')!).gridRowEnd === 'span 700');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 300');
    await first.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = '600px'; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.fleet-card .fleet-panel-slot')!).gridRowEnd === 'span 600');
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-auto-height.png') });
    await first.locator('.fleet-auto-height input').uncheck();
    assert.equal(await first.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 188');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 188');
    await first.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = ''; });
    await second.locator('.fleet-panel-content').evaluate((element) => { (element as HTMLElement).style.minHeight = ''; });
    await first.locator('.fleet-auto-height input').check();
    await cards.first().locator('.fleet-panel-slot').nth(1).locator('.fleet-auto-height input').check();
    await page.waitForFunction(() => {
      const slots = [...document.querySelectorAll('.fleet-card:first-child .fleet-panel-slot')].slice(0, 2);
      return slots.every((slot) => {
        const content = slot.querySelector('.fleet-panel-content');
        return content && Math.abs(slot.getBoundingClientRect().height - content.getBoundingClientRect().height) < 3;
      });
    });
    const fitted = await cards.first().locator('.fleet-panel-slot').evaluateAll((elements) => elements.slice(0, 3).map((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      contentHeight: element.querySelector('.fleet-panel-content')?.getBoundingClientRect().height ?? 0,
      slotHeight: element.getBoundingClientRect().height,
    })).sort((a, b) => a.top - b.top));
    assert.ok(Math.abs(fitted[0]!.slotHeight - fitted[0]!.contentHeight) < 3);
    assert.ok(Math.abs(fitted[1]!.slotHeight - fitted[1]!.contentHeight) < 3);
    assert.ok(fitted[1]!.top - fitted[0]!.bottom <= 5, 'auto-height panels keep only the grid gap');
    assert.ok(fitted[2]!.top - fitted[1]!.bottom <= 5, 'following panel keeps only the grid gap');
    assert.equal(await cards.first().locator('.fleet-panel-slot').nth(1).locator('.fleet-edit-name').isVisible(), false);
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-natural-auto.png') });
    for (const index of [2, 3])
      await cards.first().locator('.fleet-panel-slot').nth(index).locator('.fleet-auto-height input').check();
    await page.getByRole('button', { name: 'Done editing' }).click();
    await cards.first().locator('.fleet-card-body').evaluate((element) => { (element as HTMLElement).scrollTop = 0; });
    const normalGap = await cards.first().locator('.fleet-panel-slot').evaluateAll((elements) => elements.slice(0, 4)
      .map((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }))
      .sort((a, b) => a.top - b.top));
    for (let index = 1; index < normalGap.length; index++)
      assert.ok(normalGap[index]!.top - normalGap[index - 1]!.bottom <= 5, `panel ${index} keeps only the grid gap`);
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-natural-view.png') });
    await page.getByRole('button', { name: 'Edit card grid' }).click();
    for (const index of [0, 1, 2, 3])
      await cards.first().locator('.fleet-panel-slot').nth(index).locator('.fleet-auto-height input').uncheck();

    const move = first.locator('.fleet-move-target');
    await move.scrollIntoViewIfNeeded();
    const box = await move.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 20 + 4 * 48, { steps: 8 });
    await page.mouse.up();
    const position = await first.evaluate((element) => getComputedStyle(element).gridRowStart);
    assert.equal(position, '193');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowStart), position);

    await first.scrollIntoViewIfNeeded();
    const grip = first.locator('.resize-w');
    const gripBox = await grip.boundingBox();
    assert.ok(gripBox);
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2 + 90, gripBox.y + gripBox.height / 2, { steps: 8 });
    await page.mouse.up();
    const width = await first.evaluate((element) => getComputedStyle(element).gridColumnEnd);
    assert.notEqual(width, 'span 12');
    assert.equal(await first.locator('.fleet-auto-height').count(), 0);
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridColumnEnd), width);
    await move.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    assert.notEqual(await first.evaluate((element) => getComputedStyle(element).gridColumnEnd), width);

    // The south edge can shrink to one row, including after a side resize.
    const south = first.locator('.resize-s');
    const southBox = await south.boundingBox();
    assert.ok(southBox);
    await page.mouse.move(southBox.x + southBox.width / 2, southBox.y + southBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(southBox.x + southBox.width / 2, southBox.y + southBox.height / 2 - 156, { steps: 8 });
    await page.mouse.up();
    assert.equal(await first.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 44');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 44');
    // Visibility stays available in the labelled card-header chooser when a tile is only one row tall.
    assert.equal(await cards.first().locator('.fleet-tile-hide').count(), 0);
    assert.equal((await cards.first().locator('.fleet-card-choose').innerText()).trim(), 'Panels');

    await cards.first().getByRole('button', { name: 'Show or hide panels' }).click();
    const visible = page.locator('.editor-item input[type="checkbox"]').first();
    await visible.uncheck();
    assert.equal(await cards.first().locator('.fleet-panel-slot').first().evaluate((element) => getComputedStyle(element).display), 'none');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).display), 'none');
    await visible.check();
    await page.locator('.editor-done').click();

    await cards.nth(1).locator('.fleet-sync input').uncheck();
    const privateMove = second.locator('.fleet-move-target');
    await privateMove.focus();
    await page.keyboard.press('Shift+ArrowDown');
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 92');
    assert.equal(await first.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 44');
    await cards.nth(1).locator('.fleet-sync input').check();
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 44');
    await cards.nth(1).locator('.fleet-sync input').uncheck();
    assert.equal(await second.evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 92');
    await cards.nth(1).getByRole('button', { name: 'Show or hide panels' }).click();
    const privateVisible = page.locator('.editor-item input[type="checkbox"]').first();
    await privateVisible.uncheck();
    assert.equal(await second.evaluate((element) => getComputedStyle(element).display), 'none');
    assert.notEqual(await first.evaluate((element) => getComputedStyle(element).display), 'none');
    await privateVisible.check();
    await page.locator('.editor-done').click();
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-edit.png') });

    await page.getByRole('button', { name: 'Done editing' }).click();
    assert.equal(await first.evaluate((element) => getComputedStyle(element).borderTopWidth), '0px');
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 768, height: 900 });
      await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
      for (const dir of ['ltr', 'rtl']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('dir', value), dir);
        const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(size.document <= size.viewport + 1, `${theme}/${dir}: ${size.document} > ${size.viewport}`);
        assert.equal(await cards.first().evaluate((element) => Math.round(element.getBoundingClientRect().width)),
          await cards.nth(1).evaluate((element) => Math.round(element.getBoundingClientRect().width)));
      }
    }
    await page.getByRole('button', { name: 'Edit card grid' }).click();
    const rtlSlot = cards.first().locator('.fleet-panel-slot').first();
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
      for (const dir of ['ltr', 'rtl']) {
        await page.locator('html').evaluate((element, value) => element.setAttribute('dir', value), dir);
        const slotBox = await rtlSlot.boundingBox();
        const gripBox = await rtlSlot.locator('.resize-se').boundingBox();
        const provider = await rtlSlot.locator('.fleet-provider').boundingBox();
        assert.ok(slotBox && gripBox && provider);
        assert.ok(Math.abs(gripBox.x - (dir === 'rtl' ? slotBox.x : slotBox.x + slotBox.width - gripBox.width)) < 2,
          `${theme}/${dir}: resize corner follows inline end`);
        assert.ok(dir === 'rtl' ? provider.x > slotBox.x + slotBox.width / 2 : provider.x < slotBox.x + slotBox.width / 2,
          `${theme}/${dir}: plugin ID follows the leading corner`);
        const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(width.document <= width.viewport + 1, `${theme}/${dir}: editing overflows viewport`);
        const headerBox = await cards.first().locator('.fleet-card-header').boundingBox();
        const chooserBox = await cards.first().locator('.fleet-card-choose').boundingBox();
        assert.ok(headerBox && chooserBox && chooserBox.x >= headerBox.x &&
          chooserBox.x + chooserBox.width <= headerBox.x + headerBox.width + 1,
          `${theme}/${dir}: labelled panel chooser fits the card header`);
        if (theme === 'light' && dir === 'ltr')
          await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-ltr-light-edit.png') });
        if (theme === 'dark' && dir === 'rtl')
          await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-rtl-dark-edit.png') });
      }
    }
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-grid-rtl-dark.png') });
    await page.reload();
    if (await cards.count() === 0) await page.getByRole('button', { name: 'Fleet Overview' }).click();
    await cards.first().waitFor();
    assert.equal(await cards.first().locator('.fleet-panel-slot').first()
      .evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 44');
    assert.equal(await cards.nth(1).locator('.fleet-panel-slot').first()
      .evaluate((element) => getComputedStyle(element).gridRowEnd), 'span 92');
    await page.setViewportSize({ width: 1440, height: 768 });
    await page.locator('html').evaluate((element) => { element.setAttribute('dir', 'ltr'); element.setAttribute('data-theme', 'light'); });
    await page.getByRole('button', { name: 'Edit card grid' }).click();
    await cards.first().getByRole('button', { name: 'Show or hide panels' }).click();
    await page.locator('.editor-reset').click();
    await page.locator('.editor-done').click();
    await cards.first().locator('.fleet-panel-slot').first().locator('.fleet-auto-height input').check();
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.reload();
    if (await cards.count() === 0)
      await page.getByRole('button', { name: 'Fleet Overview' }).click();
    await cards.first().locator('.fleet-camera-stream').waitFor();
    await page.waitForTimeout(500);
    const loadedCamera = await cards.first().locator('.fleet-panel-slot').first()
      .evaluate((element) => ({
        slot: element.getBoundingClientRect().height,
        stream: element.querySelector('.fleet-camera-stream')?.getBoundingClientRect().height,
        cam: element.querySelector('.cam')?.getBoundingClientRect().height,
        image: element.querySelector('.cam img')?.getBoundingClientRect().height,
      }));
    assert.ok((loadedCamera.stream ?? 0) > 200 && (loadedCamera.image ?? 0) > 0,
      'saved auto-height camera keeps a visible image after reload');
    await page.screenshot({ path: join(tmpdir(), 'tessera-fleet-camera-reload.png') });
    app.session.ready.webcams[0]!.service = 'hlsstream';
    await page.reload();
    if (await cards.count() === 0) await page.getByRole('button', { name: 'Fleet Overview' }).click();
    await cards.first().locator('.cam video').waitFor();
    const unloadedVideo = await cards.first().locator('.fleet-panel-slot').first()
      .evaluate((element) => ({
        slot: element.getBoundingClientRect().height,
        stream: element.querySelector('.fleet-camera-stream')?.getBoundingClientRect().height,
        cam: element.querySelector('.cam')?.getBoundingClientRect().height,
        video: element.querySelector('.cam video')?.getBoundingClientRect().height,
        flexGrow: getComputedStyle(element.querySelector('.fleet-camera-stream')!).flexGrow,
      }));
    assert.ok((unloadedVideo.stream ?? 0) > 200 && (unloadedVideo.cam ?? 0) > 200,
      'camera reserves a frame before video metadata loads');
    assert.equal(unloadedVideo.flexGrow, '0');
    await page.close();
    console.log('Fleet grid browser checks passed');
  } finally {
    await browser.close();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('[fleet-grid-browser]', error);
  process.exitCode = 1;
});
