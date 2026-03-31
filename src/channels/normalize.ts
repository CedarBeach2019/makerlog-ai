/**
 * normalize.ts — Message normalizer for makerlog-ai.
 *
 * Converts incoming messages from any supported channel into a single
 * NormalizedMessage format that the agent core can process uniformly.
 */

export interface NormalizedMessage {
  userId: string;
  text: string;
  channel: string;
  attachments?: Array<{ type: string; url: string }>;
  metadata: Record<string, unknown>;
}

/**
 * Normalize a Telegram update into a NormalizedMessage.
 * Returns null if the update does not contain a usable message.
 */
export function normalizeTelegram(update: unknown): NormalizedMessage | null {
  const msg = update as Record<string, unknown> | null;
  if (!msg) return null;

  const message = msg.message as Record<string, unknown> | undefined;
  const callback = msg.callback_query as Record<string, unknown> | undefined;

  const source = message ?? callback?.message;
  if (!source) return null;

  const from = (message?.from ?? callback?.from) as Record<string, unknown> | undefined;
  const chat = (source as Record<string, unknown>).chat as Record<string, unknown> | undefined;

  const text = (message?.text as string) ?? (callback?.data as string) ?? null;
  if (!text) return null;

  return {
    userId: String(from?.id ?? chat?.id ?? 'unknown'),
    text,
    channel: 'telegram',
    attachments: [],
    metadata: {
      chatId: chat?.id,
      messageId: message?.message_id,
      username: from?.username,
      callbackQueryId: callback?.id,
    },
  };
}

/**
 * Normalize a Discord interaction into a NormalizedMessage.
 * Returns null if the interaction is a PING or otherwise not usable.
 */
export function normalizeDiscord(interaction: unknown): NormalizedMessage | null {
  const inter = interaction as Record<string, unknown> | null;
  if (!inter) return null;

  // PING — nothing to normalize
  if (inter.type === 1) return null;

  const data = inter.data as Record<string, unknown> | undefined;
  const member = inter.member as Record<string, unknown> | undefined;
  const user = (member?.user ?? inter.user) as Record<string, unknown> | undefined;

  const commandName = data?.name as string | undefined;
  const options = data?.options as Array<Record<string, unknown>> | undefined;
  const argsText = (options ?? []).map((o) => String(o.value ?? '')).join(' ');

  const text = commandName ? `/${commandName} ${argsText}`.trim() : null;
  if (!text) return null;

  return {
    userId: String(user?.id ?? 'unknown'),
    text,
    channel: 'discord',
    attachments: [],
    metadata: {
      interactionId: inter.id,
      interactionToken: inter.token,
      commandName,
      username: user?.username,
      channelId: inter.channel_id,
      guildId: inter.guild_id,
    },
  };
}

/**
 * Normalize an HTTP Request (REST API chat) into a NormalizedMessage.
 * Always returns a message — the caller is responsible for auth validation.
 */
export function normalizeHTTP(request: Request): NormalizedMessage {
  // For GET requests with query params
  const url = new URL(request.url);
  const queryText = url.searchParams.get('q') ?? url.searchParams.get('text') ?? '';
  const queryUser = url.searchParams.get('userId') ?? 'anonymous';

  // Will be populated by the caller after parsing the body
  return {
    userId: queryUser,
    text: queryText,
    channel: 'http',
    attachments: [],
    metadata: {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
    },
  };
}
