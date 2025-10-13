import { worker, add } from '@unogo/events';
import { logger } from '@unogo/shared';

worker('channel.message.received', async ({ message }) => {
  logger.info({ from: message.from, provider: message.provider }, 'Orchestrator: LLM requested');
  await add('llm.reply.requested', { message });
});
