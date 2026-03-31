/**
 * bash tool — execute a shell command inside a sandbox.
 *
 * Enforces a blocklist of dangerous patterns, captures stdout+stderr,
 * and enforces a configurable timeout.
 */

// ── Sandbox abstraction ──────────────────────────────────────────────────

export interface SandboxProvider {
  /**
   * Run a command inside the sandbox.
   * Returns { exitCode, stdout, stderr }.
   */
  exec(
    command: string,
    options: { timeout?: number; cwd?: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// ── Tool definition ──────────────────────────────────────────────────────

export const bashTool = {
  name: 'bash',
  description: 'Execute a shell command (sandboxed)',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: {
        type: 'number',
        default: 30000,
        description: 'Timeout in milliseconds',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: repo root)',
      },
    },
    required: ['command'],
  },
};

// ── Blocked patterns ─────────────────────────────────────────────────────

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-\w*r\w*f\s+|.*--no-preserve-root)\//i, reason: 'Destructive rm detected' },
  { pattern: /\bsudo\b/i, reason: 'sudo is not allowed' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, reason: 'Piped curl-to-shell is not allowed' },
  { pattern: /\bchmod\s+(-\w*R\w*\s+)?777\b/, reason: 'chmod 777 is not allowed' },
  { pattern: /\b(mkfs|dd\s+if=)/i, reason: 'Destructive disk command detected' },
  { pattern: />\s*\/dev\/sd/i, reason: 'Direct write to block device detected' },
  { pattern: /\bshutdown\b|\breboot\b/i, reason: 'System power command detected' },
  { pattern: /\b(?:kill|killall)\s+-9\s+1\b/, reason: 'Attempt to kill init' },
];

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeBash(
  input: { command: string; timeout?: number; cwd?: string },
  sandbox: SandboxProvider,
): Promise<string> {
  const { command, timeout = 30000, cwd } = input;

  // 1. Validate against blocked patterns
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Error: command blocked — ${reason}`;
    }
  }

  // 2. Clamp timeout to [1_000, 120_000]
  const clamped = Math.max(1_000, Math.min(timeout, 120_000));

  // 3. Execute
  try {
    const result = await sandbox.exec(command, { timeout: clamped, cwd });

    // 4. Format output
    const parts: string[] = [];

    if (result.stdout) {
      parts.push(truncate(result.stdout, 50_000));
    }
    if (result.stderr) {
      parts.push(`[stderr]\n${truncate(result.stderr, 10_000)}`);
    }
    if (result.exitCode !== 0) {
      parts.push(`[exit code: ${result.exitCode}]`);
    }

    const output = parts.length > 0 ? parts.join('\n') : '(no output)';
    return result.exitCode === 0
      ? output
      : `Command exited with code ${result.exitCode}:\n${output}`;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('timed out')) {
      return `Error: command timed out after ${clamped}ms`;
    }
    const message = err instanceof Error ? err.message : String(err);
    return `Error executing command: ${message}`;
  }
}

// ── Internal ─────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const kept = maxLen - 20;
  return (
    text.slice(0, kept) +
    `\n... [truncated ${text.length - kept} characters]`
  );
}
