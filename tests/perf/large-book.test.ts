import { test, expect, beforeAll, afterAll } from 'vitest';
import { largeBook } from '../fixtures/large-book';
import { ContentGateway } from '../../src/main/content/gateway';
import { cfiAt } from '../../src/main/content/epub';
import { compareCFI } from '../../src/shared/cfi';
import { locateMentions } from '../../src/main/pipeline/mentions';
// Budgets leave several times the measured headroom; they catch regressions
// back to whole-book reloads, not small machine-to-machine differences.
const budgets = {
  pageTurn: 25,
  card: 20,
  search: 50,
  summary: 50,
  cold: 200,
};
let book: ReturnType<typeof largeBook>;
const rows: { operation: string; medianMs: number; budgetMs: number }[] = [];
beforeAll(() => {
  book = largeBook();
});
afterAll(() => {
  console.info(
    `large book: ${book.chapters.reduce((sum, c) => sum + c.text.length, 0)} chars, ${book.repo.mentions(book.id).length} mentions`,
  );
  console.table(rows);
  book.repo.close();
});
// Each sample builds a fresh gateway, as every IPC call does.
function measure(operation: string, budgetMs: number, run: () => unknown) {
  run();
  const samples = Array.from({ length: 15 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const medianMs = Number(samples[7].toFixed(2));
  rows.push({ operation, medianMs, budgetMs });
  expect(medianMs).toBeLessThan(budgetMs);
}
const gateway = () => new ContentGateway(book.repo, book.id);
test('page turn: adjacency, reader state and gloss prefetch', () => {
  const next = cfiAt(book.reading, 4100);
  measure('page turn', budgets.pageTurn, () => {
    const g = gateway();
    g.follows(book.page, next);
    g.state(next);
    g.prefetch(book.reading.index);
  });
});
test('hover card', () => {
  const id = gateway().marks(book.reading.index)[0].id;
  measure('card', budgets.card, () => gateway().card(id));
});
test('companion search and summary', () => {
  measure('search', budgets.search, () => gateway().search('地名123号'));
  measure('summary to boundary', budgets.summary, () =>
    gateway().summary('to_boundary'),
  );
});
test('first page turn after the pipeline replaces a chapter of mentions', () => {
  const chapter = book.chapters[0];
  const entities = book.repo.entities(book.id);
  measure('page turn after write', budgets.cold, () => {
    book.repo.replaceMentions(chapter.id, locateMentions(chapter, entities));
    gateway().state(book.page);
  });
});
test('offset filtering agrees with CFI comparison on a large book', () => {
  const g = gateway(),
    mentions = book.repo.mentions(book.id);
  const original = book.repo.progress(book.id)!;
  try {
    for (let i = 0; i < mentions.length; i += 60) {
      const mention = mentions[i],
        chapter = book.chapters[mention.chapter];
      for (const offset of [mention.end - 1, mention.end, mention.end + 1]) {
        if (offset < 0 || offset > chapter.text.length) continue;
        const boundary = cfiAt(chapter, offset);
        book.repo.saveProgress(book.id, boundary, boundary);
        const point = g.position(boundary, true);
        expect(g.card(mention.id) !== null).toBe(
          compareCFI(cfiAt(chapter, mention.end), point.cfi) <= 0,
        );
      }
    }
  } finally {
    book.repo.saveProgress(book.id, original.current, original.boundary);
  }
});
