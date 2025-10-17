export const runtime = 'nodejs';

import { add } from '@unogo/events';
import { WhatsAppInbound } from '@unogo/channels-whatsapp';
import { logger } from '@unogo/shared';

export async function POST(req: Request) {
  const verifyReq = req.clone();
  const parseReq = req.clone();
  const ok = await WhatsAppInbound.verifySignature(verifyReq);
  if (!ok) return new Response('bad signature', { status: 401 });

  try {
    const message = await WhatsAppInbound.parseInbound(parseReq);
    await add('channel.message.received', { message });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'whatsapp:status-event') {
      logger.info({ provider: 'whatsapp' }, 'Ignored WhatsApp status event');
      return Response.json({ ok: true });
    }
    if (code === 'whatsapp:missing-message' || code === 'whatsapp:missing-participants') {
      logger.warn({ provider: 'whatsapp', err: code }, 'Dropping malformed WhatsApp webhook');
      return Response.json({ ok: true });
    }
    throw err;
  }

  // Optional immediate ACK (uncomment to enable)
  // await add('notification.send.requested', { to: message.from, text: 'Recibido, pensando…' });

  return Response.json({ ok: true });
}

export async function GET() {
  // keep your existing GET verification here if needed (e.g., hub.challenge)
  return new Response('ok');
}
