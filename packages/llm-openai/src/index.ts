import OpenAI from 'openai';
import type { LLMProvider, LLMResult } from '@unogo/llm';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const OpenAIChat: LLMProvider = {
  name: 'openai',
  supports: ['fast','balanced','smart','vision'],
  async chat(input: {
    system?: string;
    user?: string;
    messages?: Array<{ role: 'system'|'user'|'assistant'; content: string }>;
    tools?: any[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResult> {
    const messages = input.messages ?? [
      { role: 'system', content: input.system || '' },
      { role: 'user', content: input.user || '' }
    ];
    const res = await client.chat.completions.create({
      model: process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: input.temperature ?? 0.4,
      max_tokens: input.maxTokens ?? 512,
      tools: input.tools
    });
    const text = (res.choices?.[0]?.message?.content ?? '').slice(0, 900);
    return { text, raw: res };
  }
};
