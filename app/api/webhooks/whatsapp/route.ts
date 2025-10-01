// app/api/webhooks/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// GET: verificación de webhook (hub.challenge)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

// POST: recibir mensajes y responder con ECO
export async function POST(req: NextRequest) {
  // (prod) verifica la firma de meta
  const signature = req.headers.get('x-hub-signature-256') || '';
  const raw = Buffer.from(await req.arrayBuffer());
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', process.env.META_APP_SECRET!)
      .update(raw)
      .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return NextResponse.json({ ok: false, reason: 'bad signature' }, { status: 401 });
  }

  const body = JSON.parse(raw.toString('utf8'));
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = msg?.from;                 // E.164 sin '+'
  const text = msg?.text?.body ?? '';

  if (from && text) {
   // const url = `https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`;
      const url = `${process.env.META_BASE_URL}/${process.env.META_GRAPH_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: `Recibido: ${text}` }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('WhatsApp send error:', res.status, err);
    }
  }

  return NextResponse.json({ ok: true });
}
