import { worker, add } from '@unogo/events';
import { SYSTEM_PROMPT_ES_v1 } from '@unogo/prompts';
import { OpenAIChat } from '@unogo/llm-openai';
import type { LLMProvider } from '@unogo/llm';

function pickLLM(): LLMProvider { return OpenAIChat; }

worker('llm.reply.requested', async ({ message }: { message: { text?: string; from: string } }) => {
  const provider = pickLLM();
  const res = await provider.chat({ system: SYSTEM_PROMPT_ES_v1, user: message.text || '' });
  await add('llm.reply.ready', { to: message.from, text: res.text, provider: provider.name });
});
