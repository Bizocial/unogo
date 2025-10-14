import { worker, add } from '@unogo/events';
import { logger } from '@unogo/shared';
import {
  detectOrCreateTopic,
  appendTurn,
  getContext,
  setActive,
  getActive,
  listTopics
} from '@unogo/topics';

const CMD_LIST = /^listar temas\b/i;
const CMD_SWITCH = /^cambiar a:\s*(.+)$/i;
const CMD_NEW = /^nuevo tema:\s*(.+)$/i;
const CMD_RESET = /^(reset|reinicia)\b/i;

function convIdOf(msg: any) {
  return [msg.provider, msg.from, msg.to].join(':');
}

function inboundTimestamp(msg: any): number | null {
  // WhatsApp timestamp in seconds, convert to ms
  if (msg?.provider === 'whatsapp') {
    try {
      const tsSec = msg?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp;
      const n = Number(tsSec);
      if (Number.isFinite(n) && n > 0) return n * 1000;
    } catch {}
  }
  return null;
}

worker('channel.message.received', async ({ message }: { message: { text?: string; from: string; to: string; provider: string } }) => {
  const convId = convIdOf(message);
  const text = (message.text || '').trim();
  const now = Date.now();
  const strictWindowMs = Number(process.env.STRICT_REPLY_WINDOW_MS || 90000);
  const tIn = inboundTimestamp(message);
  if (strictWindowMs > 0 && tIn && (now - tIn) > strictWindowMs) {
    logger.info({ convId, age_ms: now - tIn }, 'Skipping stale inbound message');
    return;
  }

  // Comandos
  if (CMD_LIST.test(text)) {
    const topics = await listTopics(convId);
    const lines = topics.map((t: { id: string; title: string }) => `• ${t.id.slice(0, 6)} — ${t.title}`);
    await add('notification.send.requested', {
      to: message.from,
      text: lines.length ? `Temas:\n${lines.join('\n')}` : 'No hay temas aún.'
    });
    return;
  }
  const sw = text.match(CMD_SWITCH);
  if (sw) {
    const topics = await listTopics(convId);
    const target = topics.find(
      (t: { id: string; title: string }) => t.title.toLowerCase().includes(sw[1].toLowerCase()) || t.id.startsWith(sw[1])
    );
    if (target) {
      await setActive(convId, target.id);
      await add('notification.send.requested', {
        to: message.from,
        text: `Ok, cambié al tema: ${target.title}`
      });
    } else {
      await add('notification.send.requested', { to: message.from, text: 'No encontré ese tema.' });
    }
    return;
  }
  const nw = text.match(CMD_NEW);
  if (nw) {
    const { topicId } = await detectOrCreateTopic(convId, nw[1]);
    await setActive(convId, topicId);
    await add('notification.send.requested', { to: message.from, text: `Nuevo tema creado: ${nw[1]}` });
    return;
  }
  if (CMD_RESET.test(text)) {
    await setActive(convId, '');
    await add('notification.send.requested', {
      to: message.from,
      text: 'Listo, empecemos un tema nuevo. Cuéntame.'
    });
    return;
  }

  // Topic routing automático
  const { topicId, created } = await detectOrCreateTopic(convId, text);
  logger.info({ convId, topicId, created }, 'Topic selected');

  // Log before append
  const beforeCtx = await getContext(convId, topicId);
  logger.info({ convId, topicId, history_len: beforeCtx.history?.length || 0, has_summary: !!beforeCtx.summary }, 'Context before append');

  await appendTurn(convId, topicId, { role: 'user', content: text, ts: Date.now() });

  // Ensure latest turn present
  const ctx = await getContext(convId, topicId);
  logger.info({ convId, topicId, history_len: ctx.history?.length || 0, has_summary: !!ctx.summary }, 'Context after append');

  // Optional immediate ACK to improve UX on slow paths
  const ackMs = Number(process.env.ACK_WHEN_LATENCY_MS || 0);
  if (ackMs > 0 &&
      !CMD_LIST.test(text) &&
      !CMD_SWITCH.test(text) &&
      !CMD_NEW.test(text) &&
      !CMD_RESET.test(text)) {
    await add('notification.send.requested', { to: message.from, text: 'Recibido, pensando…' });
  }
  await add('llm.reply.requested', { message, convId, topicId, context: ctx });
});
