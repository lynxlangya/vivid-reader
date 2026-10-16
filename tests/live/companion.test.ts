import { test, expect } from 'vitest';
import { contentFixture } from '../fixtures/content';
import { CompanionService } from '../../src/main/agent/companion';
import { getTextModel, models } from '../../src/main/llm/model';
test.skipIf(!process.env.DEEPSEEK_API_KEY)(
  'real synthetic reading conversation and summary stay within source boundary',
  async () => {
    const { repo, gateway } = await contentFixture();
    try {
      const service = new CompanionService(repo, gateway, {
        model: getTextModel(),
        streamFn: models.streamSimple.bind(models),
        getApiKey: async () => process.env.DEEPSEEK_API_KEY,
      });
      for (const request of [
        { question: '请解释已读部分中的人物与环境关系。' },
        { question: '', scope: 'to_boundary' as const },
      ]) {
        await service.ask(request, () => {});
        const messages = service.history().messages;
        expect(messages.at(-1)?.role).toBe('assistant');
        expect(messages.at(-1)?.text.length).toBeGreaterThan(0);
        for (const word of [
          'SENTINEL-AFTER-BOUNDARY-4',
          'SENTINEL-AFTER-BOUNDARY-5',
          '后文地点雾岛',
          '后文人物远客',
        ])
          expect(JSON.stringify(messages)).not.toContain(word);
      }
    } finally {
      repo.close();
    }
  },
  130000,
);
