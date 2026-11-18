// Type-checked only where the installed ai is 7 or later, the first major that exports isStepCount.
import { generateText, isStepCount } from 'ai';
import { octenWebSearch } from '@octen.ai/ai-sdk-tools';

declare const model: Parameters<typeof generateText>[0]['model'];

export async function consumeWithIsStepCount(): Promise<string> {
  const { text } = await generateText({ model, tools: { webSearch: octenWebSearch() }, stopWhen: isStepCount(5), prompt: 'q' });
  return text;
}
