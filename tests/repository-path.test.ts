import { test, expect, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BookStore } from '../src/main/content/book-store';
import { openRepository } from '../src/main/db/repository';
import { findRepositoryRoot } from '../src/main/content/repository-path';
import { buildEpub } from './fixtures/build-epub';

test('external storage and EPUB import work when launched from the filesystem root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-path-'));
  const file = await buildEpub();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/');
  try {
    const repo = openRepository(join(dir, 'vivid.sqlite'));
    repo.close();
    const book = await new BookStore(dir).import(file);
    expect(book.bytes).toEqual(await readFile(file));
    const root = resolve(import.meta.dirname, '..');
    expect(() => openRepository(join(root, 'forbidden.sqlite'))).toThrow(
      'outside the repository',
    );
    await expect(
      new BookStore(dir).import(join(root, 'forbidden.epub')),
    ).rejects.toThrow('outside the repository');
  } finally {
    cwd.mockRestore();
  }
});

test('a packaged app is not mistaken for a development repository ancestor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vivid-package-'));
  await mkdir(join(root, 'src/main'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'Synthetic repository');
  await writeFile(join(root, 'package.json'), '{"name":"vivid-reader"}');
  expect(findRepositoryRoot(join(root, 'src/main'))).toBe(await realpath(root));
  const packaged = join(root, 'release/app.asar');
  await mkdir(join(packaged, 'out/main'), { recursive: true });
  await writeFile(join(packaged, 'package.json'), '{"name":"vivid-reader"}');
  expect(findRepositoryRoot(join(packaged, 'out/main'))).toBeUndefined();
});
