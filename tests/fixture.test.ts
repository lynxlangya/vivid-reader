import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { buildEpub } from './fixtures/build-epub';
test('builds a synthetic five-chapter EPUB outside the repository', async () => {
  const entries = unzipSync(await readFile(await buildEpub()));
  expect(strFromU8(entries.mimetype)).toBe('application/epub+zip');
  expect(strFromU8(entries['META-INF/container.xml'])).toContain(
    'EPUB/package.opf',
  );
  expect(strFromU8(entries['EPUB/package.opf'])).toContain('<spine>');
  expect(strFromU8(entries['EPUB/nav.xhtml'])).toContain('epub:type="toc"');
  expect(Object.keys(entries).filter((k) => /c\d.xhtml/.test(k))).toHaveLength(
    5,
  );
});
