import { test, expect } from 'vitest';
import { completeText } from '../../src/main/llm/model';
test.skipIf(!process.env.DEEPSEEK_API_KEY)(
  'calls DeepSeek through pi-ai in the main layer',
  async () => {
    const result = await completeText(
      {
        messages: [
          {
            role: 'user',
            content: 'Reply with the word ready.',
            timestamp: Date.now(),
          },
        ],
      },
      process.env.DEEPSEEK_API_KEY!,
    );
    expect(result.text.length).toBeGreaterThan(0);
  },
);
