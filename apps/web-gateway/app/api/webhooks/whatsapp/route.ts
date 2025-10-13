export const runtime = 'nodejs';

import { add } from '@unogo/events';
import { WhatsAppInbound } from '@unogo/channels-whatsapp';

export async function POST(req: Request) {
  const ok = await WhatsAppInbound.verifySignature(req);
  if (!ok) return new Response('bad signature', { status: 401 });

  const message = await WhatsAppInbound.parseInbound(req);

  await add('channel.message.received', { message });

  // Optional immediate ACK (uncomment to enable)
  // await add('notification.send.requested', { to: message.from, text: 'Recibido, pensando…' });

  return Response.json({ ok: true });
}

export async function GET() {
  // keep your existing GET verification here if needed (e.g., hub.challenge)
  return new Response('ok');
}
