import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  contentText,
} from '@earendil-works/pi-ai';
import type { FauxResponseStep } from '@earendil-works/pi-ai';
import type { Complete } from '../../src/main/pipeline/extract';
export function fakeModel(responses: (string | FauxResponseStep)[]) {
  const provider = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels();
  models.setProvider(provider.provider);
  provider.setResponses(
    responses.map((response) =>
      typeof response === 'string' ? fauxAssistantMessage(response) : response,
    ),
  );
  const complete: Complete = async (context) => {
    const result = await models.completeSimple(provider.getModel(), context);
    if (result.stopReason === 'error')
      throw new Error('Scripted model exhausted');
    return { text: contentText(result.content), usage: result.usage };
  };
  return { provider, complete };
}
