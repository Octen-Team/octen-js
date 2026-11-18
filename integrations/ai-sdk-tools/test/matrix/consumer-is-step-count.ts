// Only type-checked when the installed ai exports isStepCount (ai 7 and later).
import { generateText, isStepCount } from 'ai';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

declare const model: Parameters<typeof generateText>[0]['model'];

export async function consumeWithIsStepCount(): Promise<string> {
  const { text } = await generateText({ model, tools: { webSearch: octenWebSearch() }, stopWhen: isStepCount(5), prompt: 'q' });
  return text;
}
