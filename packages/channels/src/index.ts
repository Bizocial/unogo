export type ChatType = 'text' | 'image' | 'audio';

export interface ChatMessage {
  id: string;
  provider: 'whatsapp' | 'telegram' | 'unknown';
  from: string;
  to: string;
  type: ChatType;
  text?: string;
  mediaUrl?: string;
  raw: unknown;
}

export interface ChannelInboundAdapter {
  verifySignature(req: Request): Promise<boolean>;
  parseInbound(req: Request): Promise<ChatMessage>;
}

export interface ChannelOutboundAdapter {
  sendText(to: string, text: string): Promise<void>;
  markRead?(providerMsgId: string): Promise<void>;
}
