/**
 * Ollama provider — local LLMs via native /api/chat or OpenAI-compat
 * /v1/chat/completions.
 *
 * No API key needed. Supports model auto-detection from /api/tags.
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

function baseUrl(config: ProviderConfig): string {
  return config.baseUrl ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function fetchModelList(
  base: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${stripTrailingSlash(base)}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

function toOllamaMessages(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function toOllamaTools(tools?: ToolDefinition[]) {
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

// ── Provider ─────────────────────────────────────────────────────────────

export interface OllamaProvider extends Provider {
  readonly name: 'ollama';
}

export function createOllamaProvider(
  config: ProviderConfig,
): OllamaProvider {
  const base = stripTrailingSlash(baseUrl(config));
  const model = config.model ?? 'llama3';

  async function resolveModel(): Promise<string> {
    // If the user specified a model, trust it
    if (config.model) return config.model;

    // Otherwise try auto-detection
    const available = await fetchModelList(base);
    if (available.length > 0) {
      // Prefer models that look like instruction-tuned
      const preferred = available.find(
        (n) => n.includes('llama3') || n.includes('mistral') || n.includes('qwen'),
      );
      return preferred ?? available[0];
    }

    return 'llama3'; // sensible default
  }

  return {
    name: 'ollama',

    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
    ): Promise<ProviderResponse> {
      const resolvedModel = await resolveModel();

      // Use the OpenAI-compatible endpoint for tool support
      const endpoint = `${base}/v1/chat/completions`;
      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: toOllamaMessages(messages),
        stream: false,
      };

      const ollamaTools = toOllamaTools(tools);
      if (ollamaTools) body.tools = ollamaTools;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`[ollama] ${res.status}: ${text}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Array<Record<string, unknown>>;
      const usage = data.usage as {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      } | null;

      const choice = choices[0];
      const msg = choice?.message as Record<string, unknown> | undefined;

      // Parse tool calls (same format as OpenAI)
      let toolUse: ProviderResponse['toolUse'];
      const calls = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
      if (calls?.length) {
        toolUse = calls.map((c) => {
          const fn = c.function as Record<string, unknown>;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse((fn.arguments as string) || '{}');
          } catch { /* empty */ }
          return { id: c.id as string, name: fn.name as string, input };
        });
      }

      return {
        content: (msg?.content as string) ?? '',
        toolUse,
        tokens: {
          prompt: usage?.prompt_tokens ?? 0,
          completion: usage?.completion_tokens ?? 0,
          total: usage?.total_tokens ?? 0,
        },
        cost: 0, // local = free
        model: (data.model as string) ?? resolvedModel,
      };
    },

    async *chatStream(
      messages: Message[],
      tools?: ToolDefinition[],
    ): AsyncIterable<StreamChunk> {
      const resolvedModel = await resolveModel();
      const endpoint = `${base}/v1/chat/completions`;

      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: toOllamaMessages(messages),
        stream: true,
      };

      const ollamaTools = toOllamaTools(tools);
      if (ollamaTools) body.tools = ollamaTools;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`[ollama] ${res.status}: ${text}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('[ollama] no response body for stream');

      const decoder = new TextDecoder();
      let buffer = '';

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
          const delta = choices?.[0]?.delta as
            | Record<string, unknown>
            | undefined;
          if (delta?.content) {
            yield { type: 'text', content: delta.content as string };
          }
        }
      }

      yield { type: 'done' };
    },

    estimateCost(_tokens: number): number {
      return 0; // Always free for local models
    },
  };
}
