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
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    const id = msg?.id ?? crypto.randomUUID();
    const fromRaw = msg?.from ?? '';
    const toRaw = process.env.WHATSAPP_PHONE_ID ?? '';

    const digitsOnly = (s: string) => String(s || '').replace(/\D+/g, '');
    const addPlus = (s: string) => (s ? ('+' + s) : s);
    const from = addPlus(digitsOnly(fromRaw));
    const to = addPlus(digitsOnly(toRaw));
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
    // TODO: Replace with 360dialog/Twilio BA API call
    console.log('[WA] sendText ->', to, text);
  },
  async markRead(_providerMsgId: string) {
    // optional no-op
  }
};
