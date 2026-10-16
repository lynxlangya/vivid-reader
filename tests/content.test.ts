import { test, expect } from 'vitest';
import { contentFixture } from './fixtures/content';
import { bodyCFI, cfiAt } from '../src/main/content/epub';
import { compareCFI } from '../src/shared/cfi';
import { collapse } from '../src/renderer/vendor/foliate-js/epubcfi.js';
import { locateMentions, sparseMarks } from '../src/main/pipeline/mentions';
test('all auxiliary outputs omit future sentinels, entities, extraction notes, and unread statistics', async () => {
  const { repo, gateway, chapters } = await contentFixture();
  try {
    const data = {
      read: gateway.read(
        cfiAt(chapters[0], 0),
        cfiAt(chapters[4], chapters[4].text.length),
      ),
      state: gateway.state(),
      context: gateway.context(),
      summary: gateway.summary('to_boundary'),
      future: gateway.lookup('后文地点雾岛'),
      search: gateway.search('SENTINEL-AFTER-BOUNDARY-4'),
    };
    const json = JSON.stringify(data);
    for (const forbidden of [
      'SENTINEL-AFTER-BOUNDARY-4',
      'SENTINEL-AFTER-BOUNDARY-5',
      '后文地点雾岛',
      '后文人物远客',
      'PRIVATE-EXTRACTION-NOTE',
    ])
      expect(json.includes(forbidden)).toBe(false);
    expect(data.future).toBeNull();
    expect(data.search).toEqual([]);
    expect(data.state.toc[3].percent).toBeUndefined();
    expect(data.read.at(-1)!.text.length).toBe(
      Math.floor(chapters[2].text.length / 2),
    );
    expect(gateway.read(cfiAt(chapters[3], 0), cfiAt(chapters[4], 10))).toEqual(
      [],
    );
    expect(
      gateway.selectionAllowed(cfiAt(chapters[2], 0), cfiAt(chapters[3], 10)),
    ).toBe(false);
  } finally {
    repo.close();
  }
});
test('gloss input stops before the mention and cache becomes invisible after rewind', async () => {
  const { repo, id, gateway, chapters } = await contentFixture();
  try {
    const mark = gateway.marks(0)[0];
    const input = gateway.glossInput(mark.id)!;
    const offset = chapters[0].text.indexOf(input.name);
    expect(input.before).toBe(chapters[0].text.slice(0, offset));
    expect(input.previous).toEqual([]);
    expect(JSON.stringify(input)).not.toContain('PRIVATE-EXTRACTION-NOTE');
    repo.saveGloss(input.entityId, input.chapterId, '合成释义', 'faux');
    expect(gateway.card(mark.id)!.gloss.text).toBe('合成释义');
    repo.saveProgress(id, cfiAt(chapters[0], 0), cfiAt(chapters[0], 0));
    expect(gateway.card(mark.id)).toBeNull();
    expect(gateway.glossInput(mark.id)).toBeNull();
  } finally {
    repo.close();
  }
});
test('locates aliases by text, avoids overlapping forms, and enforces first mention, density, known state, and cap', async () => {
  const { repo, id, gateway, chapters, entities } = await contentFixture();
  try {
    const mentions = locateMentions(chapters[0], entities);
    expect(mentions.filter((x) => x.entityId === entities[0].id).length).toBe(
      32,
    );
    expect(gateway.marks(0)).toHaveLength(2);
    const mark = gateway.marks(0)[0];
    repo.setKnown(id, mark.entityId);
    expect(gateway.marks(0)).toHaveLength(1);
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...mark,
      id: String(i),
      entityId: String(i),
      importance: i / 12,
    }));
    expect(sparseMarks(many, 'high')).toHaveLength(6);
    expect(sparseMarks(many, 'low').every((x) => x.importance >= 0.8)).toBe(
      true,
    );
    repo.correct(entities[1].id, 'hidden', true);
    expect(gateway.marks(0)).toHaveLength(0);
  } finally {
    repo.close();
  }
});

test('cards and actual lookup tools never expose whole-book original-name guesses', async () => {
  const { readingTools } = await import('../src/main/agent/tools');
  const { repo, gateway, entities } = await contentFixture();
  try {
    const entity = entities[0];
    const secret = 'SENTINEL-AFTER-BOUNDARY-4';
    repo.putEntity({ ...entity, original: secret });
    const mark = gateway.marks(0).find((item) => item.entityId === entity.id)!;
    const lookup = readingTools(gateway).find(
      (tool) => tool.name === 'lookup_entity',
    )!;
    const result = await lookup.execute('lookup', { name: mark.name });
    expect(
      JSON.stringify([
        gateway.card(mark.id),
        gateway.lookup(mark.name),
        result,
      ]),
    ).not.toContain(secret);
    expect(gateway.card(mark.id)?.original).toBe('');
    repo.putEntity({
      ...entity,
      original: secret,
      linked: {
        qid: 'Q64',
        label: '公开地理测试点',
        original: 'Berlin',
        description: '公开地理测试点',
        types: ['Q515'],
      },
    });
    expect(gateway.card(mark.id)?.original).toBe('Berlin');
  } finally {
    repo.close();
  }
});
test('page adjacency allows whitespace and overlap but rejects skipped text', async () => {
  const { repo, gateway, chapters } = await contentFixture();
  // Build a page range CFI under the chapter body, as foliate reports pages.
  const page = (chapter: number, from: number, to: number) => {
    const split = (offset: number) =>
      /^epubcfi\((.+!\/\d+)(.+)\)$/.exec(cfiAt(chapters[chapter], offset))!;
    const [, parent, start] = split(from);
    return `epubcfi(${parent},${start},${split(to)[2]})`;
  };
  try {
    const text = chapters[1].text,
      space = text.indexOf(' 空格');
    expect(space).toBeGreaterThan(20);
    expect(
      compareCFI(collapse(page(1, 3, 20), true), cfiAt(chapters[1], 20)),
    ).toBe(0);
    expect(gateway.follows(page(1, 0, 20), page(1, 20, 40))).toBe(true);
    expect(
      gateway.follows(page(1, 0, space), page(1, space + 1, space + 5)),
    ).toBe(true);
    expect(gateway.follows(page(1, 0, 20), page(1, 17, 40))).toBe(true);
    expect(gateway.follows(page(1, 0, 20), page(1, 25, 40))).toBe(false);
    expect(gateway.follows(page(1, 10, 20), page(1, 5, 30))).toBe(false);
    const last = chapters[1].text.length;
    expect(gateway.follows(page(1, 20, last), page(2, 0, 20))).toBe(true);
    expect(gateway.follows(page(1, 20, last - 2), page(2, 0, 20))).toBe(false);
    expect(gateway.follows(page(1, 20, last), page(3, 0, 20))).toBe(false);
    expect(gateway.follows(page(1, 20, last), 'epubcfi(bad)')).toBe(false);
    // A page with no visible text reports the bare chapter body.
    const blank = bodyCFI(chapters[1]);
    expect(gateway.follows(page(1, 20, last), blank)).toBe(false);
    expect(gateway.follows(blank, page(2, 0, 20))).toBe(true);
    expect(gateway.follows(blank, page(1, 30, 60))).toBe(true);
    expect(gateway.follows(blank, page(3, 0, 20))).toBe(false);
    expect(gateway.follows(blank, page(0, 0, 20))).toBe(false);
  } finally {
    repo.close();
  }
});
