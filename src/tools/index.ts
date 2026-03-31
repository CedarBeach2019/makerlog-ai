/**
 * Tool Registry — combines all tool definitions and dispatches execution.
 *
 * Every tool is registered with its JSON-schema definition and an async
 * executor function.  The registry is passed to the AgentLoop so it can
 * advertise tools to the LLM and route `tool_use` calls to the right
 * executor.
 */

import { fileReadTool, executeFileRead } from './file-read.js';
import type { StorageBackend as ReadStorage } from './file-read.js';
import { fileWriteTool, executeFileWrite } from './file-write.js';
import type { StorageBackend as WriteStorage } from './file-write.js';
import { fileEditTool, executeFileEdit } from './file-edit.js';
import { bashTool, executeBash } from './bash.js';
import type { SandboxProvider } from './bash.js';
import { searchTool, executeSearch } from './search.js';
import type { Storage as SearchStorage } from './search.js';
import {
  gitLogTool,
  gitDiffTool,
  gitCommitTool,
  gitStatusTool,
  executeGitLog,
  executeGitDiff,
  executeGitCommit,
  executeGitStatus,
} from './git.js';
import type { GitProvider } from './git.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<string>;

interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

/** Dependencies injected into the registry at construction time. */
export interface ToolDependencies {
  storage: ReadStorage & WriteStorage & SearchStorage;
  sandbox: SandboxProvider;
  git: GitProvider;
}

// ── Registry ─────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  constructor(deps: ToolDependencies) {
    this.registerBuiltinTools(deps);
  }

  // ── Registration ─────────────────────────────────────────────────────

  register(tool: ToolDefinition, executor: ToolExecutor): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, { definition: tool, executor });
  }

  // ── Query ────────────────────────────────────────────────────────────

  getAll(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  // ── Execution ────────────────────────────────────────────────────────

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: unknown tool "${name}"`;
    }

    // Validate required parameters
    const schema = tool.definition.input_schema;
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const param of required) {
        if (input[param] === undefined || input[param] === null) {
          return `Error: missing required parameter "${param}" for tool "${name}"`;
        }
      }
    }

    return tool.executor(input);
  }

  // ── Built-in tool wiring ────────────────────────────────────────────

  private registerBuiltinTools(deps: ToolDependencies): void {
    // file_read
    this.register(fileReadTool as unknown as ToolDefinition, async (input) =>
      executeFileRead(
        input as { path: string; encoding?: string },
        deps.storage,
      ),
    );

    // file_write
    this.register(fileWriteTool as unknown as ToolDefinition, async (input) =>
      executeFileWrite(
        input as { path: string; content: string },
        deps.storage,
      ),
    );

    // file_edit
    this.register(fileEditTool as unknown as ToolDefinition, async (input) =>
      executeFileEdit(
        input as { path: string; oldText: string; newText: string; replaceAll?: boolean },
        deps.storage as Parameters<typeof executeFileEdit>[1],
      ),
    );

    // bash
    this.register(bashTool as unknown as ToolDefinition, async (input) =>
      executeBash(
        input as { command: string; timeout?: number; cwd?: string },
        deps.sandbox,
      ),
    );

    // search
    this.register(searchTool as unknown as ToolDefinition, async (input) =>
      executeSearch(
        input as { query: string; path?: string; type?: string; maxResults?: number },
        deps.storage,
      ),
    );

    // git_log
    this.register(gitLogTool as unknown as ToolDefinition, async (input) =>
      executeGitLog(input as { count?: number }, deps.git),
    );

    // git_diff
    this.register(gitDiffTool as unknown as ToolDefinition, async (input) =>
      executeGitDiff(input as { base?: string; head?: string }, deps.git),
    );

    // git_commit
    this.register(gitCommitTool as unknown as ToolDefinition, async (input) =>
      executeGitCommit(input as { paths: string[]; message: string }, deps.git),
    );

    // git_status
    this.register(gitStatusTool as unknown as ToolDefinition, async (input) =>
      executeGitStatus(input, deps.git),
    );
  }
}
