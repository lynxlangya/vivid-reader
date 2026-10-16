import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfiAt } from '../../src/main/content/epub';
import { seedReading } from './seed';
import { launchIsolated, capture } from './helpers';
import type { FoliateView } from '../../src/renderer/reader/engine';
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
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.locator('.toc button').nth(1).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))
            ?.currentChapter,
      )
      .toBe(1);
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

test('selection summary is consumed once across companion and reader remounts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-summary-e2e-'));
  await seedReading(dir);
  const app = await launchIsolated(dir, { VIVID_TEST_AGENT: 'faux' });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    // Keep the reader geometry stable while selecting an actual EPUB DOM range.
    await page.getByRole('button', { name: '伴读', exact: true }).click();
    const selectParagraph = () => {
      const view = document.querySelector('foliate-view') as FoliateView;
      const { doc } = view.renderer.getContents()[0];
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector('p')!);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
      doc
        .querySelector('p')!
        .dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    };
    await page.evaluate(selectParagraph);
    const summarize = page
      .getByRole('toolbar', { name: '正文选区' })
      .getByRole('button', { name: '总结', exact: true });
    await expect(summarize).toBeEnabled();
    await summarize.click();
    await expect(page.locator('.dialogue-assistant')).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(page.locator('.dialogue')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    const before = await page.evaluate(() => window.vivid.conversation());
    expect(
      before.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(1);
    await page.getByRole('button', { name: '伴读', exact: true }).click();
    await expect(page.locator('.companion')).toHaveCount(0);
    // Give the remounted companion another valid selection: stale requests must
    // not be hidden merely by a rejected request after the layout clears selection.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.evaluate(selectParagraph);
    await expect(summarize).toBeEnabled();
    await page.evaluate(() => {
      const probe = window as unknown as { replayedUpdates: number };
      probe.replayedUpdates = 0;
      window.vivid.onCompanion((update) => {
        if (update.busy) probe.replayedUpdates++;
      });
    });
    await page.getByRole('button', { name: '伴读', exact: true }).click();
    await expect(page.locator('.dialogue-assistant')).toHaveCount(1);
    await page.getByRole('button', { name: '书架', exact: true }).click();
    await page.getByRole('button', { name: '返回阅读', exact: true }).click();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(page.locator('.dialogue-assistant')).toHaveCount(1);
    await page.waitForTimeout(600);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { replayedUpdates: number }).replayedUpdates,
      ),
    ).toBe(0);
    expect(
      (await page.evaluate(() => window.vivid.conversation())).messages,
    ).toEqual(before.messages);
  } finally {
    await app.close();
  }
});
