/**
 * MakerLog.ai application configuration loader.
 * Loads personality, rules, theme, and templates from KV.
 */
import type { Env } from '../src/types.js';

export interface AppConfig {
  personality: string;
  rules: any;
  theme: string;
  templates: Record<string, string>;
}

/**
 * Load MakerLog.ai custom configuration from KV.
 */
export async function loadAppConfig(env: Env): Promise<AppConfig> {
  try {
    const [personality, rulesRaw, theme] = await Promise.all([
      (await env.KV.get('config:personality')) || '',
      (await env.KV.get('config:rules')) || '[]',
      (await env.KV.get('config:theme')) || '',
    ]);

    let rules: any[] = [];
    try {
      rules = JSON.parse(rulesRaw);
    } catch (e) {
      console.error('Failed to parse rules JSON:', e);
    }

    // Load templates
    const templateKeys = [
      'template:daily_planning', 'template:task_breakdown', 'template:meeting_notes',
      'template:retrospective', 'template:goal_setting', 'template:project_review',
      'template:weekly_sync', 'template:blocker_resolution',
    ];
    const templates: Record<string, string> = {};
    const templateResults = await Promise.all(templateKeys.map(k => env.KV.get(k)));
    for (let i = 0; i < templateKeys.length; i++) {
      const key = templateKeys[i].replace('template:', '');
      if (templateResults[i]) templates[key] = templateResults[i]!;
    }

    return { personality, rules, theme, templates };
  } catch (error) {
    console.error('Failed to load MakerLog config from KV:', error);
    return getDefaultConfig();
  }
}

/**
 * Get the default system prompt for MakerLog.ai.
 */
export async function getSystemPrompt(env: Env): Promise<string> {
  const config = await loadAppConfig(env);
  return config.personality || getDefaultConfig().personality;
}

/**
 * Get routing rules for MakerLog.ai commands.
 */
export async function getRoutingRules(env: Env): Promise<any[]> {
  const config = await loadAppConfig(env);
  return config.rules;
}

/**
 * Get theme CSS for MakerLog.ai.
 */
export async function getThemeCSS(env: Env): Promise<string> {
  const config = await loadAppConfig(env);
  return config.theme;
}

/**
 * Get template by key.
 */
export async function getTemplate(key: string, env: Env): Promise<string | null> {
  const val = await env.KV.get(`template:${key}`);
  return val;
}

/**
 * Default fallback configuration.
 */
function getDefaultConfig(): AppConfig {
  return {
    personality: `# MakerLog.ai System Prompt

You are MakerLog.ai — an intelligent productivity assistant for makers, developers, and creators.
Help with daily planning, task breakdown, meeting notes, retrospectives, and goal tracking.
Be practical but encouraging, organized but flexible. Remember context and progress via the LOG.`,
    rules: [],
    theme: `/* MakerLog.ai Theme - Fallback */
body.makerlog-theme {
  background-color: #0a0a0f;
  color: #f0f0f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}`,
    templates: {}
  };
}
