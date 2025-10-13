import OpenAI from 'openai';
import type { LLMProvider, LLMResult } from '@unogo/llm';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const OpenAIChat: LLMProvider = {
  name: 'openai',
  supports: ['fast','balanced','smart','vision'],
  async chat({ system, user, tools, maxTokens, temperature }: {
    system: string;
    user: string;
    tools?: any[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResult> {
    const res = await client.chat.completions.create({
      model: process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: temperature ?? 0.4,
      max_tokens: maxTokens ?? 512,
      tools
    });
    const text = (res.choices?.[0]?.message?.content ?? '').slice(0, 900);
    return { text, raw: res };
  }
};
