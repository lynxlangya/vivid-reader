import { test, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookStore } from '../src/main/content/book-store';
import { parseEpub, cfiAt } from '../src/main/content/epub';
import { buildEpub } from './fixtures/build-epub';
test('imports by content hash and serializes position writes across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-store-'));
  const store = new BookStore(dir);
  expect(await store.restore()).toBeNull();
  const book = await store.import(await buildEpub());
  expect(book.id).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(join(dir, 'books', `${book.id}.epub`))).toEqual(
    Buffer.from(book.bytes),
  );
  const chapter = parseEpub(book.bytes).chapters[0];
  const expected = cfiAt(chapter, 20);
  await Promise.all([
    store.savePosition(cfiAt(chapter, 10)),
    store.savePosition(expected),
  ]);
  expect((await new BookStore(dir).restore())?.currentCFI).toBe(expected);
  await expect(store.savePosition('invalid')).rejects.toThrow();
});
