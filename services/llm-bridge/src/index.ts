import { worker, add } from '@unogo/events';
import { SYSTEM_PROMPT_ES_v1 } from '@unogo/prompts';
import { OpenAIChat } from '@unogo/llm-openai';
import type { LLMProvider } from '@unogo/llm';
import { appendTurn, setSummary } from '@unogo/topics';
import { logger } from '@unogo/shared';

function pickLLM(): LLMProvider { return OpenAIChat; }

function fold(system: string, summary: string, history: Array<{ role: 'user'|'assistant'; content: string }>) {
  const parts: string[] = [];
  if (summary) parts.push(`SYSTEM: Resumen del tema → ${summary}`);
  for (const t of history) parts.push(`${t.role.toUpperCase()}: ${t.content}`);
  return { system, user: parts.join('\n\n') };
}

async function summarize(convId: string, topicId: string, history: Array<{ role: 'user'|'assistant'; content: string }>) {
  const stride = Number(process.env.TOPIC_SUM_EVERY || 10);
  if (!stride || history.length % stride !== 0) return;
  const res = await OpenAIChat.chat({
    system: 'Eres un asistente que resume hilos en máx 5 líneas útiles.',
    user: history.map((t) => `${t.role}: ${t.content}`).join('\n')
  });
  if (res.text) await setSummary(convId, topicId, res.text);
}

worker('llm.reply.requested', async ({
  message,
  convId,
  topicId,
  context
}: {
  message: { text?: string; from: string };
  convId: string;
  topicId: string;
  context?: { summary?: string; history?: Array<{ role: 'user'|'assistant'; content: string }> };
}) => {
  const provider = pickLLM();
  const history = context?.history || [];
  const summary = context?.summary || '';
  const { system, user } = fold(SYSTEM_PROMPT_ES_v1, summary, history);
  const messages: Array<{ role: 'system'|'user'|'assistant'; content: string }> = [];
  messages.push({ role: 'system', content: SYSTEM_PROMPT_ES_v1 });
  if (summary) messages.push({ role: 'system', content: `Resumen del tema: ${summary}` });
  for (const t of history) messages.push({ role: t.role, content: t.content });
  if (messages.filter(m => m.role !== 'system').length === 0 && message.text) {
    messages.push({ role: 'user', content: message.text });
  }

  logger.info({ convId, topicId, history_len: history.length, has_summary: !!summary }, 'LLM Bridge: calling provider');

  const res = await provider.chat({ messages });
  const reply = res.text || '…';

  await appendTurn(convId, topicId, { role: 'assistant', content: reply, ts: Date.now() });
  await add('llm.reply.ready', { to: message.from, text: reply, provider: provider.name });
  await summarize(convId, topicId, history);
});
