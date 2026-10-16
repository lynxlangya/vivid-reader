import { createModels, contentText, type Context } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
export const models = createModels();
models.setProvider(deepseekProvider());
export function getTextModel(id?: string) {
  const available = models.getModels('deepseek');
  const model =
    available.find((x) => x.id === (id ?? 'deepseek-flash')) ?? available[0];
  if (!model) throw new Error('No DeepSeek model available');
  return model;
}
export async function completeText(
  context: Context,
  apiKey: string,
  modelId?: string,
) {
  const message = await models.completeSimple(getTextModel(modelId), context, {
    apiKey,
    signal: AbortSignal.timeout(60000),
  });
  if (message.stopReason === 'error') throw new Error('Model request failed');
  return { text: contentText(message.content), usage: message.usage };
}
