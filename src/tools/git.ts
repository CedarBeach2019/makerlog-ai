/**
 * Git tools — log, diff, and commit operations.
 *
 * Each tool delegates to a GitProvider that wraps the actual git binary
 * or a simulated backend for testing / Workers environments.
 */

// ── Git provider abstraction ─────────────────────────────────────────────

export interface GitProvider {
  log(count: number): Promise<string>;
  diff(base: string, head: string): Promise<string>;
  addAndCommit(paths: string[], message: string): Promise<string>;
  status(): Promise<string>;
  currentBranch(): Promise<string>;
}

// ── Tool definitions ─────────────────────────────────────────────────────

export const gitLogTool = {
  name: 'git_log',
  description: 'Show recent git commit history',
  input_schema: {
    type: 'object' as const,
    properties: {
      count: {
        type: 'number',
        default: 10,
        description: 'Number of commits to show',
      },
    },
    required: [],
  },
};

export const gitDiffTool = {
  name: 'git_diff',
  description: 'Show diff between two refs (branches, commits, etc.)',
  input_schema: {
    type: 'object' as const,
    properties: {
      base: {
        type: 'string',
        description: 'Base ref (default: HEAD~1)',
      },
      head: {
        type: 'string',
        description: 'Head ref (default: HEAD)',
      },
    },
    required: [],
  },
};

export const gitCommitTool = {
  name: 'git_commit',
  description: 'Stage files and create a git commit',
  input_schema: {
    type: 'object' as const,
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to stage',
      },
      message: {
        type: 'string',
        description: 'Commit message',
      },
    },
    required: ['paths', 'message'],
  },
};

export const gitStatusTool = {
  name: 'git_status',
  description: 'Show working tree status',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

// ── Executors ────────────────────────────────────────────────────────────

export async function executeGitLog(
  input: { count?: number },
  git: GitProvider,
): Promise<string> {
  const count = input.count ?? 10;
  try {
    return await git.log(count);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error reading git log: ${message}`;
  }
}

export async function executeGitDiff(
  input: { base?: string; head?: string },
  git: GitProvider,
): Promise<string> {
  const base = input.base ?? 'HEAD~1';
  const head = input.head ?? 'HEAD';
  try {
    const diff = await git.diff(base, head);
    if (!diff.trim()) {
      return `No differences between ${base} and ${head}.`;
    }
    // Truncate very large diffs
    if (diff.length > 100_000) {
      return diff.slice(0, 100_000) + '\n... [diff truncated]';
    }
    return diff;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error reading git diff: ${message}`;
  }
}

export async function executeGitCommit(
  input: { paths: string[]; message: string },
  git: GitProvider,
): Promise<string> {
  if (!input.paths || input.paths.length === 0) {
    return 'Error: no paths specified for commit';
  }
  if (!input.message || input.message.trim().length === 0) {
    return 'Error: commit message cannot be empty';
  }
  try {
    return await git.addAndCommit(input.paths, input.message.trim());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error creating commit: ${message}`;
  }
}

export async function executeGitStatus(
  _input: Record<string, unknown>,
  git: GitProvider,
): Promise<string> {
  try {
    const [status, branch] = await Promise.all([
      git.status(),
      git.currentBranch(),
    ]);
    return `On branch ${branch}\n${status}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error reading git status: ${message}`;
  }
}
