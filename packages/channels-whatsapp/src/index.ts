import type {
  ChannelInboundAdapter,
  ChannelOutboundAdapter,
  ChatMessage
} from '@unogo/channels';
import crypto from 'node:crypto';
import { logger } from '@unogo/shared';

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const WhatsAppInbound: ChannelInboundAdapter & {
  verifySignature(raw: string, headers: Record<string, string>): Promise<boolean>;
  parseInbound(raw: string, headers?: Record<string, string>): Promise<ChatMessage>;
} = {
  async verifySignature(rawOrReq: string | Request, headersArg?: Record<string, string>) {
    const secret = process.env.META_APP_SECRET || '';
    let raw: string;
    let headers: Record<string, string>;
    if (typeof rawOrReq === 'string') {
      raw = rawOrReq;
      headers = headersArg || {};
    } else {
      raw = await rawOrReq.text();
      headers = Object.fromEntries(rawOrReq.headers.entries());
    }
    const header = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'] || '';
    if (!secret || !header.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    return safeEqual(expected, header);
  },

  async parseInbound(rawOrReq: string | Request) {
    const raw = typeof rawOrReq === 'string' ? rawOrReq : await rawOrReq.text();
    const body = JSON.parse(raw);
    const change = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) {
      logger.warn({ provider: 'whatsapp', body }, 'WA inbound missing messages payload');
      throw new Error('whatsapp:missing-message');
    }
    const metadata = change?.metadata || {};

    const id = msg?.id ?? crypto.randomUUID();
    const contact = change?.contacts?.[0];
    const fromRaw = msg?.from ?? contact?.wa_id ?? '';
    const toRaw = metadata.phone_number_id ?? metadata.display_phone_number ?? process.env.META_PHONE_NUMBER_ID ?? process.env.WHATSAPP_PHONE_ID ?? '';

    const digitsOnly = (s: string) => String(s || '').replace(/\D+/g, '');
    const addPlus = (s: string) => (s ? ('+' + s) : s);
    const from = addPlus(digitsOnly(fromRaw));
    const to = addPlus(digitsOnly(toRaw));
    if (!from || !to) {
      logger.warn({ provider: 'whatsapp', raw_from: fromRaw, raw_to: toRaw }, 'WA inbound missing from/to');
      throw new Error('whatsapp:missing-participants');
    }
    const type = msg?.type ?? 'text';
    const text = type === 'text' ? (msg?.text?.body ?? '') : undefined;

    // Safe debug (masked PII)
    const mask = (s: string) => (s ? s.replace(/.(?=.{2})/g, '*') : s);
    logger.info({ provider: 'whatsapp', from: mask(from), to: mask(to) }, 'WA normalize from/to');

    const chat: ChatMessage = {
      id,
      provider: 'whatsapp',
      from,
      to,
      type: type === 'text' || type === 'image' || type === 'audio' ? type as any : 'text',
      text,
      mediaUrl: undefined,
      raw: body
    };
    return chat;
  }
};

export const WhatsAppOutbound: ChannelOutboundAdapter = {
  async sendText(to: string, text: string) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      logger.warn({ to }, 'WhatsApp token or phone id missing');
      return;
    }

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ to, status: res.status, body }, 'WhatsApp send failed');
      throw new Error(`WhatsApp API ${res.status}`);
    }

    logger.info({ to }, 'WhatsApp message sent');
  },
  async markRead(_providerMsgId: string) {
    // optional no-op
  }
};
