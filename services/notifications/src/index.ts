import { worker } from '@unogo/events';
import { WhatsAppOutbound } from '@unogo/channels-whatsapp';

// LLM final replies
worker('llm.reply.ready', async ({ to, text }: { to: string; text: string }) => {
  await WhatsAppOutbound.sendText(to, text);
});

// Generic notifications (ACKs, reminders, nudges)
worker('notification.send.requested', async ({ to, text }: { to: string; text: string }) => {
  await WhatsAppOutbound.sendText(to, text);
});
