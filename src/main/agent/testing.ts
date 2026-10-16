import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  contentText,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
export function testCompanionBackend() {
  const faux = fauxProvider({
      tokensPerSecond: 100,
      tokenSize: { min: 2, max: 4 },
    }),
    models = createModels();
  models.setProvider(faux.provider);
  const streamFn: StreamFn = (model, context, options) => {
    const last = context.messages.at(-1);
    if (last?.role === 'toolResult') {
      const value = contentText(last.content);
      const match = value.match(/"startCFI":"([^"]+)"/);
      faux.appendResponses([
        fauxAssistantMessage(
          `书里用土地与行旅说明人和环境的关系。这段回答只依据已读部分。${match ? `[[cite:${match[1]}]]` : ''}`,
        ),
      ]);
    } else
      faux.appendResponses([
        fauxAssistantMessage(
          fauxToolCall('summarize', { scope: 'to_boundary' }),
          { stopReason: 'toolUse' },
        ),
      ]);
    return models.streamSimple(model, context, options);
  };
  return { model: faux.getModel(), streamFn };
}
