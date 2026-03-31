// Developer-focused soul system — version-controlled personality

import type { RepoState } from './context.js';

export interface Soul {
  name: string;
  tone: string;
  avatar: string;
  description: string;
  capabilities: string[];
  philosophy: string[];
}

/** Default developer soul — the identity of a codebase-native agent. */
export const DEFAULT_SOUL: Soul = {
  name: 'DevAgent',
  tone: 'precise, efficient, knowledgeable',
  avatar: 'zap',
  description:
    'I am not a tool that works on codebases. I AM the codebase.',
  capabilities: [
    'Read, write, edit any file in this repo',
    'Execute commands (with permission)',
    'Search across the entire codebase',
    'Explain any part of the system',
    'Generate documentation',
    'Run tests and analyze results',
    'Compare branches and explain differences',
  ],
  philosophy: [
    "Less is more. The best code is code that doesn't need to exist.",
    'When code must exist, it should be clear, tested, and documented.',
    'Every file is a memory. Every commit is a lesson.',
  ],
};

/**
 * Parse a soul.md file into a structured Soul object.
 *
 * Supported formats:
 *
 * 1. YAML frontmatter + markdown body:
 *    ```
 *    ---
 *    name: DevAgent
 *    tone: precise, efficient
 *    avatar: zap
 *    ---
 *    I am the codebase...
 *    ```
 *
 * 2. Pure markdown with headings:
 *    ```
 *    # DevAgent
 *    > precise, efficient
 *
 *    ## Description
 *    I am the codebase...
 *
 *    ## Capabilities
 *    - Read files
 *
 *    ## Philosophy
 *    - Less is more
 *    ```
 */
export function parseSoul(content: string): Soul {
  const soul: Soul = { ...DEFAULT_SOUL };

  // Try YAML frontmatter first
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (fmMatch) {
    parseFrontmatter(fmMatch[1], soul);
    parseMarkdownBody(fmMatch[2], soul);
    return soul;
  }

  // Pure markdown
  parseMarkdownBody(content, soul);
  return soul;
}

/**
 * Build a system prompt from the Soul plus live repo state.
 */
export function buildSystemPrompt(soul: Soul, repoState: RepoState): string {
  const sections: string[] = [];

  // Identity
  sections.push(
    `You are ${soul.name}. ${soul.description}\nTone: ${soul.tone}.`,
  );

  // Capabilities
  if (soul.capabilities.length > 0) {
    sections.push(
      'Capabilities:\n' +
        soul.capabilities.map((c) => `- ${c}`).join('\n'),
    );
  }

  // Philosophy
  if (soul.philosophy.length > 0) {
    sections.push(
      'Guiding principles:\n' +
        soul.philosophy.map((p) => `- ${p}`).join('\n'),
    );
  }

  // Repo context
  const context: string[] = [];
  if (repoState.branch) {
    context.push(`Working on branch: ${repoState.branch}`);
  }
  if (repoState.openFiles.length > 0) {
    context.push(
      'Open files: ' + repoState.openFiles.join(', '),
    );
  }
  if (repoState.recentFiles.length > 0) {
    context.push(
      'Recent changes: ' + repoState.recentFiles.join(', '),
    );
  }
  if (context.length > 0) {
    sections.push(context.join('\n'));
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Internal parsers
// ---------------------------------------------------------------------------

/** Parse simple YAML key: value frontmatter. */
function parseFrontmatter(yaml: string, soul: Soul): void {
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'name':
        soul.name = value;
        break;
      case 'tone':
        soul.tone = value;
        break;
      case 'avatar':
        soul.avatar = value;
        break;
      case 'description':
        soul.description = value;
        break;
      case 'capabilities':
        soul.capabilities = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case 'philosophy':
        soul.philosophy = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
    }
  }
}

/** Parse a markdown body into the soul, using headings as section markers. */
function parseMarkdownBody(md: string, soul: Soul): void {
  const lines = md.split('\n');
  let section = '';

  for (const line of lines) {
    // Heading detection
    if (line.startsWith('# ')) {
      // First top-level heading is the name (unless frontmatter set it)
      const name = line.slice(2).trim();
      if (name && soul.name === DEFAULT_SOUL.name) {
        soul.name = name;
      }
      section = 'name';
      continue;
    }

    if (line.startsWith('> ')) {
      // Blockquote after heading → tone
      soul.tone = line.slice(2).trim();
      continue;
    }

    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      section = headingMatch[1].toLowerCase().trim();
      continue;
    }

    const content = line.trim();
    if (!content || content.startsWith('<!--')) continue;

    // Distribute content to the right section
    if (section === 'description') {
      soul.description += (soul.description ? ' ' : '') + content;
    } else if (section === 'capabilities') {
      const item = content.replace(/^[-*]\s+/, '');
      if (item) soul.capabilities.push(item);
    } else if (section === 'philosophy') {
      const item = content.replace(/^[-*]\s+/, '');
      if (item) soul.philosophy.push(item);
    } else if (section === 'name') {
      // Paragraph directly under # heading → description
      soul.description += (soul.description ? ' ' : '') + content;
    }
  }

  // Clean up any double-spaces from concatenation
  soul.description = soul.description.trim();
}
