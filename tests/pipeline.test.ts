import { test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openRepository } from '../src/main/db/repository';
import { runPipeline, mergeExtractions } from '../src/main/pipeline/pipeline';
import {
  chunkChapter,
  groundExtraction,
  structured,
  ExtractionSchema,
} from '../src/main/pipeline/extract';
import { parseEpub } from '../src/main/content/epub';
import {
  WikidataClient,
  WikidataUnavailableError,
  USER_AGENT,
} from '../src/main/wikidata/client';
import { mentionExcerpts } from '../src/main/pipeline/mentions';
import type { Chapter } from '../src/shared/book';
import { buildEpub } from './fixtures/build-epub';
import { fakeModel } from './fixtures/faux-model';
import { wikidataServer, wikidataRecords } from './fixtures/wikidata-server';
import { fauxAssistantMessage, type Context } from '@earendil-works/pi-ai';
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
    // The script returns the same entity for every chapter; only chapter 0's
    // text names it, so the other chapters drop it.
    expect(repo.entities(book.id)[0].chapters).toEqual([0]);
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
test('keeps only extracted forms that occur in the text', () => {
  const text = '旅人走进了纸湾。北岸的灯塔亮着。';
  const grounded = groundExtraction(
    [
      { ...raw, aliases_in_text: ['纸湾镇', ' '] },
      { ...raw, surface: '北岸灯塔', aliases_in_text: ['灯塔', '北岸'] },
      { ...raw, surface: '雾岛', aliases_in_text: ['雾岛港'] },
    ],
    text,
  );
  expect(grounded.map((e) => [e.surface, e.aliases_in_text])).toEqual([
    ['纸湾', []],
    ['灯塔', ['北岸']],
  ]);
  expect(grounded[0].original_name_guess).toBe(raw.original_name_guess);
});
test('never stores or links entities the chapter text does not name, and skips chapters without body text', async () => {
  const repo = openRepository(':memory:');
  const path = await buildEpub({ imageOnlyCover: true });
  const bytes = await readFile(path);
  const book = {
    path,
    bytes,
    id: createHash('sha256').update(bytes).digest('hex'),
  };
  // A later chapter's place, offered from outside knowledge while reading chapter 0.
  const outside = { ...raw, surface: '雾岛', aliases_in_text: [] };
  // Only in the second text chapter, which sits at spine index 2.
  const slope = { ...raw, surface: '山坡', original_name_guess: '' };
  const model = fakeModel([
    JSON.stringify({ entities: [raw, outside] }),
    JSON.stringify({ entities: [slope, outside] }),
  ]);
  const searches: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const params = new URL(String(input)).searchParams;
    if (params.get('action') === 'wbsearchentities')
      searches.push(params.get('search') ?? '');
    return fetchFixture(input, options);
  });
  try {
    await runPipeline(
      repo,
      book,
      model.complete,
      new WikidataClient(repo, fetcher, async () => {}),
      { limit: 2, minChars: 20 },
    );
    // The image-only cover is skipped; the two text chapters are extracted.
    expect(model.provider.state.callCount).toBe(2);
    expect(repo.chunks(`${book.id}:0`)).toEqual([]);
    const stored = (index: number) =>
      repo
        .chunks(`${book.id}:${index}`)
        .flat()
        .map((e) => e.surface);
    expect([stored(1), stored(2)]).toEqual([['纸湾'], ['山坡']]);
    expect(searches).toEqual(expect.arrayContaining(['纸湾', '山坡']));
    expect(searches).not.toContain('雾岛');
    expect(
      repo
        .rawEntities(book.id)
        .some((e) => e.name === '雾岛' || e.aliases.includes('雾岛')),
    ).toBe(false);
  } finally {
    repo.close();
  }
});
// Three entities over two chapters: one needs the model to choose, one has a
// single plausible candidate, and one has none. Candidates share states.
const linkSearches = {
  'zh:纸湾': ['Q64'],
  'en:Berlin': ['Q64', 'Q84'],
  'zh:山坡': ['Q84'],
  'en:London': ['Q84'],
  'zh:阿林': ['Q64', 'Q404404'],
};
const linkExtractions = [
  JSON.stringify({
    entities: [
      raw,
      {
        ...raw,
        surface: '阿林',
        type: 'person',
        original_name_guess: '',
        aliases_in_text: [],
        note: 'PRIVATE-PERSON-NOTE',
      },
    ],
  }),
  JSON.stringify({
    entities: [
      {
        ...raw,
        surface: '山坡',
        original_name_guess: 'London',
        aliases_in_text: [],
        note: 'PRIVATE-SLOPE-NOTE',
      },
    ],
  }),
];
test('links several entities with unchanged results, batched lookups and bounded excerpts', async () => {
  const repo = openRepository(':memory:');
  const book = await input();
  const server = wikidataServer(linkSearches);
  const contexts: Context[] = [];
  const model = fakeModel([
    ...linkExtractions,
    (context) => {
      contexts.push(context);
      return fauxAssistantMessage(
        JSON.stringify({ qid: 'Q64', confidence: 0.95 }),
      );
    },
  ]);
  try {
    const report = await runPipeline(
      repo,
      book,
      model.complete,
      new WikidataClient(repo, server.fetcher, async () => {}),
      { limit: 2 },
    );
    expect(report.linked).toBe(2);
    // Written by the code before batching; the stored results must not move.
    const summary = repo
      .entities(book.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entity) => ({
        name: entity.name,
        status: entity.status,
        confidence: entity.confidence,
        linked: entity.linked?.qid,
        candidates: entity.candidates,
      }));
    expect(summary).toMatchSnapshot();
    // One request per lookup stage instead of one per entity and stage (the
    // code before batching made 6 searches and 9 entity requests here).
    expect([
      server.count('wbsearchentities'),
      server.count('wbgetentities'),
      server.count('wbgetclaims'),
    ]).toEqual([6, 3, 4]);
    expect(server.maxInFlight()).toBe(2);
    expect(contexts).toHaveLength(1);
    const serialized = JSON.stringify(contexts[0]);
    const prompt = JSON.parse(
      String(contexts[0].messages.find((x) => x.role === 'user')?.content),
    ) as {
      entity: { hint: string };
      excerpts: string[];
      candidates: Record<string, unknown>[];
    };
    const chapter = repo.chapters(book.id)[0].text;
    expect(serialized.indexOf('JSON schema')).toBeLessThan(
      serialized.indexOf(raw.note),
    );
    expect(prompt.entity.hint).toBe(raw.note);
    expect(prompt.excerpts.length).toBeGreaterThan(0);
    expect(prompt.excerpts.every((x) => chapter.includes(x))).toBe(true);
    expect(prompt.excerpts.every((x) => x.includes('纸湾'))).toBe(true);
    expect(prompt.excerpts.join('').length).toBeLessThan(chapter.length);
    expect(serialized).not.toContain('SENTINEL');
    expect(prompt.candidates.map((x) => x.qid)).toEqual(['Q64', 'Q84']);
    expect(prompt.candidates.some((x) => 'capital' in x || 'image' in x)).toBe(
      false,
    );
    // Another book naming the same places needs no requests at all.
    const requests = server.log.length;
    await new WikidataClient(repo, server.fetcher, async () => {}).searchMany([
      { surface: '纸湾', original: 'Berlin' },
      { surface: '山坡', original: 'London' },
    ]);
    expect(server.log.length).toBe(requests);
  } finally {
    repo.close();
  }
});
test('batches entity lookups at 50 ids and fails only the searches a failed lookup touches', async () => {
  const repo = openRepository(':memory:');
  // Four searches with 16 distinct, unrecorded ids each: 64 ids in all.
  const searches: Record<string, string[]> = {};
  for (let i = 0; i < 4; i++)
    for (const [j, language] of ['zh', 'en'].entries())
      searches[`${language}:${language}${i}`] = Array.from(
        { length: 8 },
        (_, k) => `Q${1000 + i * 16 + j * 8 + k}`,
      );
  const server = wikidataServer(searches);
  try {
    const found = await new WikidataClient(
      repo,
      server.fetcher,
      async () => {},
    ).searchMany(
      Array.from({ length: 4 }, (_, i) => ({
        surface: `zh${i}`,
        original: `en${i}`,
      })),
    );
    expect(found.map((x) => (Array.isArray(x) ? x.length : x))).toEqual([
      16, 16, 16, 16,
    ]);
    const batches = server.log.filter((x) => x.action === 'wbgetentities');
    expect(batches.map((x) => x.ids.length)).toEqual([50, 14]);
    expect(new Set(batches.flatMap((x) => x.ids)).size).toBe(64);
    expect(server.count('wbgetclaims')).toBe(0);
    const isolated = openRepository(':memory:');
    const shared = wikidataServer(linkSearches);
    const failing = vi.fn<typeof fetch>(async (value, options) =>
      new URL(String(value)).searchParams.get('entity') === 'Q2277'
        ? new Response('', { status: 503 })
        : shared.fetcher(value, options),
    );
    try {
      const [person, slope] = await new WikidataClient(
        isolated,
        failing,
        async () => {},
      ).searchMany([
        { surface: '阿林', original: '' },
        { surface: '山坡', original: 'London' },
      ]);
      expect(Array.isArray(person) && person.map((x) => x.qid)).toEqual([
        'Q64',
        'Q404404',
      ]);
      expect(slope).toBeInstanceOf(WikidataUnavailableError);
    } finally {
      isolated.close();
    }
  } finally {
    repo.close();
  }
});
test('follows a redirected state the way full entity lookups did', async () => {
  const repo = openRepository(':memory:');
  const server = wikidataServer(
    { 'zh:纸湾': ['Q64'] },
    {
      ...wikidataRecords,
      Q148500: {
        id: 'Q148500',
        labels: { zh: { value: '合成国乙' } },
        claims: {
          P36: [{ mainsnak: { datavalue: { value: { id: 'Q900002' } } } }],
        },
      },
    },
    { Q148499: 'Q148500' },
  );
  try {
    const [found] = await new WikidataClient(
      repo,
      server.fetcher,
      async () => {},
    ).searchMany([{ surface: '纸湾', original: '' }]);
    expect(Array.isArray(found) && found[0]).toMatchObject({
      qid: 'Q64',
      country: '合成国乙',
      capital: { name: 'Fixture Capital B', lat: 41.9, lon: 12.5 },
    });
    // One refusal, then a single-entity lookup; no retries.
    expect(
      server.log.filter((x) => x.ids.includes('Q148499')).map((x) => x.action),
    ).toEqual(['wbgetentities', 'wbgetclaims', 'wbgetentities']);
  } finally {
    repo.close();
  }
});
test('bounds disambiguation excerpts to first mentions in the chapters of the run', () => {
  const filler = '风从田野吹过，'.repeat(60);
  const chapter = (index: number, text: string) =>
    ({ id: `synthetic:${index}`, index, text }) as Chapter;
  const first = chapter(
    0,
    `${filler}旅人走进了纸湾。${filler}纸湾镇的桥。${filler}又回到纸湾。${filler}`,
  );
  const second = chapter(1, `${filler}纸湾的码头。${filler}`);
  const later = chapter(2, 'SENTINEL-LATER-CHAPTER 纸湾');
  const entity = { name: '纸湾', aliases: ['纸湾镇'], chapters: [0, 1, 2] };
  const excerpts = mentionExcerpts([first, second], entity);
  expect(excerpts.join('').length).toBeLessThanOrEqual(1200);
  expect(excerpts.join('').length).toBeLessThan(first.text.length / 2);
  expect(excerpts[0]).toContain('旅人走进了纸湾');
  expect(excerpts.some((x) => x.includes('纸湾镇的桥'))).toBe(true);
  expect(excerpts.some((x) => x.includes('纸湾的码头'))).toBe(true);
  expect(excerpts.some((x) => x.includes('又回到纸湾'))).toBe(false);
  // Every excerpt is quoted text; a chapter outside the run is never read.
  expect(
    excerpts.every((x) => first.text.includes(x) || second.text.includes(x)),
  ).toBe(true);
  expect(mentionExcerpts([first, second, later], entity).join('')).toContain(
    'SENTINEL',
  );
  // Under a tight budget the first mention of each chapter comes first.
  const tight = mentionExcerpts([first, second], entity, { budget: 600 });
  expect(tight).toHaveLength(2);
  expect(tight[0]).toContain('旅人走进了纸湾');
  expect(tight[1]).toContain('纸湾的码头');
  expect(
    mentionExcerpts([first, second], { ...entity, chapters: [0] }).some((x) =>
      x.includes('纸湾的码头'),
    ),
  ).toBe(false);
});
