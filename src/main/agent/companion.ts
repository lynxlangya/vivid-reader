import {
  Agent,
  type StreamFn,
  type AgentMessage,
} from '@earendil-works/pi-agent-core';
import { contentText, type Model, type Api } from '@earendil-works/pi-ai';
import type {
  AskRequest,
  CompanionUpdate,
  ConversationMessage,
} from '../../shared/companion';
import type { Repository } from '../db/repository';
import { ContentGateway } from '../content/gateway';
import { readingTools } from './tools';
import { validateAnswer } from './citations';
export class CompanionService {
  private agent?: Agent;
  private running = false;
  private generation = 0;
  constructor(
    private repo: Repository,
    private gateway: ContentGateway,
    private config: {
      model: Model<Api>;
      streamFn: StreamFn;
      getApiKey?: () => Promise<string | undefined>;
    },
  ) {}
  history(): CompanionUpdate {
    return {
      messages: this.repo.conversation(this.gateway.bookId).messages,
      busy: this.running,
    };
  }
  cancel() {
    this.generation++;
    this.agent?.abort();
    this.running = false;
  }
  async ask(request: AskRequest, emit: (value: CompanionUpdate) => void) {
    if (this.running) throw new Error('Companion is busy');
    if (
      request.scope === 'selection' &&
      (!request.selection ||
        !this.gateway.selectionAllowed(
          request.selection.start,
          request.selection.end,
        ))
    )
      throw new Error('Selection is outside read boundary');
    const saved = this.repo.conversation(this.gateway.bookId),
      generation = ++this.generation;
    const prompt = request.scope
      ? `请总结${request.scope === 'chapter' ? '本章已读部分' : request.scope === 'to_boundary' ? '至已读边界的内容' : '选中的已读内容'}。`
      : request.question.trim();
    if (!prompt) return;
    const prior: AgentMessage[] = saved.messages.map((message) =>
      message.role === 'user'
        ? { role: 'user', content: message.text, timestamp: Date.now() }
        : {
            role: 'assistant',
            content: [{ type: 'text', text: message.text }],
            api: this.config.model.api,
            provider: this.config.model.provider,
            model: this.config.model.id,
            stopReason: 'stop',
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          },
    );
    const visible: ConversationMessage[] = [
      ...saved.messages,
      { role: 'user', text: prompt },
    ];
    const reply: ConversationMessage = {
      role: 'assistant',
      text: '',
      citations: [],
    };
    const tools = readingTools(this.gateway, request.selection);
    const context = this.gateway.context();
    const agent = new Agent({
      initialState: {
        model: this.config.model,
        systemPrompt: `You are a quiet Chinese reading companion. Use only the clipped reading tools. Do not predict unread content, even from training memory. Always retrieve source text before answering. Cite sources with [[cite:epubcfi(...)]] using a CFI from a tool result. Never invent a citation. Reading context: ${JSON.stringify(context)}`,
        tools,
        messages: undefined,
      },
      streamFn: this.config.streamFn,
      getApiKey: this.config.getApiKey,
      toolExecution: 'sequential',
      finishTurn: () => (++turns >= 12 ? { action: 'end' } : undefined),
    });
    let turns = 0;
    // Rebuild only validated public dialogue; tool arguments and reasoning never persist.
    agent.state.messages = [...agent.state.messages, ...prior];
    this.agent = agent;
    this.running = true;
    const current = () => this.generation === generation;
    const update = (busy: boolean, error?: string) => {
      if (current())
        emit({
          messages: reply.text || busy ? [...visible, { ...reply }] : visible,
          busy,
          ...(error ? { error } : {}),
        });
    };
    agent.subscribe((event) => {
      if (!current()) return;
      if (
        (event.type === 'message_update' || event.type === 'message_end') &&
        event.message.role === 'assistant'
      ) {
        const answer = validateAnswer(
          contentText(event.message.content),
          this.gateway,
        );
        reply.text = answer.text;
        reply.citations = answer.citations;
        update(true);
      }
    });
    const timeout = setTimeout(() => agent.abort(), 60000);
    update(true);
    try {
      await agent.prompt(prompt);
      if (!current()) return;
      if (agent.state.errorMessage || !reply.text)
        throw new Error('No response');
      const safe = validateAnswer(reply.text, this.gateway);
      reply.text = safe.text;
      reply.citations = reply.citations?.filter((c) =>
        this.gateway.selectionAllowed(c.cfi, c.cfi),
      );
      this.repo.saveConversation(this.gateway.bookId, saved.id, [
        ...visible,
        reply,
      ]);
      this.running = false;
      update(false);
    } catch {
      if (current()) {
        this.running = false;
        reply.text = '';
        update(false, '伴读暂时未能回答，请检查模型设置后重试。');
      }
    } finally {
      clearTimeout(timeout);
      if (current()) {
        this.running = false;
        this.agent = undefined;
      }
    }
  }
}
