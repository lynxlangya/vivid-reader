import { defaultPreferences, type Preferences } from '../../shared/settings';
import { geoDistance } from 'd3-geo';
import { collapse } from '../../renderer/vendor/foliate-js/epubcfi.js';
import { compareCFI, validateCFI } from '../../shared/cfi';
import type { Chapter } from '../../shared/book';
import type {
  CardData,
  Mention,
  ReaderMark,
  ReaderState,
  TextSlice,
} from '../../shared/reading';
import type { Repository } from '../db/repository';
import { bodyCFI, cfiAt } from './epub';
import { sparseMarks } from '../pipeline/mentions';
interface Point {
  chapter: number;
  offset: number;
  cfi: string;
}
interface MentionIndex {
  chapters: Chapter[];
  all: Mention[];
  firstInChapter: Set<string>;
  firstChapter: Map<string, number>;
}
// Keyed by the repository's frozen mention snapshot, so a write that replaces
// the snapshot also retires the derived index.
const indexes = new WeakMap<object, MentionIndex>();
export class ContentGateway {
  constructor(
    private repo: Repository,
    readonly bookId: string,
    private preferences: () => Preferences = () => defaultPreferences,
  ) {}
  private chapters() {
    return this.repo.chapters(this.bookId);
  }
  position(value: string, toEnd = false): Point {
    const cfi = collapse(validateCFI(value), toEnd);
    const chapters = this.chapters();
    const chapter = [...chapters]
      .reverse()
      .find((item) => compareCFI(item.baseCFI, cfi) <= 0);
    if (chapter && !chapter.text.length) {
      const body = cfiAt(chapter, 0).slice(0, -1).replace(/:0$/, '');
      if (cfi.startsWith(`${body}/`) || cfi === cfiAt(chapter, 0))
        return { chapter: chapter.index, offset: 0, cfi: cfiAt(chapter, 0) };
      throw new Error('Position is outside the chapter body');
    }
    if (!chapter || compareCFI(cfi, cfiAt(chapter, chapter.text.length)) > 0)
      throw new Error('Position is outside the current book');
    let low = 0,
      high = chapter.text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (compareCFI(cfiAt(chapter, mid), cfi) <= 0) low = mid;
      else high = mid - 1;
    }
    return { chapter: chapter.index, offset: low, cfi: cfiAt(chapter, low) };
  }
  private boundary() {
    const progress = this.repo.progress(this.bookId);
    if (!progress) throw new Error('Missing read boundary');
    return this.position(progress.boundary, true);
  }
  private limit(chapter: Chapter): number {
    const boundary = this.boundary();
    return chapter.index < boundary.chapter
      ? chapter.text.length
      : chapter.index === boundary.chapter
        ? boundary.offset
        : 0;
  }
  read(startCFI: string, endCFI: string): TextSlice[] {
    const start = this.position(startCFI),
      end = this.position(endCFI, true);
    if (compareCFI(start.cfi, end.cfi) > 0) return [];
    return this.chapters().flatMap((chapter) => {
      if (chapter.index < start.chapter || chapter.index > end.chapter)
        return [];
      const from = chapter.index === start.chapter ? start.offset : 0;
      const to = Math.min(
        this.limit(chapter),
        chapter.index === end.chapter ? end.offset : chapter.text.length,
      );
      return to > from
        ? [
            {
              text: chapter.text.slice(from, to),
              startCFI: cfiAt(chapter, from),
              endCFI: cfiAt(chapter, to),
              chapter: chapter.index,
            },
          ]
        : [];
    });
  }
  summary(
    scope: 'chapter' | 'to_boundary',
    selection?: { start: string; end: string },
  ): TextSlice[] {
    if (selection) {
      if (!this.selectionAllowed(selection.start, selection.end)) return [];
      return this.read(selection.start, selection.end);
    }
    const chapters = this.chapters();
    const boundary = this.boundary();
    const current = this.position(this.repo.progress(this.bookId)!.current);
    return chapters
      .filter((chapter) =>
        scope === 'to_boundary'
          ? chapter.index <= boundary.chapter
          : chapter.index === current.chapter,
      )
      .flatMap((chapter) => {
        const to = this.limit(chapter);
        return to
          ? [
              {
                text: chapter.text.slice(0, to),
                chapter: chapter.index,
                startCFI: cfiAt(chapter, 0),
                endCFI: cfiAt(chapter, to),
              },
            ]
          : [];
      });
  }
  // foliate reports the bare body when a page shows no text, such as a
  // trailing blank column or a lone image; treat it as spanning its chapter.
  private span(page: string): [Point, Point] {
    const start = this.position(page),
      chapter = this.chapters()[start.chapter];
    if (page.includes(',') || compareCFI(page, bodyCFI(chapter)) !== 0)
      return [start, this.position(page, true)];
    const end = chapter.text.length;
    return [
      { chapter: chapter.index, offset: 0, cfi: cfiAt(chapter, 0) },
      { chapter: chapter.index, offset: end, cfi: cfiAt(chapter, end) },
    ];
  }
  // A page follows another only if no visible text is skipped between them.
  follows(fromPage: string, toPage: string) {
    try {
      const [from, end] = this.span(fromPage),
        [start] = this.span(toPage);
      if (compareCFI(start.cfi, from.cfi) < 0) return false;
      if (compareCFI(start.cfi, end.cfi) <= 0) return true;
      return this.chapters()
        .filter((c) => c.index >= end.chapter && c.index <= start.chapter)
        .every(
          (c) =>
            !/\S/.test(
              c.text.slice(
                c.index === end.chapter ? end.offset : 0,
                c.index === start.chapter ? start.offset : c.text.length,
              ),
            ),
        );
    } catch {
      return false;
    }
  }
  selectionAllowed(start: string, end: string) {
    return (
      compareCFI(this.position(start).cfi, this.position(end, true).cfi) <= 0 &&
      compareCFI(this.position(end, true).cfi, this.boundary().cfi) <= 0
    );
  }
  search(query: string) {
    if (!query.trim()) return [];
    return this.summary('to_boundary')
      .flatMap((slice) => {
        const matches: { text: string; cfi: string; chapter: number }[] = [];
        let from = 0;
        while (matches.length < 20) {
          const offset = slice.text.indexOf(query, from);
          if (offset < 0) break;
          const chapter = this.chapters()[slice.chapter!];
          matches.push({
            text: slice.text.slice(
              Math.max(0, offset - 45),
              Math.min(slice.text.length, offset + query.length + 45),
            ),
            cfi: cfiAt(chapter, offset),
            chapter: chapter.index,
          });
          from = offset + query.length;
        }
        return matches;
      })
      .slice(0, 20);
  }
  private index(): MentionIndex {
    const rows = this.repo.mentions(this.bookId),
      chapters = this.chapters();
    const cached = indexes.get(rows);
    if (cached?.chapters === chapters) return cached;
    const all = rows.map((mention) => {
      const chapter = chapters[mention.chapter];
      return Object.freeze({
        ...mention,
        surface: chapter.text.slice(mention.start, mention.end),
        startCFI: cfiAt(chapter, mention.start),
        endCFI: cfiAt(chapter, mention.end),
      });
    });
    const firstInChapter = new Set<string>(),
      firstChapter = new Map<string, number>(),
      seen = new Set<string>();
    for (const mention of all) {
      const key = `${mention.chapter}:${mention.entityId}`;
      if (!seen.has(key)) firstInChapter.add(mention.id);
      seen.add(key);
      if (!firstChapter.has(mention.entityId))
        firstChapter.set(mention.entityId, mention.chapter);
    }
    const index = { chapters, all, firstInChapter, firstChapter };
    indexes.set(rows, index);
    return index;
  }
  private allMentions(): Mention[] {
    return this.index().all;
  }
  // Offsets map to CFIs monotonically, so this equals comparing end CFIs.
  private readMentions() {
    const boundary = this.boundary();
    return this.allMentions().filter(
      (mention) =>
        mention.chapter < boundary.chapter ||
        (mention.chapter === boundary.chapter &&
          mention.end <= boundary.offset),
    );
  }
  marks(
    chapter: number,
    pageCFI?: string,
    density: 'low' | 'medium' | 'high' = this.preferences().density,
  ): ReaderMark[] {
    const mentions = this.readMentions();
    const entities = new Map(
      this.repo.entities(this.bookId).map((entity) => [entity.id, entity]),
    );
    const { firstInChapter, firstChapter } = this.index();
    const start = pageCFI ? this.position(pageCFI) : undefined;
    const end = pageCFI ? this.position(pageCFI, true) : undefined;
    const marks = mentions
      .filter(
        (mention) =>
          mention.chapter === chapter && firstInChapter.has(mention.id),
      )
      .flatMap((mention) => {
        const entity = entities.get(mention.entityId);
        if (
          !entity ||
          entity.hidden ||
          !this.preferences().types.includes(entity.type)
        )
          return [];
        if (
          start &&
          end &&
          (mention.end < start.offset || mention.start > end.offset)
        )
          return [];
        return [
          {
            id: mention.id,
            entityId: entity.id,
            name: mention.surface,
            type: entity.type,
            chapter,
            startCFI: mention.startCFI,
            endCFI: mention.endCFI,
            importance: entity.importance,
            // Read mentions here mean every earlier chapter is read.
            seenBefore: firstChapter.get(entity.id)! < chapter,
          },
        ];
      });
    return sparseMarks(marks, density, new Set(this.repo.known(this.bookId)));
  }
  prefetch(chapter: number) {
    const known = new Set(this.repo.known(this.bookId)),
      { firstInChapter } = this.index();
    return this.readMentions()
      .filter(
        (x) =>
          x.chapter === chapter &&
          firstInChapter.has(x.id) &&
          !known.has(x.entityId),
      )
      .map((x) => x.id);
  }
  context() {
    const boundary = this.boundary();
    const chapters = this.chapters();
    const current = this.position(this.repo.progress(this.bookId)!.current);
    const beyond = compareCFI(current.cfi, boundary.cfi) > 0;
    const known = new Set(this.repo.known(this.bookId));
    const visible = this.readMentions();
    return {
      boundaryCFI: boundary.cfi,
      chapter: boundary.chapter,
      title: chapters[beyond ? boundary.chapter : current.chapter].title,
      currentCFI: current.cfi,
      currentChapter: current.chapter,
      viewBeyondBoundary: beyond,
      known: visible
        .filter((x) => known.has(x.entityId))
        .map((x) => x.surface)
        .filter((name, index, all) => all.indexOf(name) === index),
      bookType: 'nonfiction',
    };
  }
  lookup(name: string) {
    const mention = this.readMentions().find((x) => x.surface === name);
    return mention ? this.card(mention.id) : null;
  }
  card(mentionId: string): CardData | null {
    const visible = this.readMentions();
    const mention = visible.find((x) => x.id === mentionId);
    if (!mention) return null;
    const entity = this.repo
      .entities(this.bookId)
      .find((x) => x.id === mention.entityId);
    if (!entity) return null;
    const history = visible.filter((x) => x.entityId === entity.id);
    const firstVisible = new Map<string, Mention>();
    for (const x of visible)
      if (!firstVisible.has(x.entityId)) firstVisible.set(x.entityId, x);
    const references =
      entity.linked?.lat === undefined || entity.linked.lon === undefined
        ? []
        : this.repo
            .entities(this.bookId)
            .filter(
              (x) =>
                x.id !== entity.id &&
                x.linked?.lat !== undefined &&
                x.linked.lon !== undefined &&
                firstVisible.has(x.id),
            )
            .map((other) => ({
              name: firstVisible.get(other.id)!.surface,
              lat: other.linked!.lat!,
              lon: other.linked!.lon!,
              distanceKm:
                geoDistance(
                  [entity.linked!.lon!, entity.linked!.lat!],
                  [other.linked!.lon!, other.linked!.lat!],
                ) * 6371.0088,
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 2);
    if (
      !references.length &&
      entity.linked?.capital &&
      entity.linked.lat !== undefined &&
      entity.linked.lon !== undefined
    ) {
      const capital = entity.linked.capital;
      references.push({
        ...capital,
        distanceKm:
          geoDistance(
            [entity.linked.lon, entity.linked.lat],
            [capital.lon, capital.lat],
          ) * 6371.0088,
      });
    }
    const gloss = this.repo.gloss(entity.id, mention.chapterId);
    return {
      id: mention.id,
      name: mention.surface,
      original: entity.linked?.original ?? '',
      type: entity.type,
      fact: entity.linked,
      footprint: { firstChapter: history[0].chapter, count: history.length },
      references,
      plate: `${mention.chapter + 1}·${visible.filter((x) => x.chapter === mention.chapter && x.start <= mention.start).filter((x, index, all) => all.findIndex((m) => m.entityId === x.entityId) === index).length}`,
      gloss: gloss ? { status: 'ready', text: gloss } : { status: 'loading' },
      candidates: entity.candidates,
    };
  }
  glossInput(mentionId: string): {
    entityId: string;
    chapterId: string;
    name: string;
    before: string;
    previous: string[];
  } | null {
    const visible = this.readMentions();
    const mention = visible.find((x) => x.id === mentionId);
    if (!mention) return null;
    const chapters = this.chapters();
    const chapter = chapters[mention.chapter];
    const previous = visible
      .filter(
        (x) =>
          x.entityId === mention.entityId &&
          (x.chapter < mention.chapter ||
            (x.chapter === mention.chapter && x.start < mention.start)),
      )
      .map((x) =>
        chapters[x.chapter].text.slice(
          Math.max(0, x.start - 50),
          Math.min(
            x.end + 50,
            x.chapter === mention.chapter
              ? mention.start
              : chapters[x.chapter].text.length,
          ),
        ),
      );
    return {
      entityId: mention.entityId,
      chapterId: chapter.id,
      name: mention.surface,
      before: chapter.text.slice(0, mention.start),
      previous,
    };
  }
  fractionCFI(fraction: number) {
    const chapters = this.chapters();
    let offset = Math.floor(
      Math.max(0, Math.min(1, fraction)) *
        chapters.reduce((sum, c) => sum + c.text.length, 0),
    );
    for (const chapter of chapters) {
      if (!chapter.text.length) continue;
      if (offset <= chapter.text.length) return cfiAt(chapter, offset);
      offset -= chapter.text.length;
    }
    return cfiAt(chapters.at(-1)!, chapters.at(-1)!.text.length);
  }
  state(pageCFI?: string): ReaderState {
    const progress = this.repo.progress(this.bookId)!;
    const chapters = this.chapters();
    const boundary = this.boundary();
    const current = this.position(pageCFI ?? progress.current);
    const total = chapters.reduce((sum, c) => sum + c.text.length, 0);
    const fraction = (point: Point) =>
      (chapters
        .filter((c) => c.index < point.chapter)
        .reduce((sum, c) => sum + c.text.length, 0) +
        point.offset) /
      Math.max(1, total);
    return {
      currentCFI: progress.current,
      boundaryCFI: boundary.cfi,
      currentChapter: current.chapter,
      boundaryChapter: boundary.chapter,
      currentFraction: fraction(current),
      boundaryFraction: fraction(boundary),
      beyond: compareCFI(current.cfi, boundary.cfi) > 0,
      marks: this.marks(current.chapter, pageCFI),
      toc: chapters.map((chapter) => ({
        chapter: chapter.index,
        title: chapter.title,
        ...(chapter.index <= boundary.chapter
          ? {
              percent:
                chapter.index < boundary.chapter
                  ? 100
                  : Math.floor(
                      (boundary.offset / Math.max(1, chapter.text.length)) *
                        100,
                    ),
            }
          : {}),
      })),
    };
  }
}
