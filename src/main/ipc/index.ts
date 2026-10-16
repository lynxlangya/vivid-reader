import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import {
  EmptySchema,
  ApiKeySchema,
  PositionSchema,
  ReviewSchema,
  RelocateSchema,
  IdSchema,
  GlossSchema,
  CorrectSchema,
  WikiSearchSchema,
  AskSchema,
  SelectionSchema,
} from '../../shared/ipc';
import type { OpenBook } from '../../shared/book';
import type { PipelineStatus } from '../../shared/pipeline';
import { BookStore, type StoredBook } from '../content/book-store';
import { parseEpub, cfiAt } from '../content/epub';
import { KeyStore } from '../llm/keys';
import { completeText, models, getTextModel } from '../llm/model';
import { openRepository } from '../db/repository';
import { runPipeline } from '../pipeline/pipeline';
import { WikidataClient } from '../wikidata/client';
import { registerBookDisplay } from '../content/display';
import { ContentGateway } from '../content/gateway';
import { GlossService } from '../content/gloss';
import {
  advanceBoundary,
  DWELL_MS,
  type BoundaryState,
} from '../boundary/state';
import type { Navigation } from '../../shared/reading';
import type { WikiCandidate } from '../../shared/entity';
import type { AskRequest, SelectionRange } from '../../shared/companion';
import { CompanionService } from '../agent/companion';
import { testCompanionBackend } from '../agent/testing';
export function registerIPC() {
  const dir = app.getPath('userData');
  const books = new BookStore(dir);
  const keys = new KeyStore(dir);
  const repo = openRepository(join(dir, 'vivid.sqlite'));
  const wiki = new WikidataClient(repo);
  let current: StoredBook | null = null;
  const displayURL = registerBookDisplay(dir, () => current?.id);
  let boundary: BoundaryState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gloss: GlossService | undefined;
  let companion: CompanionService | undefined;
  const candidates = new Map<string, WikiCandidate[]>();
  const gateway = () => {
    if (!current) throw new Error('No current book');
    return new ContentGateway(repo, current.id);
  };
  const notify = () => {
    if (!current) return;
    const state = gateway().state(current.currentCFI);
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send('vivid:state', state);
  };
  const persist = () => {
    if (!current || !boundary) return;
    current.currentCFI = boundary.currentCFI;
    repo.saveProgress(current.id, boundary.currentCFI, boundary.boundaryCFI);
    void books.savePosition(boundary.currentCFI).catch(() => {});
  };
  const visibleEntity = (id: string) => {
    if (!gateway().card(id)) throw new Error('Entity is outside read boundary');
    const mention = repo.mentions(current!.id).find((x) => x.id === id)!;
    return repo.entities(current!.id).find((x) => x.id === mention.entityId)!;
  };
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
        notify();
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
  function activate(book: StoredBook | null) {
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
    companion?.cancel();
    clearTimeout(timer);
    current = { ...book, currentCFI: repo.progress(book.id)!.current };
    boundary = {
      currentCFI: current.currentCFI!,
      boundaryCFI: repo.progress(book.id)!.boundary,
    };
    const content = gateway();
    gloss = new GlossService(repo, content, async (context) => {
      const key = (await keys.get()) ?? process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error('No model key');
      return completeText(context, key);
    });
    const backend =
      !app.isPackaged && process.env.VIVID_TEST_AGENT === 'faux'
        ? testCompanionBackend()
        : {
            model: getTextModel(),
            streamFn: models.streamSimple.bind(models),
            getApiKey: async () =>
              (await keys.get()) ?? process.env.DEEPSEEK_API_KEY,
          };
    companion = new CompanionService(repo, content, backend);
    start();
    const result: OpenBook = {
      id: book.id,
      title: book.title,
      author: book.author,
      url: displayURL(book.id),
      currentCFI: current.currentCFI,
      fresh: !book.currentCFI,
      marks: content.state(current.currentCFI).marks,
    };
    return result;
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
  handle('vivid:position', PositionSchema, (payload) => {
    if (!boundary) return;
    const cfi = (payload as { cfi: string }).cfi;
    gateway().position(cfi);
    boundary = advanceBoundary(boundary, {
      type: 'relocate',
      cfi,
      mode: 'jump',
      now: Date.now(),
    }).state;
    persist();
  });
  handle('vivid:relocate', RelocateSchema, (payload) => {
    const { cfi, mode } = payload as { cfi: string; mode: Navigation };
    gateway().position(cfi);
    gateway().position(cfi, true);
    boundary = advanceBoundary(boundary!, {
      type: 'relocate',
      cfi,
      mode,
      now: Date.now(),
    }).state;
    persist();
    clearTimeout(timer);
    if (boundary.pending)
      timer = setTimeout(() => {
        boundary = advanceBoundary(boundary!, {
          type: 'dwell',
          now: Date.now(),
        }).state;
        persist();
        notify();
      }, DWELL_MS + 10);
    const state = gateway().state(cfi);
    for (const id of gateway().prefetch(state.currentChapter))
      void gloss?.ensure(id);
    return state;
  });
  handle('vivid:reader-state', EmptySchema, () =>
    current ? gateway().state(current.currentCFI) : null,
  );
  handle('vivid:boundary', PositionSchema, (payload) => {
    const cfi = gateway().position((payload as { cfi: string }).cfi, true).cfi;
    const result = advanceBoundary(boundary!, { type: 'manual', cfi });
    boundary = result.state;
    if (result.archive) {
      companion?.cancel();
      repo.archiveConversations(current!.id);
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('vivid:companion', companion!.history());
    }
    clearTimeout(timer);
    persist();
    notify();
    return gateway().state(current!.currentCFI);
  });
  handle('vivid:card', IdSchema, (payload) =>
    gloss!.card((payload as { id: string }).id),
  );
  handle('vivid:gloss', GlossSchema, async (payload) => {
    const { id, retry } = payload as { id: string; retry: boolean };
    await gloss!.ensure(id, retry);
    return gloss!.card(id);
  });
  handle('vivid:known', IdSchema, (payload) => {
    const entity = visibleEntity((payload as { id: string }).id);
    repo.setKnown(current!.id, entity.id);
    notify();
  });
  handle('vivid:correct', CorrectSchema, (payload) => {
    const { id, action, qid } = payload as {
      id: string;
      action: 'link' | 'concept' | 'hide';
      qid?: string;
    };
    const entity = visibleEntity(id);
    if (action === 'link') {
      const chosen = [...entity.candidates, ...(candidates.get(id) ?? [])].find(
        (x) => x.qid === qid,
      );
      if (!chosen) throw new Error('Choose a verified candidate');
      repo.correct(entity.id, 'linked', chosen);
    } else
      repo.correct(
        entity.id,
        action === 'concept' ? 'type' : 'hidden',
        action === 'concept' ? 'concept' : true,
      );
    notify();
  });
  handle('vivid:candidates', WikiSearchSchema, async (payload) => {
    const { id, query } = payload as { id: string; query: string };
    visibleEntity(id);
    const found = await wiki.search(query, query);
    if (!gateway().card(id)) return [];
    candidates.set(id, found);
    return found;
  });
  handle('vivid:ask', AskSchema, async (payload) => {
    if (!companion) throw new Error('Open a book first');
    await companion.ask(payload as AskRequest, (update) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('vivid:companion', update);
    });
  });
  handle(
    'vivid:conversation',
    EmptySchema,
    () => companion?.history() ?? { messages: [], busy: false },
  );
  handle('vivid:selection', SelectionSchema, (payload) => {
    const range = payload as SelectionRange;
    try {
      return gateway().selectionAllowed(range.start, range.end);
    } catch {
      return false;
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
