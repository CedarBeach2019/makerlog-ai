/**
 * Anthropic provider — Messages API with tool-use and SSE streaming.
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 */

import type {
  Message,
  ProviderConfig,
  ProviderResponse,
  StreamChunk,
  ToolDefinition,
  Provider,
} from './index.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE = 'https://api.anthropic.com/v1/messages';

function toAnthropicMessages(messages: Message[]) {
  // Anthropic separates system from the message list.
  const system: string[] = [];
  const converted: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system.push(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          },
        ],
      });
      continue;
    }

    converted.push({ role: msg.role, content: msg.content });
  }

  return { system: system.join('\n'), messages: converted };
}

function toAnthropicTools(tools?: ToolDefinition[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Record<string, unknown>,
  }));
}

function parseToolUseBlocks(
  content: Array<Record<string, unknown>>,
): ProviderResponse['toolUse'] {
  const blocks: ProviderResponse['toolUse'] = [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      blocks.push({
        id: block.id as string,
        name: block.name as string,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}

function textFromContent(
  content: Array<Record<string, unknown>>,
): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text as string)
    .join('');
}

// ── Provider ─────────────────────────────────────────────────────────────

export interface AnthropicProvider extends Provider {
  readonly name: 'anthropic';
}

export function createAnthropicProvider(
  config: ProviderConfig,
): AnthropicProvider {
  const apiKey = config.apiKey ?? '';
  const baseUrl = config.baseUrl ?? DEFAULT_BASE;
  const model = config.model ?? 'claude-sonnet-4-20250514';

  async function request(body: Record<string, unknown>) {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[anthropic] ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    name: 'anthropic',

    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
    ): Promise<ProviderResponse> {
      const { system, messages: apiMsgs } = toAnthropicMessages(messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: 8192,
        messages: apiMsgs,
      };
      if (system) body.system = system;
      const at = toAnthropicTools(tools);
      if (at) body.tools = at;

      const res = await request(body);
      const data = (await res.json()) as Record<string, unknown>;
      const content = data.content as Array<Record<string, unknown>>;
      const usage = data.usage as { input_tokens: number; output_tokens: number };

      return {
        content: textFromContent(content),
        toolUse: parseToolUseBlocks(content),
        tokens: {
          prompt: usage.input_tokens,
          completion: usage.output_tokens,
          total: usage.input_tokens + usage.output_tokens,
        },
        cost:
          (usage.input_tokens * 3.0 + usage.output_tokens * 15.0) / 1_000_000,
        model: data.model as string,
      };
    },

    async *chatStream(
      messages: Message[],
      tools?: ToolDefinition[],
    ): AsyncIterable<StreamChunk> {
      const { system, messages: apiMsgs } = toAnthropicMessages(messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: 8192,
        messages: apiMsgs,
        stream: true,
      };
      if (system) body.system = system;
      const at = toAnthropicTools(tools);
      if (at) body.tools = at;

      const res = await request(body);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('[anthropic] no response body for stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentToolId = '';
      let currentToolName = '';
      let currentToolInput = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          const type = event.type as string;

          if (type === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              yield { type: 'text', content: delta.text as string };
            } else if (delta.type === 'input_json_delta') {
              currentToolInput += delta.partial_json as string;
            }
          } else if (type === 'content_block_start') {
            const cb = event.content_block as Record<string, unknown>;
            if (cb?.type === 'tool_use') {
              currentToolId = cb.id as string;
              currentToolName = cb.name as string;
              currentToolInput = '';
            }
          } else if (type === 'content_block_stop') {
            if (currentToolId) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(currentToolInput || '{}');
              } catch { /* empty */ }
              yield {
                type: 'tool_use',
                toolUse: { id: currentToolId, name: currentToolName, input },
              };
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }
          } else if (type === 'message_stop') {
            yield { type: 'done' };
          }
        }
      }

      yield { type: 'done' };
    },

    estimateCost(tokens: number): number {
      return (tokens * 0.5 * (3.0 + 15.0)) / 1_000_000;
    },
  };
}
