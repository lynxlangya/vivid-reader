import { test, expect } from 'vitest';
import { contentFixture } from './fixtures/content';
import { cfiAt } from '../src/main/content/epub';
import { compareCFI } from '../src/shared/cfi';
import { locateMentions } from '../src/main/pipeline/mentions';
test('chapter and mention snapshots are shared, frozen, and replaced on write', async () => {
  const { repo, id, gateway, chapters, entities } = await contentFixture();
  try {
    expect(repo.chapters(id)).toBe(chapters);
    expect(Object.isFrozen(chapters) && Object.isFrozen(chapters[0])).toBe(
      true,
    );
    const mentions = repo.mentions(id);
    expect(repo.mentions(id)).toBe(mentions);
    expect(() => (mentions as unknown[]).push({})).toThrow();
    const mark = gateway.marks(0)[0];
    repo.replaceMentions(chapters[0].id, []);
    expect(repo.mentions(id)).not.toBe(mentions);
    expect(gateway.marks(0)).toEqual([]);
    expect(gateway.card(mark.id)).toBeNull();
    repo.replaceMentions(chapters[0].id, locateMentions(chapters[0], entities));
    expect(gateway.marks(0)[0].id).toBe(mark.id);
    repo.putChapter(id, { ...chapters[1], title: '改名后的第二章' });
    expect(repo.chapters(id)).not.toBe(chapters);
    expect(gateway.state().toc[1].title).toBe('改名后的第二章');
  } finally {
    repo.close();
  }
});
test('a rolled-back write never leaves uncommitted rows in the cache', async () => {
  const { repo, id, chapters } = await contentFixture();
  try {
    expect(() =>
      repo.transaction(() => {
        repo.putChapter(id, { ...chapters[1], title: '未提交的标题' });
        expect(repo.chapters(id)[1].title).toBe('未提交的标题');
        repo.replaceMentions(chapters[0].id, []);
        expect(repo.mentions(id).some((x) => x.chapter === 0)).toBe(false);
        throw new Error('Synthetic rollback');
      }),
    ).toThrow('Synthetic rollback');
    expect(repo.chapters(id)[1].title).toBe(chapters[1].title);
    expect(repo.mentions(id).some((x) => x.chapter === 0)).toBe(true);
  } finally {
    repo.close();
  }
});
test('read mentions by offset match CFI comparison at every edge', async () => {
  const { repo, id, gateway, chapters } = await contentFixture();
  try {
    let checked = 0;
    for (const mention of repo.mentions(id)) {
      const chapter = chapters[mention.chapter];
      for (const offset of [
        0,
        mention.start,
        mention.end - 1,
        mention.end,
        mention.end + 1,
        chapter.text.length,
      ]) {
        if (offset < 0 || offset > chapter.text.length) continue;
        const boundary = cfiAt(chapter, offset);
        repo.saveProgress(id, boundary, boundary);
        const point = gateway.position(boundary, true);
        expect(gateway.card(mention.id) !== null).toBe(
          compareCFI(cfiAt(chapter, mention.end), point.cfi) <= 0,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  } finally {
    repo.close();
  }
});
