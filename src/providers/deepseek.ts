/**
 * DeepSeek provider — thin wrapper around the OpenAI-compatible provider
 * with DeepSeek-specific defaults and cost tracking.
 *
 * Models: deepseek-chat, deepseek-coder, deepseek-reasoner
 * Pricing:
 *   deepseek-chat/coder: ~$0.14 / 1M input, ~$0.28 / 1M output
 *   deepseek-reasoner:   ~$0.55 / 1M input, ~$2.19 / 1M output
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

/** Pricing per 1M tokens by model family */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
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

  // Pick pricing for this model
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['deepseek-chat'];

  return {
    name: 'deepseek',

    chat: wrapped.chat.bind(wrapped),
    chatStream: wrapped.chatStream.bind(wrapped),

    estimateCost(tokens: number): number {
      return (tokens * 0.5 * (pricing.input + pricing.output)) / 1_000_000;
    },
  };
}
