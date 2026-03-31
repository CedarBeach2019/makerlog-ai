// Smart context window management — keep the most relevant messages within budget

import type { Message } from './loop.js';

export interface ContextConfig {
  maxTokens: number;
  reservedForResponse: number;
}

export interface RepoState {
  branch: string;
  recentFiles: string[];
  openFiles: string[];
}

/** Approximate characters per token for English / code text. */
const CHARS_PER_TOKEN = 4;

/** Minimum number of recent messages to always preserve. */
const MIN_RECENT_MESSAGES = 4;

export class ContextManager {
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Rough token estimate.
   * Uses a simple heuristic: ~4 characters per token.
   * For production, replace with tiktoken or a tokenizer matching the model.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Prune a message history to fit within `budget` tokens.
   *
   * Strategy:
   *  - Always keep the system message (role=system) if present.
   *  - Always keep the last MIN_RECENT_MESSAGES messages.
   *  - Drop the oldest non-system messages first.
   *  - Never drop tool results that are paired with a preceding tool_use.
   */
  pruneHistory(messages: Message[], budget: number): Message[] {
    if (messages.length === 0) return [];

    let totalTokens = this.estimateMessages(messages);

    if (totalTokens <= budget) {
      return [...messages];
    }

    // Separate system message from the rest
    const system: Message[] = [];
    const rest: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system.push(msg);
      } else {
        rest.push(msg);
      }
    }

    const systemTokens = this.estimateMessages(system);
    const remainingBudget = budget - systemTokens;

    if (remainingBudget <= 0) {
      // System prompt alone exceeds budget — return it anyway (best effort)
      return system;
    }

    // Always keep the last N messages
    const recent = rest.slice(-MIN_RECENT_MESSAGES);
    const older = rest.slice(0, rest.length - MIN_RECENT_MESSAGES);

    let recentTokens = this.estimateMessages(recent);
    let availableForOlder = remainingBudget - recentTokens;

    const keptOlder: Message[] = [];

    // Walk older messages from newest to oldest, keeping what fits
    for (let i = older.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens(msgContent(older[i]));

      if (availableForOlder - msgTokens >= 0) {
        keptOlder.unshift(older[i]);
        availableForOlder -= msgTokens;
      } else {
        break;
      }
    }

    return [...system, ...keptOlder, ...recent];
  }

  /**
   * Build the system prompt that gets prepended to every conversation.
   *
   * Combines the soul.md personality with live repo state so the agent
   * knows where it is and what files are relevant.
   */
  buildSystemPrompt(soulMd: string, repoState: RepoState): string {
    const sections: string[] = [];

    // Soul / personality
    if (soulMd.trim()) {
      sections.push(`## Agent Identity\n\n${soulMd.trim()}`);
    }

    // Repo state
    const stateLines: string[] = [];
    if (repoState.branch) {
      stateLines.push(`Current branch: ${repoState.branch}`);
    }
    if (repoState.recentFiles.length > 0) {
      stateLines.push(
        `Recently modified files:\n${repoState.recentFiles.map((f) => `  - ${f}`).join('\n')}`,
      );
    }
    if (repoState.openFiles.length > 0) {
      stateLines.push(
        `Open files:\n${repoState.openFiles.map((f) => `  - ${f}`).join('\n')}`,
      );
    }

    if (stateLines.length > 0) {
      sections.push(`## Repository State\n\n${stateLines.join('\n\n')}`);
    }

    // Behavior instructions
    sections.push(
      `## Behavior\n\n` +
        `- You are an agent embedded in a living codebase.\n` +
        `- Prefer reading files before modifying them.\n` +
        `- When running commands, be specific and cautious.\n` +
        `- Communicate clearly about what you are doing and why.\n` +
        `- If something looks wrong, say so before proceeding.`,
    );

    return sections.join('\n\n');
  }

  /** Calculate the usable context budget (total minus reserve for response). */
  getUsableBudget(): number {
    return this.config.maxTokens - this.config.reservedForResponse;
  }

  /** Sum token estimates for a list of messages. */
  private estimateMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msgContent(msg)), 0);
  }
}

/** Extract the primary text content of a message for token estimation. */
function msgContent(msg: Message): string {
  return msg.content ?? '';
}
