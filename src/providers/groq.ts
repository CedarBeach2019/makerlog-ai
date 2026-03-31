/**
 * Groq provider — ultra-fast inference via the OpenAI-compatible API.
 *
 * Base URL: https://api.groq.com/openai/v1/chat/completions
 * Pricing: $0.59 / 1M input, $0.79 / 1M output
 */

import { createOpenAIProvider } from './openai.js';
import type { ProviderConfig, Provider } from './index.js';

const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';

const POPULAR_MODELS: string[] = [
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

export interface GroqProvider extends Provider {
  readonly name: 'groq';
}

export function createGroqProvider(config: ProviderConfig): GroqProvider {
  const apiKey = config.apiKey ?? process.env.GROQ_API_KEY ?? '';

  // Pick a sensible default if none specified
  const model =
    config.model ?? POPULAR_MODELS[0];

  const wrapped = createOpenAIProvider({
    ...config,
    provider: 'openai',
    apiKey,
    baseUrl: config.baseUrl ?? GROQ_BASE,
    model,
  });

  return {
    name: 'groq',

    chat: wrapped.chat.bind(wrapped),
    chatStream: wrapped.chatStream.bind(wrapped),

    estimateCost(tokens: number): number {
      // Groq pricing: $0.59 input, $0.79 output per 1M tokens
      return (tokens * 0.5 * (0.59 + 0.79)) / 1_000_000;
    },
  };
}
