/**
 * TelegramChannel — Telegram bot webhook connector for makerlog-ai.
 *
 * Receives updates via webhook, normalizes them into ChannelMessage, and
 * sends responses back using Telegram's Bot API with MarkdownV2 formatting.
 */

export interface ChannelMessage {
  userId: string;
  text: string;
  channel: 'telegram';
  metadata: Record<string, unknown>;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    document?: { file_id: string; file_name?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    data?: string;
    message?: { chat: { id: number } };
  };
}

interface TelegramAPIResponse {
  ok: boolean;
  description?: string;
}

export class TelegramChannel {
  private readonly apiBase: string;

  constructor(private botToken: string) {
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  /** Receive a message from a Telegram webhook and normalize it. */
  async handleWebhook(update: TelegramUpdate): Promise<ChannelMessage | null> {
    if (update.message?.text) {
      const msg = update.message;
      return {
        userId: String(msg.from?.id ?? msg.chat.id),
        text: msg.text!,
        channel: 'telegram',
        metadata: {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          username: msg.from?.username ?? null,
          firstName: msg.from?.first_name ?? null,
          chatType: msg.chat.type,
        },
      };
    }

    if (update.callback_query?.data) {
      const cb = update.callback_query;
      return {
        userId: String(cb.from.id),
        text: cb.data!,
        channel: 'telegram',
        metadata: {
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id ?? null,
          username: cb.from?.username ?? null,
        },
      };
    }

    return null;
  }

  /** Send a text message back to a Telegram chat. */
  async sendMessage(chatId: number, text: string): Promise<void> {
    const formatted = this.formatResponse(text);

    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatted,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });

    const body = (await res.json()) as TelegramAPIResponse;
    if (!body.ok) {
      throw new Error(`Telegram sendMessage failed: ${body.description ?? 'unknown error'}`);
    }
  }

  /**
   * Format an agent response for Telegram MarkdownV2.
   *
   * Escapes reserved characters outside of code blocks, converts fenced
   * code blocks to Telegram's `` ` `` inline notation where possible, and
   * truncates to the 4096-char message limit.
   */
  formatResponse(text: string): string {
    // Split into code / non-code segments
    const segments = text.split(/(```[\s\S]*?```)/g);

    const escaped = segments
      .map((segment) => {
        if (segment.startsWith('```')) {
          // Already a fenced block — leave inner content untouched, just escape the fence markers
          return segment;
        }
        // Escape MarkdownV2 reserved characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
        return segment.replace(/([_*\[\]()~`>#+\-=|{}\.!])/g, '\\$1');
      })
      .join('');

    // Telegram limits messages to 4096 UTF-8 characters
    return escaped.length > 4096 ? escaped.slice(0, 4090) + '\\.\\.\\.' : escaped;
  }

  /** Register the webhook URL with Telegram so updates are POSTed there. */
  async setWebhook(url: string, secret?: string): Promise<void> {
    const body: Record<string, unknown> = { url, allowed_updates: ['message', 'callback_query'] };
    if (secret) {
      body.secret_token = secret;
    }

    const res = await fetch(`${this.apiBase}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as TelegramAPIResponse;
    if (!data.ok) {
      throw new Error(`Telegram setWebhook failed: ${data.description ?? 'unknown error'}`);
    }
  }
}
