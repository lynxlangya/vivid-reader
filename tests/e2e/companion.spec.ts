import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfiAt } from '../../src/main/content/epub';
import { seedReading } from './seed';
import { launchIsolated, capture } from './helpers';
test('question streams into notebook, citation jumps without advancing, rewind starts new conversation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-companion-e2e-'));
  const { boundary, parsed } = await seedReading(dir);
  const app = await launchIsolated(dir, { VIVID_TEST_AGENT: 'faux' });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.locator('.toc button').nth(2).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))
            ?.currentChapter,
      )
      .toBe(2);
    await page.getByRole('button', { name: '伴读', exact: true }).click();
    await page.evaluate(() => {
      let count = 0;
      window.vivid.onCompanion((update) => {
        if (update.busy && update.messages.at(-1)?.text) count++;
        (window as unknown as { streamUpdates: number }).streamUpdates = count;
      });
    });
    await page
      .getByPlaceholder('问一个关于已读部分的问题')
      .fill('请解释已读部分的关系。');
    await page.getByPlaceholder('问一个关于已读部分的问题').press('Meta+Enter');
    await expect(page.locator('.dialogue')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.locator('.dialogue')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 15000 },
    );
    await expect(page.locator('.dialogue-assistant')).toContainText(
      '书里用土地与行旅',
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { streamUpdates: number }).streamUpdates,
      ),
    ).toBeGreaterThan(2);
    const before = await page.evaluate(() => window.vivid.readerState());
    await page.getByRole('button', { name: '见第一章 ›', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))
            ?.currentChapter,
      )
      .toBe(0);
    expect(
      (await page.evaluate(() => window.vivid.readerState()))!.boundaryCFI,
    ).toBe(boundary);
    expect(before!.boundaryCFI).toBe(boundary);
    expect(before!.currentChapter).toBe(2);
    await capture(app, page, '/tmp/vivid-g4-companion.png');
    await page.evaluate(
      (cfi) => window.vivid.setBoundary(cfi),
      cfiAt(parsed.chapters[0], 0),
    );
    await expect(page.locator('.dialogue-assistant')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
