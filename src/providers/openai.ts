/**
 * OpenAI-compatible provider — works with any endpoint that speaks the
 * /v1/chat/completions dialect (OpenAI, Together, Mistral, local, etc.).
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

const DEFAULT_BASE = 'https://api.openai.com/v1/chat/completions';

function toOpenAITools(tools?: ToolDefinition[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function parseToolCalls(
  choices: Array<Record<string, unknown>>,
): ProviderResponse['toolUse'] {
  const choice = choices[0];
  if (!choice) return undefined;
  const calls = (choice.message as Record<string, unknown>)?.tool_calls as
    | Array<Record<string, unknown>>
    | undefined;
  if (!calls?.length) return undefined;

  return calls.map((c) => {
    const fn = c.function as Record<string, unknown>;
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse((fn.arguments as string) || '{}');
    } catch { /* empty */ }
    return {
      id: c.id as string,
      name: fn.name as string,
      input,
    };
  });
}

// ── Provider ─────────────────────────────────────────────────────────────

export interface OpenAIProvider extends Provider {
  readonly name: 'openai';
}

export function createOpenAIProvider(
  config: ProviderConfig,
): OpenAIProvider {
  const apiKey = config.apiKey ?? '';
  const baseUrl = config.baseUrl ?? DEFAULT_BASE;
  const model = config.model ?? 'gpt-4o';

  async function request(body: Record<string, unknown>) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[openai] ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    name: 'openai',

    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
    ): Promise<ProviderResponse> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        })),
      };

      const oaiTools = toOpenAITools(tools);
      if (oaiTools) body.tools = oaiTools;

      const res = await request(body);
      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Array<Record<string, unknown>>;
      const usage = data.usage as {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };

      const choice = choices[0];
      const msg = choice?.message as Record<string, unknown> | undefined;

      return {
        content: (msg?.content as string) ?? '',
        toolUse: parseToolCalls(choices),
        tokens: {
          prompt: usage?.prompt_tokens ?? 0,
          completion: usage?.completion_tokens ?? 0,
          total: usage?.total_tokens ?? 0,
        },
        cost:
          ((usage?.prompt_tokens ?? 0) * 2.5 +
            (usage?.completion_tokens ?? 0) * 10.0) /
          1_000_000,
        model: (data.model as string) ?? model,
      };
    },

    async *chatStream(
      messages: Message[],
      tools?: ToolDefinition[],
    ): AsyncIterable<StreamChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        })),
        stream: true,
      };

      const oaiTools = toOpenAITools(tools);
      if (oaiTools) body.tools = oaiTools;

      const res = await request(body);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('[openai] no response body for stream');

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
          if (!raw || raw === '[DONE]') {
            yield { type: 'done' };
            continue;
          }

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(raw);
          } catch {
            continue;
          }

          const choices = chunk.choices as Array<Record<string, unknown>>;
          const choice = choices?.[0];
          if (!choice) continue;

          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          // Text content
          if (typeof delta.content === 'string') {
            yield { type: 'text', content: delta.content };
          }

          // Tool calls
          const toolCalls = delta.tool_calls as
            | Array<Record<string, unknown>>
            | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const fn = tc.function as Record<string, unknown> | undefined;
              if (tc.id) {
                // Starting a new tool call
                if (currentToolId) {
                  // Flush previous
                  let input: Record<string, unknown> = {};
                  try {
                    input = JSON.parse(currentToolInput || '{}');
                  } catch { /* empty */ }
                  yield {
                    type: 'tool_use',
                    toolUse: {
                      id: currentToolId,
                      name: currentToolName,
                      input,
                    },
                  };
                }
                currentToolId = tc.id as string;
                currentToolName = (fn?.name as string) ?? '';
                currentToolInput = '';
              }
              if (fn?.arguments) {
                currentToolInput += fn.arguments as string;
              }
            }
          }

          // Finish reason
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            if (currentToolId) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(currentToolInput || '{}');
              } catch { /* empty */ }
              yield {
                type: 'tool_use',
                toolUse: {
                  id: currentToolId,
                  name: currentToolName,
                  input,
                },
              };
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }
            if (choice.finish_reason === 'stop') {
              yield { type: 'done' };
            }
          }
        }
      }

      // Flush any remaining tool call
      if (currentToolId) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(currentToolInput || '{}');
        } catch { /* empty */ }
        yield {
          type: 'tool_use',
          toolUse: { id: currentToolId, name: currentToolName, input },
        };
      }

      yield { type: 'done' };
    },

    estimateCost(tokens: number): number {
      return (tokens * 0.5 * (2.5 + 10.0)) / 1_000_000;
    },
  };
}
