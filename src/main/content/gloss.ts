import type { Repository } from '../db/repository';
import type { Complete } from '../pipeline/extract';
import { ContentGateway } from './gateway';
export class GlossService {
  private pending = new Map<string, Promise<void>>();
  private failures = new Set<string>();
  constructor(
    private repo: Repository,
    private gateway: ContentGateway,
    private complete: Complete,
  ) {}
  card(id: string) {
    const card = this.gateway.card(id);
    if (card && this.failures.has(id) && card.gloss.status !== 'ready')
      card.gloss = { status: 'failed' };
    return card;
  }
  async ensure(id: string, retry = false): Promise<void> {
    const input = this.gateway.glossInput(id);
    if (!input || this.repo.gloss(input.entityId, input.chapterId)) return;
    const key = input.entityId + ':' + input.chapterId;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.failures.has(id) && !retry) return;
    this.failures.delete(id);
    const job = (async () => {
      try {
        const result = await this.complete({
          systemPrompt:
            'Explain what the named entity means at this point in the quoted reading. Use only the supplied prior text. Give a concise Chinese explanation, with no predictions or later material.',
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                name: input.name,
                before: input.before,
                previous: input.previous,
              }),
              timestamp: Date.now(),
            },
          ],
        });
        this.repo.saveGloss(
          input.entityId,
          input.chapterId,
          result.text,
          'deepseek',
        );
      } catch {
        this.failures.add(id);
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, job);
    await job;
  }
}
