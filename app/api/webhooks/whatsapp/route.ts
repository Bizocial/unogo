// app/api/webhooks/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { openai, SYSTEM_PROMPT } from '@/lib/openai';

// Helpers
const GRAPH_BASE =
  process.env.META_BASE_URL ?? 'https://graph.facebook.com';
const GRAPH_VER =
  process.env.META_GRAPH_API_VERSION ?? 'v23.0'; // o el que uses

async function waFetch(path: string, body: unknown) {
  const url = `${GRAPH_BASE}/${GRAPH_VER}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp API error:', res.status, err);
  }
  return res;
}

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

// POST: recibir mensaje -> marcar leído -> typing -> llamar OpenAI -> responder
export async function POST(req: NextRequest) {
  // Verificación de firma
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
  const change = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  const from = msg?.from as string | undefined;   // E.164 sin '+'
  const text = msg?.text?.body as string | undefined;
  const wamid = msg?.id as string | undefined;

  if (from && text && wamid) {
    const phoneId = process.env.META_PHONE_NUMBER_ID!;
    // 1) marcar como leído (para que salgan checks azules)
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
    }); // doc: endpoint messages -> mark as read

    // 2) enviar typing indicator (p. ej. 8s)
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to: from,
      type: 'typing',
      typing: { duration: 8 }, // segundos (máx 25 aprox.)
    }); // ver colección pública de Meta "Send typing indicator and read receipt"

    // 3) Llamar a OpenAI en paralelo al indicador de escritura
    let aiText = 'Perdona, tuve un problema al pensar mi respuesta.';
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.4,
      });
      aiText = completion.choices[0]?.message?.content?.trim() || aiText;
      if (aiText.length > 900) aiText = aiText.slice(0, 900) + '…';
    } catch (e) {
      console.error('OpenAI error:', e);
      aiText = 'Ups, no pude responder ahora. ¿Puedes repetir en breve?';
    }

    // 4) Enviar la respuesta final
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: aiText },
    });
  }

  return NextResponse.json({ ok: true });
}
