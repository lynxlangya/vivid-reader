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
