import { test, expect } from 'vitest';
import { contentFixture } from './fixtures/content';
import { GlossService } from '../src/main/content/gloss';
import { fakeModel } from './fixtures/faux-model';
import { cfiAt } from '../src/main/content/epub';
test('gloss model receives only prior context, cache is reused, and rewind hides it', async () => {
  const { repo, id, gateway, chapters } = await contentFixture();
  const fake = fakeModel(['合成释义']);
  const gloss = new GlossService(repo, gateway, async (context) => {
    const input = JSON.stringify(context);
    for (const word of [
      'SENTINEL-AFTER',
      '后文地点雾岛',
      '后文人物远客',
      'PRIVATE-EXTRACTION-NOTE',
    ])
      expect(input).not.toContain(word);
    expect(input).toContain('before');
    return fake.complete(context);
  });
  try {
    const mark = gateway.marks(0)[0];
    await Promise.all([gloss.ensure(mark.id), gloss.ensure(mark.id)]);
    await gloss.ensure(mark.id);
    expect(fake.provider.state.callCount).toBe(1);
    expect(gloss.card(mark.id)?.gloss.status).toBe('ready');
    repo.saveProgress(id, cfiAt(chapters[0], 0), cfiAt(chapters[0], 0));
    expect(gloss.card(mark.id)).toBeNull();
    await gloss.ensure(mark.id);
    expect(fake.provider.state.callCount).toBe(1);
  } finally {
    repo.close();
  }
});
test('gloss failures can retry without dropping basic facts', async () => {
  const { repo, gateway } = await contentFixture();
  let calls = 0;
  const gloss = new GlossService(repo, gateway, async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return {
      text: '合成释义',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
  });
  try {
    const mark = gateway.marks(0)[0];
    await gloss.ensure(mark.id);
    expect(gloss.card(mark.id)?.gloss.status).toBe('failed');
    await gloss.ensure(mark.id);
    expect(calls).toBe(1);
    await gloss.ensure(mark.id, true);
    expect(gloss.card(mark.id)?.gloss.status).toBe('ready');
  } finally {
    repo.close();
  }
});
test("only a chapter's first mention can produce the shared gloss", async () => {
  const { repo, id, gateway } = await contentFixture();
  const fake = fakeModel(['合成释义']);
  const gloss = new GlossService(repo, gateway, fake.complete);
  try {
    const mark = gateway.marks(0)[0];
    const later = repo
      .mentions(id)
      .find(
        (x) =>
          x.entityId === mark.entityId && x.chapter === 0 && x.id !== mark.id,
      )!;
    expect(later).toBeDefined();
    expect(gateway.glossInput(later.id)).toBeNull();
    await gloss.ensure(later.id, true);
    expect(fake.provider.state.callCount).toBe(0);
    expect(gloss.card(later.id)?.gloss.status).toBe('loading');
    await gloss.ensure(mark.id);
    expect(fake.provider.state.callCount).toBe(1);
    expect(gloss.card(later.id)?.gloss).toEqual({
      status: 'ready',
      text: '合成释义',
    });
  } finally {
    repo.close();
  }
});
