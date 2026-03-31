// Permission system — mirrors Claude Code's allow/deny/ask model

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type PermissionLevel = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  tool: string; // tool name or '*' for all
  level: PermissionLevel;
  pattern?: string; // glob pattern for file paths
  commandPattern?: string; // regex for bash commands
}

export interface PermissionConfig {
  rules: PermissionRule[];
  dangerouslySkipPermissions?: boolean; // for CI
  onAsk?: (tool: string, input: Record<string, unknown>) => Promise<boolean>;
}

/** Well-known tool names used by the agent. */
type KnownTool =
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'bash'
  | 'search'
  | 'git_log'
  | 'git_diff'
  | 'git_commit';

/** Default permission rules — safe for interactive use. */
export const DEFAULT_RULES: PermissionRule[] = [
  { tool: 'file_read', level: 'allow' },
  { tool: 'search', level: 'allow' },
  { tool: 'git_log', level: 'allow' },
  { tool: 'git_diff', level: 'allow' },
  { tool: 'file_write', level: 'ask' },
  { tool: 'file_edit', level: 'ask' },
  { tool: 'git_commit', level: 'ask' },
  { tool: 'bash', level: 'ask' },
];

/** Commands that are always allowed inside bash. */
const ALLOWED_COMMANDS = [
  /^git\s+status$/,
  /^git\s+log\b/,
  /^git\s+diff\b/,
  /^git\s+branch\s*$/,
  /^ls\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^echo\b/,
  /^pwd$/,
  /^which\b/,
  /^node\s+--version$/,
  /^npm\s+--version$/,
  /^npx\s+vitest\b/,
  /^npx\s+tsc\b/,
];

/** Commands that are always denied. */
const DENIED_COMMANDS = [
  /^rm\s+-rf\s+\//,
  /^rm\s+-rf\s+\.\./,
  /^rm\s+-rf\s+~/,
  /^mkfs\b/,
  /^dd\s+/,
  /:\(\)\{\s*:\|:\&\s*\}\s*;/, // fork bomb
];

/** Simple glob matcher — supports * and **. */
function matchGlob(pattern: string, path: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedPath = path.replace(/\\/g, '/');

  // Convert glob to regex
  const regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '[^/]');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

export class PermissionManager {
  private rules: PermissionRule[];
  private skipAll: boolean;
  private onAsk?: (tool: string, input: Record<string, unknown>) => Promise<boolean>;

  constructor(config: PermissionConfig) {
    this.rules = config.rules;
    this.skipAll = config.dangerouslySkipPermissions ?? false;
    this.onAsk = config.onAsk;
  }

  /**
   * Check whether a tool invocation is permitted.
   *
   * Resolution order:
   *  1. If dangerouslySkipPermissions → allow
   *  2. Bash-specific: check allowed/denied command lists
   *  3. Walk rules (last match wins)
   *  4. Default deny
   */
  async check(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<'allow' | 'deny' | 'ask'> {
    // CI / test escape hatch
    if (this.skipAll) {
      return 'allow';
    }

    // Bash: command-level checks override everything
    if (tool === 'bash') {
      const command = String(input.command ?? '');
      const trimmed = command.trim();

      for (const denied of DENIED_COMMANDS) {
        if (denied.test(trimmed)) {
          return 'deny';
        }
      }

      for (const allowed of ALLOWED_COMMANDS) {
        if (allowed.test(trimmed)) {
          return 'allow';
        }
      }
      // Fall through to rule matching below
    }

    // Walk rules in order; collect the last matching rule per tool
    let matched: PermissionRule | null = null;

    for (const rule of this.rules) {
      if (rule.tool !== '*' && rule.tool !== tool) {
        continue;
      }

      // If the rule specifies a file pattern, check the path from input
      if (rule.pattern) {
        const path = String(input.path ?? input.file_path ?? '');
        if (path && matchGlob(rule.pattern, path)) {
          matched = rule;
        }
        continue;
      }

      // If the rule specifies a command pattern (for bash), test it
      if (rule.commandPattern && tool === 'bash') {
        const command = String(input.command ?? '');
        const regex = new RegExp(rule.commandPattern);
        if (regex.test(command)) {
          matched = rule;
        }
        continue;
      }

      // Plain tool match (no pattern)
      matched = rule;
    }

    if (!matched) {
      return 'deny'; // default deny
    }

    if (matched.level === 'ask' && this.onAsk) {
      const approved = await this.onAsk(tool, input);
      return approved ? 'allow' : 'deny';
    }

    return matched.level;
  }

  /** Add or replace a rule at runtime. */
  addRule(rule: PermissionRule): void {
    const idx = this.rules.findIndex(
      (r) => r.tool === rule.tool && r.pattern === rule.pattern,
    );
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  /** Return a snapshot of current rules. */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }
}

/**
 * Load a PermissionConfig from a cocapn.json file on disk.
 *
 * Expected shape:
 * ```json
 * {
 *   "permissions": {
 *     "dangerouslySkipPermissions": false,
 *     "rules": [
 *       { "tool": "file_read", "level": "allow" },
 *       { "tool": "bash", "level": "ask", "commandPattern": "^npm" }
 *     ]
 *   }
 * }
 * ```
 */
export async function loadFromConfig(
  configPath: string,
  onAsk?: PermissionConfig['onAsk'],
): Promise<PermissionManager> {
  const absolutePath = resolve(configPath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf-8');
  } catch {
    // If the file doesn't exist, use defaults
    return new PermissionManager({ rules: DEFAULT_RULES, onAsk });
  }

  const parsed = JSON.parse(raw) as {
    permissions?: PermissionConfig;
  };

  const perms = parsed.permissions ?? { rules: DEFAULT_RULES };

  // Merge with defaults so unspecified tools keep their safe default
  const rules = [...DEFAULT_RULES];
  for (const rule of perms.rules ?? []) {
    const idx = rules.findIndex((r) => r.tool === rule.tool);
    if (idx >= 0) {
      rules[idx] = rule;
    } else {
      rules.push(rule);
    }
  }

  return new PermissionManager({
    rules,
    dangerouslySkipPermissions: perms.dangerouslySkipPermissions,
    onAsk,
  });
}
