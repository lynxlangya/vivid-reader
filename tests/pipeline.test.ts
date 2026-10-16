import { test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openRepository } from '../src/main/db/repository';
import { runPipeline, mergeExtractions } from '../src/main/pipeline/pipeline';
import {
  chunkChapter,
  structured,
  ExtractionSchema,
} from '../src/main/pipeline/extract';
import { parseEpub } from '../src/main/content/epub';
import { WikidataClient, USER_AGENT } from '../src/main/wikidata/client';
import { buildEpub } from './fixtures/build-epub';
import { fakeModel } from './fixtures/faux-model';
import entities from './fixtures/wikidata-entities.json';
import search from './fixtures/wikidata-search.json';
import search2 from './fixtures/wikidata-search-2.json';
import countries from './fixtures/wikidata-countries.json';
const raw = {
  surface: '纸湾',
  type: 'place' as const,
  original_name_guess: 'Berlin',
  aliases_in_text: ['纸湾镇'],
  importance: 0.9,
  note: 'PRIVATE-EXTRACTION-NOTE',
};
const extraction = JSON.stringify({ entities: [raw] });
const fetchFixture = vi.fn<typeof fetch>(async (input) => {
  const params = new URL(String(input)).searchParams;
  if (params.get('action') === 'wbsearchentities')
    return Response.json({ search: search.search.slice(0, 1) });
  const ids = (params.get('ids') ?? '').split('|');
  return Response.json({
    entities: Object.fromEntries(
      Object.entries(entities.entities).filter(([id]) => ids.includes(id)),
    ),
  });
});
async function input() {
  const path = await buildEpub();
  const bytes = await readFile(path);
  return { path, bytes, id: createHash('sha256').update(bytes).digest('hex') };
}
test('runs all four steps on synthetic EPUB, resumes after interruption, and preserves manual corrections', async () => {
  const repo = openRepository(':memory:');
  const book = await input();
  const wiki = new WikidataClient(repo, fetchFixture, async () => {});
  const first = fakeModel([extraction]);
  try {
    await expect(
      runPipeline(repo, book, first.complete, wiki, {
        limit: 2,
        afterStep: (step) => {
          if (step === 'extract:0') throw new Error('Synthetic interruption');
        },
      }),
    ).rejects.toThrow();
    expect(repo.chapters(book.id)).toHaveLength(5);
    expect(repo.chunks(`${book.id}:0`)).toHaveLength(1);
    const next = fakeModel([extraction]);
    const report = await runPipeline(repo, book, next.complete, wiki, {
      limit: 2,
    });
    expect(next.provider.state.callCount).toBe(1);
    expect(report.extracted).toBe(1);
    expect(report.linked).toBe(1);
    expect(report.linkAccuracy).toBe('待人工核对');
    const entity = repo.entities(book.id)[0];
    repo.correct(entity.id, 'type', 'concept');
    repo.review(entity.id, false);
    const rerun = fakeModel([extraction, extraction]);
    await runPipeline(repo, book, rerun.complete, wiki, {
      limit: 2,
      rerun: true,
    });
    expect(repo.entities(book.id)[0].type).toBe('concept');
    expect(repo.correctionCount()).toBe(1);
    expect(repo.entities(book.id)[0].review).toBe(false);
    expect(JSON.stringify(repo.reviewRows(book.id))).not.toContain(raw.note);
    expect(repo.jobs(book.id).every((job) => job.status === 'done')).toBe(true);
    const noCalls = fakeModel([]);
    await runPipeline(repo, book, noCalls.complete, wiki, { limit: 2 });
    expect(noCalls.provider.state.callCount).toBe(0);
  } finally {
    repo.close();
  }
});
test('validates model output with bounded retries and keeps fixed instructions before chapter data', async () => {
  let inspected = false;
  const fake = fakeModel([
    'invalid JSON',
    JSON.stringify({ entities: [{ ...raw, offset: 123 }] }),
    (context) => {
      const serialized = JSON.stringify(context);
      expect(serialized.indexOf('JSON schema')).toBeLessThan(
        serialized.indexOf('SYNTHETIC-CHAPTER-END'),
      );
      inspected = true;
      return {
        role: 'assistant',
        api: 'faux',
        provider: 'faux',
        model: 'faux-1',
        content: [{ type: 'text', text: extraction }],
        stopReason: 'stop',
        timestamp: 0,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
    },
  ]);
  const result = await structured(
    fake.complete,
    ExtractionSchema,
    'Fixed instruction',
    'SYNTHETIC-CHAPTER-END',
    () => {},
  );
  expect(result.entities).toHaveLength(1);
  expect(inspected).toBe(true);
  expect(fake.provider.state.callCount).toBe(3);
  const invalid = fakeModel(['{}', '{}', '{}']);
  await expect(
    structured(invalid.complete, ExtractionSchema, 'fixed', 'text', () => {}),
  ).rejects.toThrow();
  expect(invalid.provider.state.callCount).toBe(3);
});
test('merges textual aliases and original names without trusting model offsets', () => {
  const result = mergeExtractions('synthetic', [
    { chapter: 0, entity: raw },
    { chapter: 1, entity: { ...raw, surface: '纸湾镇' } },
  ]);
  expect(result).toHaveLength(1);
  expect(result[0].chapters).toEqual([0, 1]);
  expect(result[0].aliases).toContain('纸湾镇');
});
test('chunks at paragraph boundaries, retains overlap, and bounds oversized paragraphs', async () => {
  const book = parseEpub((await input()).bytes);
  const chapter = book.chapters[0];
  expect(chapter.blocks!.length).toBeGreaterThan(10);
  const chunks = chunkChapter(chapter, 150, 20);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 150)).toBe(true);
  expect(chunks[0].slice(-20)).toBe(chunks[1].slice(0, 20));
});
test('uses recorded responses, cache, a named User-Agent, global concurrency <= 2, and bounded backoff', async () => {
  expect(USER_AGENT).toMatch(/^Vivid\/[\d.]+ \(.*https:\/\/\S+\)$/);
  const repo = openRepository(':memory:');
  let concurrent = 0,
    max = 0;
  let attempts = 0;
  const waits: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    expect(options?.headers).toMatchObject({ 'User-Agent': USER_AGENT });
    expect(new URL(String(input)).searchParams.has('maxlag')).toBe(false);
    concurrent++;
    max = Math.max(max, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 2));
    concurrent--;
    attempts++;
    if (attempts === 1) return new Response('', { status: 429 });
    return Response.json({ search: search.search });
  });
  try {
    const client = new WikidataClient(repo, fetcher, async (ms) => {
      waits.push(ms);
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        client.request({
          action: 'wbsearchentities',
          search: String(i),
          language: 'zh',
        }),
      ),
    );
    expect(max).toBeLessThanOrEqual(2);
    expect(waits[0]).toBe(300);
    const count = fetcher.mock.calls.length;
    await client.request({
      action: 'wbsearchentities',
      search: '0',
      language: 'zh',
    });
    expect(fetcher.mock.calls.length).toBe(count);
    const failing = vi.fn<typeof fetch>(
      async () => new Response('', { status: 503 }),
    );
    await expect(
      new WikidataClient(repo, failing, async () => {}).request({
        action: 'fail',
      }),
    ).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(4);
  } finally {
    repo.close();
  }
});

test.each([0.96, 0.4])(
  'disambiguates multiple recorded candidates through fauxProvider, confidence %s',
  async (confidence) => {
    const repo = openRepository(':memory:');
    const book = await input();
    const fetcher = vi.fn<typeof fetch>(async (value) => {
      const params = new URL(String(value)).searchParams;
      if (params.get('action') === 'wbsearchentities')
        return Response.json({
          search: (params.get('language') === 'zh'
            ? search.search
            : search2.search
          ).slice(0, 1),
        });
      if (params.get('props') === 'labels') return Response.json(countries);
      return Response.json(entities);
    });
    const fake = fakeModel([
      JSON.stringify({ entities: [{ ...raw, original_name_guess: 'London' }] }),
      JSON.stringify({ qid: 'Q64', confidence }),
    ]);
    try {
      const report = await runPipeline(
        repo,
        book,
        fake.complete,
        new WikidataClient(repo, fetcher, async () => {}),
        { limit: 1 },
      );
      expect(fake.provider.state.callCount).toBe(2);
      expect(report.linked).toBe(confidence >= 0.8 ? 1 : 0);
      expect(repo.entities(book.id)[0].candidates).toHaveLength(2);
      expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      repo.close();
    }
  },
);

test('coalesces matching external identities while retaining any manually overridden entity', async () => {
  const repo = openRepository(':memory:');
  const book = await input();
  try {
    const candidate = {
      qid: 'Q64',
      label: 'External fixture',
      original: 'External fixture',
      description: 'Public geographic fixture',
      types: [],
      lat: 52.5,
      lon: 13.4,
    };
    const first = mergeExtractions(book.id, [{ chapter: 0, entity: raw }])[0];
    const second = mergeExtractions(book.id, [
      {
        chapter: 1,
        entity: {
          ...raw,
          surface: '木坡',
          original_name_guess: 'Other',
          aliases_in_text: [],
        },
      },
    ])[0];
    repo.putBook({
      id: book.id,
      title: '合成测试',
      author: '合成测试',
      path: book.path,
    });
    repo.putEntity({ ...first, linked: candidate, status: 'linked' });
    repo.putEntity({ ...second, linked: candidate, status: 'linked' });
    repo.correct(first.id, 'type', 'concept');
    repo.coalesceSameQid(book.id);
    expect(repo.entities(book.id)).toHaveLength(2);
    const isolated = openRepository(':memory:');
    try {
      isolated.putBook({
        id: book.id,
        title: '合成测试',
        author: '合成测试',
        path: book.path,
      });
      isolated.putEntity({ ...first, linked: candidate, status: 'linked' });
      isolated.putEntity({ ...second, linked: candidate, status: 'linked' });
      isolated.coalesceSameQid(book.id);
      expect(isolated.entities(book.id)).toHaveLength(1);
      expect(isolated.entities(book.id)[0].chapters.sort()).toEqual([0, 1]);
    } finally {
      isolated.close();
    }
  } finally {
    repo.close();
  }
});

test('keeps exhausted network links unlinked and retryable without repeating paid extraction', async () => {
  const repo = openRepository(':memory:');
  const book = await input();
  const model = fakeModel([extraction]);
  try {
    const failing = new WikidataClient(
      repo,
      async () => new Response('', { status: 503 }),
      async () => {},
    );
    const result = await runPipeline(repo, book, model.complete, failing, {
      limit: 1,
    });
    expect(result.unlinkedRatio).toBe(1);
    expect(repo.jobs(book.id).some((job) => job.status === 'failed')).toBe(
      true,
    );
    const resumed = fakeModel([]);
    const linked = await runPipeline(
      repo,
      book,
      resumed.complete,
      new WikidataClient(repo, fetchFixture, async () => {}),
      { limit: 1 },
    );
    expect(linked.linked).toBe(1);
    expect(resumed.provider.state.callCount).toBe(0);
  } finally {
    repo.close();
  }
});

test('publishes completed chapter mentions before all extraction and supports all five chapters', async () => {
  const repo = openRepository(':memory:');
  const book = await input();
  const model = fakeModel(Array.from({ length: 5 }, () => extraction));
  let firstReady = false;
  try {
    await runPipeline(
      repo,
      book,
      model.complete,
      new WikidataClient(repo, fetchFixture, async () => {}),
      {
        limit: 5,
        afterStep: (step) => {
          if (step === 'ready:0') {
            firstReady = true;
            expect(repo.entities(book.id)).toHaveLength(1);
            expect(repo.mentions(book.id).some((m) => m.chapter === 0)).toBe(
              true,
            );
            expect(repo.mentions(book.id).some((m) => m.chapter > 0)).toBe(
              false,
            );
          }
        },
      },
    );
    expect(firstReady).toBe(true);
    expect(model.provider.state.callCount).toBe(5);
    expect(repo.entities(book.id)[0].chapters).toEqual([0, 1, 2, 3, 4]);
    const linked = repo.entities(book.id)[0].linked;
    const resumed = fakeModel([]);
    await runPipeline(
      repo,
      book,
      resumed.complete,
      new WikidataClient(repo, fetchFixture, async () => {}),
      { limit: 5 },
    );
    expect(resumed.provider.state.callCount).toBe(0);
    expect(repo.entities(book.id)[0].linked).toEqual(linked);
  } finally {
    repo.close();
  }
});
