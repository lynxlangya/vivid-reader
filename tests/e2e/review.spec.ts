import { launchIsolated } from './helpers';
import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildEpub } from '../fixtures/build-epub';
import { parseEpub } from '../../src/main/content/epub';
import type { Repository } from '../../src/main/db/repository';
test('opens the development review page and persists genuine manual marks', async () => {
  const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      fs: { allow: [resolve('.')] },
    },
  });
  await server.listen();
  try {
    const module = (await server.ssrLoadModule(
      resolve('src/main/db/repository.ts'),
    )) as { openRepository: (path: string) => Repository };
    const dir = await mkdtemp(join(tmpdir(), 'vivid-review-e2e-'));
    const path = await buildEpub();
    const bytes = await readFile(path);
    const id = createHash('sha256').update(bytes).digest('hex');
    const parsed = parseEpub(bytes);
    await mkdir(join(dir, 'books'));
    await copyFile(path, join(dir, 'books', `${id}.epub`));
    await writeFile(join(dir, 'reader.json'), JSON.stringify({ id }));
    const repo = module.openRepository(join(dir, 'vivid.sqlite'));
    repo.putBook({ id, title: parsed.title, author: parsed.author, path });
    parsed.chapters.forEach((chapter) => repo.putChapter(id, chapter));
    const entityId = createHash('sha256')
      .update('synthetic-review-entity')
      .digest('hex');
    repo.putEntity({
      id: entityId,
      bookId: id,
      type: 'place',
      name: '纸湾',
      original: 'Synthetic Bay',
      aliases: ['纸湾'],
      importance: 0.9,
      note: 'PRIVATE-EXTRACTION-NOTE',
      chapters: [0],
      candidates: [],
      confidence: 0,
      status: 'unlinked',
      review: null,
    });
    repo.close();
    const app = await launchIsolated(dir, {
      ELECTRON_RENDERER_URL: server.resolvedUrls!.local[0],
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole('button', { name: '开发核对', exact: true }).click();
      const review = page.getByRole('dialog', { name: '抽取核对' });
      await expect(
        review.getByRole('heading', { name: '纸湾 Synthetic Bay' }),
      ).toBeVisible();
      await expect(
        review.getByText('核对：未标记', { exact: true }),
      ).toBeVisible();
      expect(await review.textContent()).not.toContain(
        'PRIVATE-EXTRACTION-NOTE',
      );
      await review.getByRole('button', { name: '错', exact: true }).click();
      await expect(review.getByText('核对：错', { exact: true })).toBeVisible();
      await review.getByRole('button', { name: '对', exact: true }).click();
      await expect(review.getByText('核对：对', { exact: true })).toBeVisible();
    } finally {
      await app.close();
    }
    const reopened = module.openRepository(join(dir, 'vivid.sqlite'));
    expect(reopened.entities(id)[0].review).toBe(true);
    reopened.close();
  } finally {
    await server.close();
  }
});
