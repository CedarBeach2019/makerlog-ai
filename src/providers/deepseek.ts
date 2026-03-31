/**
 * DeepSeek provider — thin wrapper around the OpenAI-compatible provider
 * with DeepSeek-specific defaults and cost tracking.
 *
 * Models: deepseek-chat, deepseek-coder, deepseek-reasoner
 * Pricing: ~$0.14 / 1M input, ~$0.28 / 1M output
 */

import { createOpenAIProvider } from './openai.js';
import type {
  ProviderConfig,
  Provider,
} from './index.js';

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1/chat/completions';

const MODEL_ALIASES: Record<string, string> = {
  chat: 'deepseek-chat',
  coder: 'deepseek-coder',
  reasoner: 'deepseek-reasoner',
};

export interface DeepSeekProvider extends Provider {
  readonly name: 'deepseek';
}

export function createDeepSeekProvider(
  config: ProviderConfig,
): DeepSeekProvider {
  const apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';

  // Resolve model aliases — accept short names like "chat" or "coder"
  let model = config.model ?? 'deepseek-chat';
  model = MODEL_ALIASES[model] ?? model;

  // Build an OpenAI-compatible provider pointed at DeepSeek
  const wrapped = createOpenAIProvider({
    ...config,
    provider: 'openai', // internal flag for the OpenAI provider
    apiKey,
    baseUrl: config.baseUrl ?? DEEPSEEK_BASE,
    model,
  });

  // Override cost estimation with DeepSeek pricing
  return {
    name: 'deepseek',

    chat: wrapped.chat.bind(wrapped),
    chatStream: wrapped.chatStream.bind(wrapped),

    estimateCost(tokens: number): number {
      // DeepSeek is dramatically cheaper: $0.14 input, $0.28 output per 1M
      return (tokens * 0.5 * (0.14 + 0.28)) / 1_000_000;
    },
  };
}
