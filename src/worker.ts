/**
 * worker.ts — Main Cloudflare Worker entry point for makerlog-ai.
 *
 * Uses Hono for routing. All endpoints share a typed Env binding object
 * that provides D1, KV, R2, and secret access.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { TelegramChannel } from './channels/telegram.js';
import { DiscordChannel } from './channels/discord.js';
import { normalizeTelegram, normalizeDiscord } from './channels/normalize.js';
import { BillingManager } from './billing/index.js';
import { ProviderRegistry } from './providers/index.js';
import type { ProviderConfig } from './providers/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  DISCORD_APP_ID: string;
  DISCORD_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  BILLING_ENABLED: string;
  COCAPN_PROVIDER: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  GROQ_API_KEY: string;
  OLLAMA_HOST: string;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProviderConfig(env: Env): ProviderConfig {
  const explicit = env.COCAPN_PROVIDER;
  if (explicit) {
    const keyMap: Record<string, string | undefined> = {
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
      deepseek: env.DEEPSEEK_API_KEY,
      groq: env.GROQ_API_KEY,
      ollama: undefined,
    };
    const baseMap: Partial<Record<string, string>> = {
      deepseek: 'https://api.deepseek.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      ollama: env.OLLAMA_HOST ?? 'http://localhost:11434',
    };
    const modelMap: Record<string, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      deepseek: 'deepseek-chat',
      groq: 'llama-3.1-70b-versatile',
      ollama: 'llama3',
    };
    return {
      provider: explicit as ProviderConfig['provider'],
      apiKey: keyMap[explicit],
      baseUrl: baseMap[explicit],
      model: modelMap[explicit] ?? 'default',
    };
  }

  // Auto-detect from env
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-20250514' };
  if (env.OPENAI_API_KEY) return { provider: 'openai', apiKey: env.OPENAI_API_KEY, model: 'gpt-4o' };
  if (env.DEEPSEEK_API_KEY) return { provider: 'deepseek', apiKey: env.DEEPSEEK_API_KEY, model: 'deepseek-chat' };
  if (env.GROQ_API_KEY) return { provider: 'groq', apiKey: env.GROQ_API_KEY, model: 'llama-3.1-70b-versatile' };

  return {
    provider: 'ollama',
    baseUrl: env.OLLAMA_HOST ?? 'http://localhost:11434',
    model: 'llama3',
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// Global CORS
app.use('*', cors());

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  return c.html(await c.env.KV.get('page:index', 'text') ?? '<h1>makerlog-ai</h1>');
});

app.get('/app', async (c) => {
  return c.html(await c.env.KV.get('page:app', 'text') ?? '<h1>makerlog-ai IDE</h1>');
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

app.get('/api/status', (c) => {
  const providers: Record<string, boolean> = {
    anthropic: !!c.env.ANTHROPIC_API_KEY,
    openai: !!c.env.OPENAI_API_KEY,
    deepseek: !!c.env.DEEPSEEK_API_KEY,
    groq: !!c.env.GROQ_API_KEY,
    ollama: !!c.env.OLLAMA_HOST,
  };

  const primary = c.env.COCAPN_PROVIDER || 'deepseek';

  return c.json({
    status: 'ok',
    provider: primary,
    providers,
    billingEnabled: c.env.BILLING_ENABLED === 'true',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Chat (streaming SSE)
// ---------------------------------------------------------------------------

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ message: string; userId?: string; history?: Array<{ role: string; content: string }> }>();
  const userId = body.userId ?? 'anonymous';

  // Billing gate
  if (c.env.BILLING_ENABLED === 'true') {
    const billing = new BillingManager(c.env.DB, c.env.KV);
    const access = await billing.checkAccess(userId);
    if (!access.allowed) {
      return c.json({ error: 'Quota exceeded', remaining: 0 }, 429);
    }
  }

  return streamSSE(c, async (stream) => {
    // Build provider config from environment
    const config = resolveProviderConfig(c.env);
    const registry = new ProviderRegistry(config);

    const messages = (body.history ?? []).map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
    }));
    messages.push({ role: 'user', content: body.message });

    let totalTokens = 0;
    let totalCost = 0;

    try {
      const chunks = registry.chatStream(messages);
      for await (const chunk of chunks) {
        if (chunk.type === 'text' && chunk.content) {
          await stream.writeSSE({
            event: 'token',
            data: JSON.stringify({ content: chunk.content }),
          });
        }
        if (chunk.type === 'done') {
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: msg }),
      });
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({ totalTokens, totalCost }),
    });
  });
});

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

app.get('/api/files', async (c) => {
  const prefix = c.req.query('path') ?? '';
  const listed = await c.env.BUCKET.list({ prefix, delimiter: '/' });

  const files = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    modified: obj.uploaded.toISOString(),
  }));

  const folders = listed.delimitedPrefixes.map((p) => ({ key: p, type: 'folder' }));

  return c.json({ files, folders });
});

app.get('/api/files/content', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'Missing path parameter' }, 400);

  const obj = await c.env.BUCKET.get(path);
  if (!obj) return c.json({ error: 'File not found' }, 404);

  const text = await obj.text();
  return c.json({ path, content: text, size: obj.size, modified: obj.uploaded.toISOString() });
});

app.put('/api/files/content', async (c) => {
  const { path, content } = await c.req.json<{ path: string; content: string }>();
  if (!path || content === undefined) {
    return c.json({ error: 'Missing path or content' }, 400);
  }

  await c.env.BUCKET.put(path, content);
  return c.json({ ok: true, path });
});

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

app.post('/api/execute', async (c) => {
  // Sandboxed command execution is not available on Workers.
  // This endpoint is a placeholder that signals the client to use a local bridge.
  return c.json({ error: 'Command execution requires the local bridge', hint: 'Use cocapn start --bridge' }, 501);
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

app.post('/api/webhooks/telegram', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secret && secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Invalid secret' }, 403);
  }

  const update = await c.req.json();
  const tg = new TelegramChannel(c.env.TELEGRAM_BOT_TOKEN);
  const message = await tg.handleWebhook(update);

  if (message) {
    // TODO: Route to agent core and respond
    const chatId = message.metadata.chatId as number;
    if (chatId) {
      await tg.sendMessage(chatId, `Received: ${message.text}`);
    }
  }

  return c.json({ ok: true });
});

app.post('/api/webhooks/discord', async (c) => {
  const body = await c.req.json<{ type: number }>();

  // Discord PING — respond immediately
  if (body.type === 1) {
    return c.json({ type: 1 });
  }

  const dc = new DiscordChannel(c.env.DISCORD_APP_ID, c.env.DISCORD_BOT_TOKEN);
  const message = await dc.handleWebhook(body as Parameters<typeof dc.handleWebhook>[0]);

  if (message) {
    // Defer the interaction so we have time to process
    const token = (message.metadata as Record<string, unknown>).interactionToken as string | undefined;
    if (token) {
      // TODO: Route to agent core and respond via followup
      await dc.sendFollowup(token, `Processing: ${message.text}`);
    }
  }

  // Deferred — we will follow up asynchronously
  return c.json({ type: 5 });
});

app.post('/api/webhooks/billing', async (c) => {
  if (c.env.BILLING_ENABLED !== 'true') {
    return c.json({ error: 'Billing not enabled' }, 404);
  }

  const event = await c.req.json();
  const billing = new BillingManager(c.env.DB, c.env.KV);
  await billing.handleWebhook(event);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// MCP endpoint
// ---------------------------------------------------------------------------

app.get('/api/mcp', (c) => {
  // Model Context Protocol — allows visiting agents to discover capabilities
  return c.json({
    name: 'makerlog-ai',
    version: '0.1.0',
    capabilities: {
      tools: ['file_read', 'file_write', 'search', 'chat', 'execute'],
      resources: ['files', 'wiki', 'tasks'],
    },
    endpoint: c.req.url.replace('/api/mcp', ''),
  });
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

app.get('/api/usage', async (c) => {
  const userId = c.req.query('userId') ?? 'anonymous';

  if (c.env.BILLING_ENABLED !== 'true') {
    return c.json({ enabled: false });
  }

  const billing = new BillingManager(c.env.DB, c.env.KV);
  const [report, access] = await Promise.all([
    billing.getUsageReport(userId),
    billing.checkAccess(userId),
  ]);

  return c.json({ enabled: true, report, access });
});

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  console.error(`[worker] Unhandled error: ${err.message}`, err.stack);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

// ---------------------------------------------------------------------------
// Export for Cloudflare Workers
// ---------------------------------------------------------------------------

export default app;
