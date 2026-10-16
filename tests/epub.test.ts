import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildEpub } from './fixtures/build-epub';
import {
  parseEpub,
  cfiAt,
  cfiRangeAt,
  sampleOffsets,
} from '../src/main/content/epub';
import { compareCFI } from '../src/shared/cfi';
test('maps decoded XHTML text to stable CFI runs in the main process', async () => {
  const book = parseEpub(await readFile(await buildEpub()));
  expect(book.chapters).toHaveLength(5);
  const c = book.chapters[0];
  expect(c.text).toContain('复杂内联文字 & 空格。😀');
  expect(c.runs.length).toBeGreaterThan(16);
  expect(compareCFI(cfiAt(c, 3), cfiAt(c, 4))).toBeLessThan(0);
  const decoded = c.text.indexOf('& 空格');
  expect(compareCFI(cfiAt(c, decoded), cfiAt(c, decoded + 1))).toBeLessThan(0);
  expect(compareCFI(cfiAt(c, decoded + 1), cfiAt(c, decoded + 2))).toBeLessThan(
    0,
  );
  expect(cfiRangeAt(c, 3, 5)).toContain('epubcfi(');
  expect(sampleOffsets(book)).toHaveLength(200);
  expect(() => cfiAt(c, -1)).toThrow();
  expect(() => cfiAt(c, c.text.length + 1)).toThrow();
  expect(() => cfiRangeAt(c, 4, 3)).toThrow();
});

test('normalizes CR and CRLF line endings as the XML parser in Chromium does', async () => {
  const parse = async (lineEnding: '\n' | '\r\n' | '\r') =>
    parseEpub(await readFile(await buildEpub({ lineEnding })));
  const lf = await parse('\n');
  expect(lf.chapters[0].text).toContain('文字 \n& 空格');
  for (const lineEnding of ['\r\n', '\r'] as const) {
    const book = await parse(lineEnding);
    expect(book.chapters.some((c) => c.text.includes('\r'))).toBe(false);
    expect(book.chapters).toEqual(lf.chapters);
  }
});

test('image-only spine entries have structural positions and do not poison text sampling', async () => {
  const { openRepository } = await import('../src/main/db/repository');
  const { ContentGateway } = await import('../src/main/content/gateway');
  const book = parseEpub(
    await readFile(await buildEpub({ imageOnlyCover: true })),
  );
  const repo = openRepository(':memory:');
  try {
    const id = 'a'.repeat(64);
    repo.putBook({ id, title: 'Synthetic', author: '', path: 'synthetic' });
    book.chapters.forEach((chapter) => repo.putChapter(id, chapter));
    const [cover, text] = repo.chapters(id);
    expect(cover.text).toBe('');
    const start = cfiAt(cover, 0);
    expect(cfiRangeAt(cover, 0, 0)).toBe(start);
    expect(compareCFI(start, cfiAt(text, 0))).toBeLessThan(0);
    repo.saveProgress(id, start, start);
    const gateway = new ContentGateway(repo, id);
    expect(gateway.state().currentChapter).toBe(0);
    expect(gateway.read(start, cfiAt(text, 10))).toEqual([]);
    const imagePoint = start.replace(/:0\)$/, '/2)');
    expect(gateway.position(imagePoint).cfi).toBe(start);
    expect(() => gateway.position('epubcfi(/6/999!/4/2)')).toThrow();
    repo.saveProgress(id, cfiAt(text, 0), cfiAt(text, 10));
    expect(gateway.read(start, cfiAt(text, 20))[0].text).toBe(
      text.text.slice(0, 10),
    );
    expect(gateway.fractionCFI(0)).toBe(cfiAt(text, 0));
    expect(sampleOffsets(book)).toHaveLength(200);
    expect(
      sampleOffsets(book).every((sample) => sample.expected.length === 1),
    ).toBe(true);
    expect(sampleOffsets({ ...book, chapters: [cover] })).toEqual([]);
  } finally {
    repo.close();
  }
});
