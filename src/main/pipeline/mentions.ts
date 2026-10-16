import { createHash } from 'node:crypto';
import type { Chapter } from '../../shared/book';
import type { Entity } from '../../shared/entity';
import type { Mention, ReaderMark } from '../../shared/reading';
import { cfiAt, cfiRangeAt } from '../content/epub';
// Offsets of an entity's forms in the text; longer forms win where they overlap.
export function findForms(text: string, forms: string[]) {
  const found: { start: number; end: number; surface: string }[] = [];
  for (const surface of [...new Set(forms)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    let from = 0;
    while (from < text.length) {
      const start = text.indexOf(surface, from);
      if (start < 0) break;
      const end = start + surface.length;
      if (!found.some((hit) => start < hit.end && end > hit.start))
        found.push({ start, end, surface });
      from = end;
    }
  }
  return found;
}
export function locateMentions(
  chapter: Chapter,
  entities: Entity[],
): Mention[] {
  const mentions: Mention[] = [];
  for (const entity of entities)
    for (const hit of findForms(chapter.text, [entity.name, ...entity.aliases]))
      mentions.push({
        id: createHash('sha256')
          .update(`${entity.id}:${chapter.id}:${hit.start}`)
          .digest('hex'),
        entityId: entity.id,
        chapterId: chapter.id,
        chapter: chapter.index,
        ...hit,
        cfiRange: cfiRangeAt(chapter, hit.start, hit.end),
        startCFI: cfiAt(chapter, hit.start),
        endCFI: cfiAt(chapter, hit.end),
      });
  return mentions.sort((a, b) => a.start - b.start || b.end - a.end);
}
// Short excerpts around an entity's first mentions, for choosing among its
// Wikidata candidates. Only the chapters passed in are read, and the excerpts
// stay within `budget` characters: each chapter's first mention comes first,
// then its second, while they fit.
export function mentionExcerpts(
  chapters: Chapter[],
  entity: Pick<Entity, 'name' | 'aliases' | 'chapters'>,
  { radius = 120, perChapter = 2, budget = 1200 } = {},
): string[] {
  const windows = chapters
    .filter((chapter) => entity.chapters.includes(chapter.index))
    .flatMap((chapter, order) =>
      findForms(chapter.text, [entity.name, ...entity.aliases])
        .sort((a, b) => a.start - b.start)
        .slice(0, perChapter)
        .map((hit, rank) => ({
          chapter,
          order,
          rank,
          start: Math.max(0, hit.start - radius),
          end: Math.min(chapter.text.length, hit.end + radius),
        })),
    )
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  const merge = (list: typeof windows) =>
    [...list]
      .sort((a, b) => a.order - b.order || a.start - b.start)
      .reduce<typeof windows>((spans, window) => {
        const last = spans.at(-1);
        if (last?.order === window.order && window.start <= last.end)
          spans[spans.length - 1] = {
            ...last,
            end: Math.max(last.end, window.end),
          };
        else spans.push(window);
        return spans;
      }, []);
  const length = (list: typeof windows) =>
    merge(list).reduce((sum, span) => sum + span.end - span.start, 0);
  const chosen: typeof windows = [];
  for (const window of windows)
    if (length([...chosen, window]) <= budget) chosen.push(window);
  return merge(chosen).map((span) =>
    span.chapter.text.slice(span.start, span.end),
  );
}
export function sparseMarks(
  marks: ReaderMark[],
  density: 'low' | 'medium' | 'high' = 'medium',
  known: ReadonlySet<string> = new Set(),
  limit = 6,
): ReaderMark[] {
  const threshold = { low: 0.8, medium: 0.55, high: 0.25 }[density];
  return marks
    .filter((mark) => !known.has(mark.entityId) && mark.importance >= threshold)
    .sort((a, b) => b.importance - a.importance)
    .filter(
      (mark, index, all) =>
        all.findIndex((x) => x.entityId === mark.entityId) === index,
    )
    .slice(0, limit);
}
