// app/api/webhooks/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { openai, SYSTEM_PROMPT } from "@/lib/openai";

/** =======================
 *  Helpers WhatsApp: typing & read
 *  ======================= */
function waApiUrl() {
  const base = process.env.META_BASE_URL ?? "https://graph.facebook.com";
  return `${base}/${process.env.META_GRAPH_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`;
}

async function waTyping(to: string, seconds = 8) {
  const url = waApiUrl();
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "typing",
    typing: { duration: Math.max(1, Math.min(seconds, 10)) }, // 1..10s
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("waTyping error:", e);
  }
}

async function waMarkRead(messageId: string) {
  const url = waApiUrl();
  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("waMarkRead error:", e);
  }
}

/** =======================
 *  GET: verificación de webhook (hub.challenge)
 *  ======================= */
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

/** =======================
 *  POST: recibir mensajes y responder con OpenAI
 *  ======================= */
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

  // Solo procesamos mensajes de texto
  const from: string | undefined = msg?.from;                 // E.164 sin '+'
  const text: string = msg?.text?.body ?? '';
  const msgId: string | undefined = msg?.id;

  if (from && text) {
    // Marca como leído (checks azules) y muestra “UNO está escribiendo…”
    if (msgId) waMarkRead(msgId); // no bloqueamos la ejecución
    waTyping(from, 8);

    // 1) Llamar a OpenAI con el mensaje del usuario
    let aiText = "Perdona, tuve un problema al pensar mi respuesta.";
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // ligero y rápido para WhatsApp
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text }
        ],
        temperature: 0.4,
        max_tokens: 256, // controla costo/latencia
      });
      aiText = completion.choices[0]?.message?.content?.trim() || aiText;

      // Recorta por si el modelo se extiende
      if (aiText.length > 900) aiText = aiText.slice(0, 900) + "…";
    } catch (e) {
      console.error("OpenAI error:", e);
      aiText = "Ups, no pude responder ahora. ¿Puedes repetir en breve?";
    }

    // Refresca typing si sospechas que ya expiró (opcional)
    waTyping(from, 6);

    // 2) Enviar la respuesta de OpenAI por WhatsApp
    const url = waApiUrl();
    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: aiText },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("WhatsApp send error:", res.status, err);
    }
  }

  return NextResponse.json({ ok: true });
}
