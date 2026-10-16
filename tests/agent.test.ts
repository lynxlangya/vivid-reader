import { test, expect } from 'vitest';
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  contentText,
} from '@earendil-works/pi-ai';
import { contentFixture } from './fixtures/content';
import { CompanionService } from '../src/main/agent/companion';
import { readingTools } from '../src/main/agent/tools';
import { validateAnswer } from '../src/main/agent/citations';
import { cfiAt } from '../src/main/content/epub';
import type { CompanionUpdate } from '../src/shared/companion';
const forbidden = [
  'SENTINEL-AFTER-BOUNDARY-4',
  'SENTINEL-AFTER-BOUNDARY-5',
  '后文地点雾岛',
  '后文人物远客',
  'PRIVATE-EXTRACTION-NOTE',
];
const safe = (value: unknown) => {
  for (const word of forbidden)
    expect(JSON.stringify(value)).not.toContain(word);
};
test('faux agent cannot retrieve future text, search hits, entities, or summaries; public persistence stays clipped', async () => {
  const { repo, id, gateway, chapters } = await contentFixture();
  const faux = fauxProvider({ tokensPerSecond: Infinity }),
    models = createModels();
  models.setProvider(faux.provider);
  const tools = [
    fauxToolCall('get_reading_context', {}),
    fauxToolCall('read_text', {
      start: cfiAt(chapters[3], 0),
      end: cfiAt(chapters[4], 50),
    }),
    fauxToolCall('read_text', {
      start: cfiAt(chapters[2], 0),
      end: cfiAt(chapters[4], 50),
    }),
    fauxToolCall('search_book', { query: forbidden[0] }),
    fauxToolCall('search_book', { query: forbidden[1] }),
    fauxToolCall('search_book', { query: forbidden[2] }),
    fauxToolCall('lookup_entity', { name: forbidden[2] }),
    fauxToolCall('lookup_entity', { name: forbidden[3] }),
    fauxToolCall('summarize', { scope: 'chapter' }),
    fauxToolCall('summarize', { scope: 'to_boundary' }),
  ];
  let results = 0;
  faux.setResponses([
    fauxAssistantMessage(tools, { stopReason: 'toolUse' }),
    (context) => {
      const outputs = context.messages.filter((x) => x.role === 'toolResult');
      results = outputs.length;
      outputs.forEach(safe);
      const chapter = JSON.parse(contentText(outputs.at(-2)!.content)) as {
        text: string;
      }[];
      expect(chapter).toHaveLength(1);
      expect(chapter[0].text).toBe(
        chapters[2].text.slice(0, Math.floor(chapters[2].text.length / 2)),
      );
      return fauxAssistantMessage(
        `工具返回的材料止于已读边界。[[cite:${cfiAt(chapters[1], 0)}]][[cite:${cfiAt(chapters[4], 0)}]]`,
      );
    },
  ]);
  const service = new CompanionService(repo, gateway, {
    model: faux.getModel(),
    streamFn: models.streamSimple.bind(models),
  });
  const updates: CompanionUpdate[] = [];
  try {
    await service.ask({ question: '请依据已读部分解释。' }, (update) =>
      updates.push(update),
    );
    expect(results).toBe(10);
    expect(updates.at(-1)?.error).toBeUndefined();
    safe(updates);
    safe(repo.conversations(id));
    expect(service.history().messages.at(-1)?.citations).toHaveLength(1);
    expect(service.history().messages.at(-1)?.citations?.[0].chapter).toBe(1);
    expect(JSON.stringify(repo.conversations(id))).not.toContain('toolCall');
  } finally {
    repo.close();
  }
});
test('tool schemas reject boundary overrides and re-read boundary after rewind', async () => {
  const { repo, id, gateway, chapters } = await contentFixture();
  const tools = readingTools(gateway);
  try {
    const read = tools.find((x) => x.name === 'read_text')!;
    const result = await read.execute('attempt', {
      start: cfiAt(chapters[0], 0),
      end: cfiAt(chapters[4], 50),
      boundaryCFI: cfiAt(chapters[4], 50),
    });
    expect(result.isError).toBe(true);
    safe(result);
    repo.saveProgress(id, cfiAt(chapters[0], 0), cfiAt(chapters[0], 10));
    const limited = await read.execute('retry', {
      start: cfiAt(chapters[0], 0),
      end: cfiAt(chapters[4], 50),
    });
    expect(JSON.parse(contentText(limited.content))[0].text).toBe(
      chapters[0].text.slice(0, 10),
    );
    const selection = readingTools(gateway, {
      start: cfiAt(chapters[0], 0),
      end: cfiAt(chapters[3], 1),
    }).find((x) => x.name === 'summarize')!;
    expect(
      contentText(
        (await selection.execute('selection', { scope: 'selection' })).content,
      ),
    ).toBe('[]');
  } finally {
    repo.close();
  }
});
test('citations reject future ranges, invalid positions, and incomplete streamed tokens', async () => {
  const { repo, gateway, chapters } = await contentFixture();
  try {
    const output = validateAnswer(
      `读到此处。[[cite:${cfiAt(chapters[0], 0)}]][[cite:${cfiAt(chapters[4], 0)}]][[cite:epubcfi(bad)]]`,
      gateway,
    );
    expect(output.text).toBe('读到此处。');
    expect(output.citations).toHaveLength(1);
    expect(validateAnswer('正文[[cite:epubcfi(', gateway).text).toBe('正文');
  } finally {
    repo.close();
  }
});
test('manual rewind archives dialogue and a new conversation begins empty', async () => {
  const { repo, id, gateway } = await contentFixture();
  try {
    const old = repo.conversation(id);
    repo.saveConversation(id, old.id, [
      { role: 'assistant', text: '旧的合成回答' },
    ]);
    repo.archiveConversations(id);
    const fresh = repo.conversation(id);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.messages).toEqual([]);
    repo.saveConversation(id, old.id, [
      { role: 'assistant', text: '过期写入' },
    ]);
    expect(
      repo.conversations(id).find((x) => x.id === old.id)?.messages_json,
    ).not.toContain('过期写入');
    expect(gateway.context()).toBeDefined();
  } finally {
    repo.close();
  }
});
