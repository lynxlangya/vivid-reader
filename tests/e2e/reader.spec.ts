import { launchIsolated, capture } from './helpers';
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildEpub } from '../fixtures/build-epub';
import { parseEpub, sampleOffsets, cfiAt } from '../../src/main/content/epub';
import type { FoliateView } from '../../src/renderer/reader/engine';
const launch = launchIsolated;
async function importFile(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, path);
  await page.getByRole('button', { name: '导入 EPUB', exact: true }).click();
  await expect(page.locator('.reader-host')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.locator('.pager')).toHaveAttribute('data-cfi', /^epubcfi/);
}
async function roundtrip(
  page: Page,
  samples: ReturnType<typeof sampleOffsets>,
) {
  return page.evaluate(async (records) => {
    const view = document.querySelector('foliate-view') as FoliateView;
    const docs = new Map<number, Document>();
    let mismatches = 0;
    for (const record of records) {
      const { index, anchor } = view.resolveCFI(record.cfi);
      if (!docs.has(index))
        docs.set(index, await view.book.sections[index].createDocument());
      if (anchor(docs.get(index)!).toString() !== record.expected) mismatches++;
    }
    return mismatches;
  }, samples);
}
test('imports, roundtrips 200 offsets, highlights without changing CFI, hovers and restores', async () => {
  const file = await buildEpub();
  const parsed = parseEpub(await readFile(file));
  const data = await mkdtemp(join(tmpdir(), 'vivid-reader-e2e-'));
  let app = await launch(data);
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => console.error(error.message));
    await importFile(app, page, file);
    expect(await roundtrip(page, sampleOffsets(parsed))).toBe(0);
    const probe = await page.evaluate(() => {
      const view = document.querySelector('foliate-view') as FoliateView;
      const { doc, index } = view.renderer.getContents()[0];
      const range = view.lastLocation!.range;
      const before = view.getCFI(index, range);
      const win = doc.defaultView as unknown as { CSS: typeof CSS };
      const highlight = win.CSS.highlights.get('vivid-place')!;
      win.CSS.highlights.delete('vivid-place');
      const without = view.getCFI(index, range);
      win.CSS.highlights.set('vivid-place', highlight);
      const after = view.getCFI(index, range);
      const style = doc.defaultView!.getComputedStyle(
        doc.querySelector('p')!,
        '::highlight(vivid-place)',
      );
      return {
        before,
        without,
        after,
        line: style.textDecorationLine,
        thickness: style.textDecorationThickness,
        offset: style.textUnderlineOffset,
        sandbox: doc.defaultView!.frameElement!.getAttribute('sandbox'),
        executed: 'vividBookScriptExecuted' in doc.defaultView!,
      };
    });
    expect(probe.before).toBe(probe.without);
    expect(probe.before).toBe(probe.after);
    expect(probe.line).toBe('underline');
    expect(probe.thickness).toBe('1px');
    expect(probe.offset).toBe('5px');
    expect(probe.sandbox).not.toContain('allow-scripts');
    expect(probe.executed).toBe(false);
    const chapter = parsed.chapters[0];
    const cfi = cfiAt(chapter, chapter.text.indexOf('纸湾'));
    const chapterFrame = page
      .frames()
      .find((frame) => frame.url().startsWith('blob:'));
    expect(chapterFrame).toBeDefined();
    await chapterFrame!.locator('p').first().hover();
    const point = await page.evaluate((value) => {
      const view = document.querySelector('foliate-view') as FoliateView;
      const doc = view.renderer.getContents()[0].doc;
      const range = view.resolveCFI(value).anchor(doc);
      range.setEnd(range.startContainer, range.startOffset + 2);
      const r = range.getBoundingClientRect();
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      return {
        x: r.x + frame.x + r.width / 4,
        y: r.y + frame.y + r.height / 2,
      };
    }, cfi);
    await page.mouse.move(point.x, point.y, { steps: 5 });
    await expect(page.getByRole('tooltip', { name: '实体旁注' })).toBeVisible();
    const card = await page.getByRole('tooltip').boundingBox();
    expect(card!.y >= point.y || card!.y + card!.height < point.y).toBe(true);
    await capture(app, page, '/tmp/vivid-g1-reader.png');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const before = await page.locator('.pager').getAttribute('data-cfi');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.pager')).not.toHaveAttribute(
      'data-cfi',
      before!,
    );
    const saved = await page.locator('.pager').getAttribute('data-cfi');
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(data, 'reader.json'), 'utf8'))
            .currentCFI,
      )
      .toBe(saved);
    await app.close();
    app = await launch(data);
    const reopened = await app.firstWindow();
    await expect(reopened.locator('.pager')).toHaveAttribute(
      'data-cfi',
      saved!,
    );
  } finally {
    await app.close();
  }
});
test('roundtrips 200 offsets in the optional external EPUB without logging text', async () => {
  test.skip(!process.env.VIVID_TEST_EPUB, 'No external test EPUB supplied');
  const path = process.env.VIVID_TEST_EPUB!;
  const parsed = parseEpub(await readFile(path));
  const app = await launch(
    await mkdtemp(join(tmpdir(), 'vivid-external-e2e-')),
  );
  try {
    const page = await app.firstWindow();
    await importFile(app, page, path);
    expect(await roundtrip(page, sampleOffsets(parsed))).toBe(0);
  } finally {
    await app.close();
  }
});
