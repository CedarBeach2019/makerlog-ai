/**
 * BYOK Provider Registry — auto-detect, fallback chain, cost tracking.
 *
 * Brings-your-own-key: point at any OpenAI-compatible endpoint, Anthropic,
 * DeepSeek, Groq, Ollama, or a custom URL and we route messages there.
 */
// ── Types ────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  provider: 'anthropic' | 'deepseek' | 'deepseek-reasoner' | 'openai' | 'ollama' | 'groq' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fallback?: ProviderConfig;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderResponse {
  content: string;
  toolUse?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  tokens: { prompt: number; completion: number; total: number };
  cost: number;
  model: string;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'done';
  content?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
}

export interface Provider {
  readonly name: string;
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<ProviderResponse>;
  chatStream(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<StreamChunk>;
  estimateCost(tokens: number): number;
}

// ── Pricing (USD per 1 M tokens) ─────────────────────────────────────────

export const PRICING: Record<string, { input: number; output: number }> = {
  anthropic: { input: 3.0, output: 15.0 },
  openai: { input: 2.5, output: 10.0 },
  deepseek: { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  groq: { input: 0.59, output: 0.79 },
  ollama: { input: 0, output: 0 },
  custom: { input: 0, output: 0 },
};

// ── Registry ─────────────────────────────────────────────────────────────

export class ProviderRegistry implements Provider {
  readonly name = 'registry';

  private providers: Map<string, Provider> = new Map();
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  // ── Auto-detection ───────────────────────────────────────────────────

  static autoDetect(): ProviderConfig {
    // 1. Explicit override
    const explicit = process.env.COCAPN_PROVIDER;
    if (explicit) {
      return ProviderRegistry.configFromEnv(
        explicit as ProviderConfig['provider'],
      );
    }

    // 2–6. Key-based detection in priority order
    const detectors: Array<[string, ProviderConfig['provider']]> = [
      ['ANTHROPIC_API_KEY', 'anthropic'],
      ['OPENAI_API_KEY', 'openai'],
      ['DEEPSEEK_API_KEY', 'deepseek'],
      ['DEEPSEEK_REASONER', 'deepseek-reasoner'],
      ['GROQ_API_KEY', 'groq'],
      ['OLLAMA_HOST', 'ollama'],
    ];

    for (const [envVar, provider] of detectors) {
      if (process.env[envVar]) {
        return ProviderRegistry.configFromEnv(provider);
      }
    }

    // 7. Default — local Ollama
    return {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    };
  }

  private static configFromEnv(
    provider: ProviderConfig['provider'],
  ): ProviderConfig {
    const keyMap: Record<string, string | undefined> = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      'deepseek-reasoner': process.env.DEEPSEEK_API_KEY,
      groq: process.env.GROQ_API_KEY,
      ollama: undefined,
      custom: process.env.CUSTOM_API_KEY,
    };

    const baseMap: Partial<Record<string, string>> = {
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      ollama: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    };

    const defaultModels: Record<string, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      deepseek: 'deepseek-chat',
      'deepseek-reasoner': 'deepseek-reasoner',
      groq: 'llama-3.1-70b-versatile',
      ollama: 'llama3',
      custom: 'default',
    };

    return {
      provider,
      apiKey: keyMap[provider],
      baseUrl: baseMap[provider],
      model: defaultModels[provider] ?? 'default',
    };
  }

  // ── Lazy provider instantiation ─────────────────────────────────────

  private async resolveProvider(cfg: ProviderConfig): Promise<Provider> {
    const cached = this.providers.get(cfg.provider);
    if (cached) return cached;

    let provider: Provider;

    switch (cfg.provider) {
      case 'anthropic':
        provider = await import('./anthropic.js').then((m) =>
          m.createAnthropicProvider(cfg),
        );
        break;
      case 'openai':
        provider = await import('./openai.js').then((m) =>
          m.createOpenAIProvider(cfg),
        );
        break;
      case 'deepseek':
        provider = await import('./deepseek.js').then((m) =>
          m.createDeepSeekProvider(cfg),
        );
        break;
      case 'deepseek-reasoner':
        provider = await import('./deepseek.js').then((m) =>
          m.createDeepSeekProvider({ ...cfg, provider: 'deepseek', model: 'deepseek-reasoner' }),
        );
        break;
      case 'ollama':
        provider = await import('./ollama.js').then((m) =>
          m.createOllamaProvider(cfg),
        );
        break;
      case 'groq':
        provider = await import('./groq.js').then((m) =>
          m.createGroqProvider(cfg),
        );
        break;
      case 'custom':
        provider = await import('./openai.js').then((m) =>
          m.createOpenAIProvider(cfg),
        );
        break;
    }

    this.providers.set(cfg.provider, provider);
    return provider;
  }

  // ── Chat with fallback chain ────────────────────────────────────────

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ProviderResponse> {
    const primary = await this.resolveProvider(this.config);
    try {
      return await primary.chat(messages, tools);
    } catch (primaryError) {
      if (!this.config.fallback) throw primaryError;

      console.warn(
        `[provider] primary ${this.config.provider} failed, trying fallback ${this.config.fallback.provider}`,
        primaryError instanceof Error ? primaryError.message : primaryError,
      );

      const fallback = await this.resolveProvider(this.config.fallback);
      try {
        return await fallback.chat(messages, tools);
      } catch (fallbackError) {
        // Surface the original error; log the fallback failure
        console.error(
          '[provider] fallback also failed',
          fallbackError instanceof Error ? fallbackError.message : fallbackError,
        );
        throw primaryError;
      }
    }
  }

  // ── Streaming with fallback ─────────────────────────────────────────

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
  ): AsyncIterable<StreamChunk> {
    const primary = await this.resolveProvider(this.config);

    try {
      // We need to wrap the iterable so we can catch setup errors.
      // Iterator errors during yield are the caller's responsibility.
      const stream = primary.chatStream(messages, tools);
      // Pull the first chunk eagerly to detect connection failures.
      const first = await stream[Symbol.asyncIterator]().next();
      if (!first.done) {
        yield first.value;
      }
      yield* stream;
      return;
    } catch (primaryError) {
      if (!this.config.fallback) throw primaryError;

      console.warn(
        `[provider] primary ${this.config.provider} stream failed, falling back to ${this.config.fallback.provider}`,
        primaryError instanceof Error ? primaryError.message : primaryError,
      );

      const fallback = await this.resolveProvider(this.config.fallback);
      yield* fallback.chatStream(messages, tools);
    }
  }

  // ── Cost estimation ─────────────────────────────────────────────────

  estimateCost(tokens: number): number {
    const rates = PRICING[this.config.provider] ?? PRICING.custom;
    // Rough: assume 50/50 input/output split
    const inputTokens = tokens / 2;
    const outputTokens = tokens / 2;
    return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }
}
