import { launchIsolated, capture } from './helpers';
import { seedReading } from './seed';
import { buildEpub } from '../fixtures/build-epub';
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { tmpdir } from 'node:os';
import { parseEpub, sampleOffsets, cfiAt } from '../../src/main/content/epub';
import type { FoliateView } from '../../src/renderer/reader/engine';
import type { Repository } from '../../src/main/db/repository';
import { ContentGateway } from '../../src/main/content/gateway';
const launch = launchIsolated;
async function importFile(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, path);
  await page.getByRole('button', { name: '导入 EPUB', exact: true }).click();
  const start = page.getByRole('button', { name: '开始阅读', exact: true });
  await expect(start).toBeVisible();
  await start.click();
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
  const data = await mkdtemp(join(tmpdir(), 'vivid-reader-e2e-'));
  const { file, parsed } = await seedReading(data);
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
    expect(
      card!.x > point.x ||
        card!.y >= point.y ||
        card!.y + card!.height < point.y,
    ).toBe(true);
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
test('CRLF and lone CR line endings keep main-process offsets aligned with Chromium', async () => {
  for (const lineEnding of ['\r\n', '\r'] as const) {
    const file = await buildEpub({ lineEnding });
    const parsed = parseEpub(await readFile(file));
    const app = await launch(await mkdtemp(join(tmpdir(), 'vivid-eol-e2e-')));
    try {
      const page = await app.firstWindow();
      await importFile(app, page, file);
      expect(await roundtrip(page, sampleOffsets(parsed))).toBe(0);
    } finally {
      await app.close();
    }
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

test('reading the optional external EPUB across a section advances the boundary', async () => {
  test.skip(!process.env.VIVID_TEST_EPUB, 'No external test EPUB supplied');
  test.setTimeout(120000);
  const path = process.env.VIVID_TEST_EPUB!;
  const { chapters } = parseEpub(await readFile(path));
  const from = chapters.findIndex(
    (c, i) => i > 0 && c.text.length && chapters[i + 1]?.text.length,
  );
  expect(from).toBeGreaterThan(0);
  const app = await launch(
    await mkdtemp(join(tmpdir(), 'vivid-external-boundary-')),
  );
  try {
    const page = await app.firstWindow();
    await importFile(app, page, path);
    const pager = page.locator('.pager');
    await expect(pager).toHaveText(/^— \d+ \/ \d+ —$/);
    // Mark the last page of one section as read, then turn into the next.
    const last = await page.evaluate(async (index) => {
      const view = document.querySelector('foliate-view') as FoliateView;
      await view.goTo(index + 1);
      await view.prev();
      return view.lastLocation!.cfi;
    }, from);
    await expect(pager).toHaveAttribute('data-cfi', last);
    await page.evaluate((cfi) => window.vivid.setBoundary(cfi), last);
    for (let turn = 0; turn < 2; turn++) {
      const before = (await pager.getAttribute('data-cfi'))!;
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(pager).not.toHaveAttribute('data-cfi', before);
      await page.waitForTimeout(5400);
      const state = (await page.evaluate(() => window.vivid.readerState()))!;
      expect(state.currentChapter).toBeGreaterThan(from);
      expect(state.boundaryChapter).toBe(state.currentChapter);
      await expect(pager).toHaveText(/^— \d+ \/ \d+ —$/);
    }
  } finally {
    await app.close();
  }
});

test('launching from root imports an image-only cover, preserves CFI mapping, and cancels dwell on the shelf', async () => {
  const data = await mkdtemp(join(tmpdir(), 'vivid-reader-lifecycle-'));
  const file = await buildEpub({ imageOnlyCover: true });
  const parsed = parseEpub(await readFile(file));
  const app = await launch(data, {}, '/');
  try {
    const page = await app.firstWindow();
    await importFile(app, page, file);
    expect(
      (await page.evaluate(() => window.vivid.readerState()))?.currentChapter,
    ).toBe(0);
    expect(await roundtrip(page, sampleOffsets(parsed))).toBe(0);
    const initial = (await page.evaluate(() => window.vivid.readerState()))!;
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))
            ?.currentChapter,
      )
      .toBe(1);
    const saved = (await page.evaluate(() => window.vivid.readerState()))!
      .currentCFI;
    await page.getByRole('button', { name: '书架', exact: true }).click();
    await expect(page.locator('.reader-host')).toHaveCount(0);
    await page.waitForTimeout(5200);
    const onShelf = (await page.evaluate(() => window.vivid.readerState()))!;
    expect(onShelf.boundaryCFI).toBe(initial.boundaryCFI);
    expect(onShelf.currentCFI).toBe(saved);
    await page.getByRole('button', { name: '返回阅读', exact: true }).click();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(page.locator('.pager')).toHaveAttribute('data-cfi', saved);
    expect(
      (await page.evaluate(() => window.vivid.readerState()))!.currentCFI,
    ).toBe(saved);
    expect(
      (await page.evaluate(() => window.vivid.readerState()))!.boundaryCFI,
    ).toBe(initial.boundaryCFI);
    // Explicitly reading from a confirmed point must still advance after a fresh dwell.
    await page.evaluate(() => window.vivid.setBoundaryFraction(0));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.pager')).not.toHaveAttribute('data-cfi', saved);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))!.boundaryCFI,
        { timeout: 10000 },
      )
      .not.toBe(cfiAt(parsed.chapters[1], 0));
  } finally {
    await app.close();
  }
});

async function pageGateway(file: string) {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
  });
  try {
    const { openRepository } = (await server.ssrLoadModule(
      resolve('src/main/db/repository.ts'),
    )) as { openRepository: (path: string) => Repository };
    const parsed = parseEpub(await readFile(file)),
      repo = openRepository(':memory:');
    repo.putBook({ id: 'pages', title: '', author: '', path: file });
    parsed.chapters.forEach((chapter) => repo.putChapter('pages', chapter));
    return { repo, gateway: new ContentGateway(repo, 'pages') };
  } finally {
    await server.close();
  }
}
test('every real page turn onto text is adjacent, and a stale next jump never advances the boundary', async () => {
  for (const options of [{}, { imageOnlyCover: true }]) {
    const data = await mkdtemp(join(tmpdir(), 'vivid-reader-pages-'));
    const file = await buildEpub(options);
    const parsed = parseEpub(await readFile(file));
    const app = await launch(data);
    const { repo, gateway } = await pageGateway(file);
    try {
      const page = await app.firstWindow();
      await importFile(app, page, file);
      const initial = (await page.evaluate(() => window.vivid.readerState()))!;
      await page.evaluate(
        (cfi) => window.vivid.relocate(cfi, 'next'),
        cfiAt(parsed.chapters.at(-2)!, 0),
      );
      await page.waitForTimeout(5200);
      expect(
        (await page.evaluate(() => window.vivid.readerState()))!.boundaryCFI,
      ).toBe(initial.boundaryCFI);
      const pager = page.locator('.pager');
      const pages = [(await pager.getAttribute('data-cfi'))!];
      // foliate may spend one press on a trailing blank column, so allow stalls.
      for (let turn = 0, stalls = 0; turn < 200 && stalls < 3; turn++) {
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        try {
          await expect(pager).not.toHaveAttribute('data-cfi', pages.at(-1)!, {
            timeout: 1500,
          });
          pages.push((await pager.getAttribute('data-cfi'))!);
          stalls = 0;
        } catch {
          stalls++;
        }
      }
      const chapter = (cfi: string) => gateway.position(cfi).chapter;
      // A page without visible text reports only its chapter body.
      const blank = (cfi: string) => !cfi.includes(',');
      const turns = pages.slice(1).map((cfi, index) => ({
        from: pages[index],
        to: cfi,
        adjacent: gateway.follows(pages[index], cfi),
        crossChapter: chapter(cfi) !== chapter(pages[index]),
      }));
      expect(chapter(pages.at(-1)!)).toBe(parsed.chapters.length - 1);
      expect(turns.some((turn) => turn.crossChapter)).toBe(true);
      expect(turns.some((turn) => !turn.crossChapter)).toBe(true);
      expect(turns.some((turn) => blank(turn.from) && turn.adjacent)).toBe(
        true,
      );
      expect(turns.filter((turn) => !blank(turn.to) && !turn.adjacent)).toEqual(
        [],
      );
    } finally {
      repo.close();
      await app.close();
    }
  }
});
test('leaving the reader while a book is still opening never crashes the window', async () => {
  const data = await mkdtemp(join(tmpdir(), 'vivid-reader-remount-'));
  await seedReading(data);
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const reader = page.locator('.reader-host');
    await expect(reader).toHaveAttribute('aria-busy', 'false');
    const toggle = page.locator('header.app-actions > button').first();
    // Sweep the delay so some unmounts land between foliate's open and init.
    for (let delay = 0; delay <= 200; delay += 10) {
      await toggle.click();
      await expect(reader).toHaveCount(0);
      await toggle.click();
      await page.waitForTimeout(delay);
      await toggle.click();
      await expect(reader).toHaveCount(0);
      await toggle.click();
    }
    await expect(reader).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.pager')).toHaveAttribute(
      'data-cfi',
      /^epubcfi/,
    );
    // Views parked mid-load are released once their loader finishes.
    await expect(page.locator('foliate-view')).toHaveCount(1);
    await expect(page.locator('[data-parked]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
