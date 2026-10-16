import { ipcMain, dialog, app } from 'electron';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import {
  EmptySchema,
  ApiKeySchema,
  PositionSchema,
  ReviewSchema,
} from '../../shared/ipc';
import type { OpenBook } from '../../shared/book';
import type { PipelineStatus } from '../../shared/pipeline';
import { BookStore } from '../content/book-store';
import { parseEpub, cfiAt } from '../content/epub';
import { KeyStore } from '../llm/keys';
import { completeText } from '../llm/model';
import { openRepository } from '../db/repository';
import { runPipeline } from '../pipeline/pipeline';
import { WikidataClient } from '../wikidata/client';
export function registerIPC() {
  const dir = app.getPath('userData');
  const books = new BookStore(dir);
  const keys = new KeyStore(dir);
  const repo = openRepository(join(dir, 'vivid.sqlite'));
  const wiki = new WikidataClient(repo);
  let current: OpenBook | null = null;
  let queue = Promise.resolve();
  const states = new Map<string, PipelineStatus['state']>();
  const dev = !!process.env.ELECTRON_RENDERER_URL && !app.isPackaged;
  app.once('will-quit', () => repo.close());
  function start() {
    const book = current;
    if (!book || states.get(book.id) === 'running') return;
    states.set(book.id, 'running');
    queue = queue.then(async () => {
      try {
        const apiKey = (await keys.get()) ?? process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          states.set(book.id, 'missing-key');
          return;
        }
        await runPipeline(
          repo,
          {
            id: book.id,
            path: join(dir, 'books', `${book.id}.epub`),
            bytes: await readFile(join(dir, 'books', `${book.id}.epub`)),
          },
          (context) => completeText(context, apiKey),
          wiki,
          { limit: 2 },
        );
        states.set(
          book.id,
          repo.jobs(book.id).some((job) => job.status === 'failed')
            ? 'failed'
            : 'done',
        );
      } catch {
        states.set(book.id, 'failed');
      }
    });
  }
  function activate(book: OpenBook | null) {
    if (!book) {
      current = null;
      return null;
    }
    const parsed = parseEpub(book.bytes);
    repo.transaction(() => {
      repo.putBook({
        id: book.id,
        title: book.title,
        author: book.author,
        path: join(dir, 'books', `${book.id}.epub`),
      });
      parsed.chapters.forEach((chapter) => repo.putChapter(book.id, chapter));
    });
    const initial = cfiAt(parsed.chapters[0], 0);
    if (!repo.progress(book.id))
      repo.saveProgress(book.id, book.currentCFI ?? initial, initial);
    current = {
      ...book,
      currentCFI: repo.progress(book.id)?.current ?? book.currentCFI,
    };
    start();
    return current;
  }
  const handle = (
    channel: string,
    schema: TSchema,
    fn: (payload: unknown) => unknown,
  ) =>
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame)
        throw new Error('Untrusted IPC sender');
      if (!Value.Check(schema, payload)) throw new Error('Invalid IPC payload');
      return fn(payload);
    });
  handle('vivid:ping', EmptySchema, () => '历历');
  handle('vivid:import', EmptySchema, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    return result.canceled
      ? null
      : activate(await books.import(result.filePaths[0]));
  });
  handle('vivid:restore', EmptySchema, async () =>
    activate(await books.restore()),
  );
  handle('vivid:position', PositionSchema, async (payload) => {
    const cfi = (payload as { cfi: string }).cfi;
    await books.savePosition(cfi);
    if (current) {
      const progress = repo.progress(current.id)!;
      repo.saveProgress(current.id, cfi, progress.boundary);
    }
  });
  handle('vivid:set-key', ApiKeySchema, async (payload) => {
    await keys.set((payload as { value: string }).value);
    start();
  });
  handle('vivid:has-key', EmptySchema, () => keys.has());
  handle('vivid:clear-key', EmptySchema, () => keys.clear());
  handle('vivid:preprocess', EmptySchema, () => start());
  handle('vivid:pipeline-status', EmptySchema, (): PipelineStatus => ({
    state: current ? (states.get(current.id) ?? 'idle') : 'idle',
    chapters: current ? repo.chapters(current.id).length : 0,
    entities: current ? repo.report(current.id).extracted : 0,
    completedSteps: current
      ? repo.jobs(current.id).filter((job) => job.status === 'done').length
      : 0,
  }));
  handle('vivid:review', EmptySchema, () => {
    if (!dev) throw new Error('Review is development-only');
    return current ? repo.reviewRows(current.id) : [];
  });
  handle('vivid:mark-review', ReviewSchema, (payload) => {
    if (!dev) throw new Error('Review is development-only');
    const { entityId, correct } = payload as {
      entityId: string;
      correct: boolean;
    };
    if (
      !current ||
      !repo.reviewRows(current.id).some((entity) => entity.id === entityId)
    )
      throw new Error('Review entity is outside the first two chapters');
    repo.review(entityId, correct);
  });
}
