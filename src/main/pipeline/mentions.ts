import { createHash } from 'node:crypto';
import type { Chapter } from '../../shared/book';
import type { Entity } from '../../shared/entity';
import type { Mention, ReaderMark } from '../../shared/reading';
import { cfiAt, cfiRangeAt } from '../content/epub';
export function locateMentions(
  chapter: Chapter,
  entities: Entity[],
): Mention[] {
  const mentions: Mention[] = [];
  for (const entity of entities) {
    const forms = [...new Set([entity.name, ...entity.aliases])]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const found: { start: number; end: number; surface: string }[] = [];
    for (const surface of forms) {
      let from = 0;
      while (from < chapter.text.length) {
        const start = chapter.text.indexOf(surface, from);
        if (start < 0) break;
        const end = start + surface.length;
        if (!found.some((hit) => start < hit.end && end > hit.start))
          found.push({ start, end, surface });
        from = end;
      }
    }
    for (const hit of found)
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
  }
  return mentions.sort((a, b) => a.start - b.start || b.end - a.end);
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
