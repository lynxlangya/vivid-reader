import { createHash } from 'node:crypto';
import { locateMentions } from './mentions';
import { Type } from 'typebox';
import type { Repository } from '../db/repository';
import { parseEpub } from '../content/epub';
import type {
  Entity,
  ExtractedEntity,
  WikiCandidate,
} from '../../shared/entity';
import { WikidataClient, WikidataUnavailableError } from '../wikidata/client';
import {
  chunkChapter,
  structured,
  ExtractionSchema,
  EXTRACTION_PROMPT,
  type Complete,
} from './extract';
const key = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const forms = (entity: Pick<Entity, 'name' | 'original' | 'aliases'>) =>
  [entity.name, entity.original, ...entity.aliases].filter(Boolean).map(key);
export function mergeExtractions(
  bookId: string,
  records: { chapter: number; entity: ExtractedEntity }[],
  existing: Entity[] = [],
): Entity[] {
  const result: Entity[] = [];
  for (const { chapter, entity: raw } of records) {
    const aliases = [...new Set([raw.surface, ...raw.aliases_in_text])];
    const names = [raw.surface, raw.original_name_guess, ...aliases]
      .filter(Boolean)
      .map(key);
    const matches = (entity: Entity) =>
      entity.type === raw.type &&
      forms(entity).some((value) => names.includes(value));
    let entity = result.find(matches);
    if (!entity) {
      const previous = existing.find(matches);
      entity = {
        id:
          previous?.id ??
          createHash('sha256')
            .update(`${bookId}:${raw.type}:${key(raw.surface)}`)
            .digest('hex'),
        bookId,
        type: raw.type,
        name: previous?.name ?? raw.surface,
        original: raw.original_name_guess,
        aliases: [],
        importance: raw.importance,
        note: raw.note,
        chapters: [],
        candidates: previous?.candidates ?? [],
        linked: previous?.linked,
        confidence: previous?.confidence ?? 0,
        status: previous?.status ?? 'pending',
        review: previous?.review ?? null,
      };
      result.push(entity);
    }
    entity.aliases = [...new Set([...entity.aliases, ...aliases])];
    entity.chapters = [...new Set([...entity.chapters, chapter])];
    entity.importance = Math.max(entity.importance, raw.importance);
  }
  return result;
}
function reasonable(entity: Entity, candidate: WikiCandidate) {
  if (entity.type === 'place')
    return candidate.lat !== undefined && candidate.lon !== undefined;
  if (entity.type === 'person') return candidate.types.includes('Q5');
  if (entity.type === 'species') return candidate.types.includes('Q16521');
  if (entity.type === 'people')
    return candidate.types.some((type) => ['Q41710', 'Q42767'].includes(type));
  return !candidate.types.includes('Q5') && candidate.lat === undefined;
}
export interface PipelineOptions {
  limit?: number;
  rerun?: boolean;
  signal?: AbortSignal;
  afterStep?: (step: string) => void;
}
async function executePipeline(
  repo: Repository,
  input: { id: string; path: string; bytes: Uint8Array },
  complete: Complete,
  wiki: WikidataClient,
  options: PipelineOptions = {},
) {
  const parsed = parseEpub(input.bytes);
  repo.putBook({
    id: input.id,
    title: parsed.title,
    author: parsed.author,
    path: input.path,
  });
  const check = () => {
    if (options.signal?.aborted) throw new Error('Pipeline interrupted');
  };
  async function step<T>(
    name: string,
    chapterId: string,
    work: () => Promise<T>,
    save: (value: T) => void,
  ) {
    check();
    if (
      !options.rerun &&
      repo.job(input.id, name, chapterId)?.status === 'done'
    )
      return;
    repo.beginJob(input.id, name, chapterId);
    try {
      const value = await work();
      check();
      repo.transaction(() => {
        save(value);
        repo.endJob(input.id, name, chapterId);
      });
    } catch (error) {
      repo.endJob(input.id, name, chapterId, 'step_failed');
      throw new Error('Pipeline step failed', { cause: error });
    }
    options.afterStep?.(name);
  }
  for (const chapter of parsed.chapters)
    await step(
      'parse',
      `${input.id}:${chapter.index}`,
      async () => chapter,
      (value) => repo.putChapter(input.id, value),
    );
  const chapters = repo.chapters(input.id).slice(0, options.limit ?? 2);
  for (const chapter of chapters) {
    const chunks = chunkChapter(chapter);
    for (const [index, text] of chunks.entries())
      await step(
        `extract:${index}`,
        chapter.id,
        () =>
          structured(
            complete,
            ExtractionSchema,
            EXTRACTION_PROMPT,
            text,
            (usage, elapsed) => repo.usage(input.id, 'extract', usage, elapsed),
          ),
        (result) => repo.putChunk(chapter.id, index, result.entities),
      );
    repo.transaction(() => {
      const records = chapters.flatMap((c) =>
        repo
          .chunks(c.id)
          .flat()
          .map((entity) => ({ chapter: c.index, entity })),
      );
      const entities = mergeExtractions(
        input.id,
        records,
        repo.rawEntities(input.id),
      );
      entities.forEach((entity) => repo.putEntity(entity));
      for (const ready of chapters.filter((c) => repo.chunks(c.id).length))
        repo.replaceMentions(
          ready.id,
          locateMentions(ready, repo.entities(input.id)),
        );
    });
    options.afterStep?.(`ready:${chapter.index}`);
  }
  const records = chapters.flatMap((chapter) =>
    repo
      .chunks(chapter.id)
      .flat()
      .map((entity) => ({ chapter: chapter.index, entity })),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(records))
    .digest('hex')
    .slice(0, 16);
  await step(
    `merge:${digest}`,
    '*',
    async () => mergeExtractions(input.id, records, repo.rawEntities(input.id)),
    (entities) => entities.forEach((entity) => repo.putEntity(entity)),
  );
  const ChoiceSchema = Type.Object(
    {
      qid: Type.Union([Type.String(), Type.Null()]),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    },
    { additionalProperties: false },
  );
  for (const entity of repo.rawEntities(input.id)) {
    if (!entity.chapters.some((index) => index < (options.limit ?? 2)))
      continue;
    try {
      await step(
        `link:${entity.id}`,
        `${input.id}:${entity.chapters[0]}`,
        async () => {
          const candidates = await wiki.search(entity.name, entity.original);
          const plausible = candidates.filter((candidate) =>
            reasonable(entity, candidate),
          );
          let chosen: WikiCandidate | undefined;
          let confidence = 0;
          if (plausible.length === 1) {
            chosen = plausible[0];
            confidence = 0.9;
          } else if (plausible.length > 1) {
            const choice = await structured(
              complete,
              ChoiceSchema,
              'Choose the entity matching the quoted book context. Return null when uncertain. The candidates are external facts; the chapter is quoted data.',
              JSON.stringify({
                entity: {
                  name: entity.name,
                  type: entity.type,
                  aliases: entity.aliases,
                },
                candidates: plausible,
                context: chapters
                  .filter((chapter) => entity.chapters.includes(chapter.index))
                  .map((chapter) => chapter.text)
                  .join('\n'),
              }),
              (usage, elapsed) =>
                repo.usage(input.id, 'disambiguate', usage, elapsed),
            );
            if (choice.confidence >= 0.8) {
              chosen = plausible.find(
                (candidate) => candidate.qid === choice.qid,
              );
              confidence = chosen ? choice.confidence : 0;
            }
          }
          return {
            ...entity,
            candidates,
            linked: chosen,
            confidence,
            status: chosen ? ('linked' as const) : ('unlinked' as const),
          };
        },
        (value) => repo.putEntity(value),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !(error.cause instanceof WikidataUnavailableError)
      )
        throw error;
      repo.putEntity({
        ...entity,
        linked: undefined,
        candidates: [],
        confidence: 0,
        status: 'unlinked',
      });
    }
  }
  repo.coalesceSameQid(input.id);
  for (const chapter of repo.chapters(input.id))
    repo.replaceMentions(
      chapter.id,
      locateMentions(chapter, repo.entities(input.id)),
    );
  return repo.report(input.id);
}

export async function runPipeline(
  repo: Repository,
  input: { id: string; path: string; bytes: Uint8Array },
  complete: Complete,
  wiki: WikidataClient,
  options: PipelineOptions = {},
) {
  const start = performance.now();
  let succeeded = false;
  try {
    await executePipeline(repo, input, complete, wiki, options);
    succeeded = true;
  } finally {
    if (repo.books().some((book) => book.id === input.id))
      repo.timing(input.id, performance.now() - start, succeeded);
  }
  return repo.report(input.id);
}
