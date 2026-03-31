/**
 * file_edit tool — diff-based find-and-replace editing.
 *
 * Reads the file, locates `oldText`, replaces with `newText`, and writes
 * back.  When `replaceAll` is true every occurrence is swapped; otherwise
 * the tool errors if there is not exactly one match.
 */

import { executeFileRead } from './file-read.js';
import { executeFileWrite } from './file-write.js';
import type { StorageBackend as ReadStorage } from './file-read.js';
import type { StorageBackend as WriteStorage } from './file-write.js';

type Storage = ReadStorage & WriteStorage;

// ── Tool definition ──────────────────────────────────────────────────────

export const fileEditTool = {
  name: 'file_edit',
  description: 'Edit a file using find-and-replace (diff-based)',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path relative to repo root' },
      oldText: { type: 'string', description: 'Exact text to find' },
      newText: { type: 'string', description: 'Replacement text' },
      replaceAll: {
        type: 'boolean',
        default: false,
        description: 'Replace all occurrences instead of exactly one',
      },
    },
    required: ['path', 'oldText', 'newText'],
  },
};

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeFileEdit(
  input: { path: string; oldText: string; newText: string; replaceAll?: boolean },
  storage: Storage,
): Promise<string> {
  const { path, oldText, newText, replaceAll = false } = input;

  // 1. Read current content
  const current = await executeFileRead({ path }, storage);
  if (current.startsWith('Error:')) {
    return current; // propagate read error
  }

  // 2. Validate that oldText actually exists
  if (!current.includes(oldText)) {
    // Show context to help the caller adjust
    const preview = current.slice(0, 500);
    return (
      `Error: oldText not found in ${path}.\n` +
      `The text to replace was not found. File preview (first 500 chars):\n${preview}`
    );
  }

  // 3. When replaceAll is off, ensure exactly one match
  if (!replaceAll) {
    const firstIdx = current.indexOf(oldText);
    const secondIdx = current.indexOf(oldText, firstIdx + 1);
    if (secondIdx !== -1) {
      const occurrences = countOccurrences(current, oldText);
      return (
        `Error: oldText found ${occurrences} times in ${path}, but replaceAll is false. ` +
        `Set replaceAll to true, or provide more surrounding context so the match is unique.`
      );
    }
  }

  // 4. Perform replacement
  const updated = replaceAll
    ? current.replaceAll(oldText, newText)
    : current.replace(oldText, newText);

  // 5. Write back
  await executeFileWrite({ path, content: updated }, storage);

  // 6. Build a short diff summary
  const oldLines = oldText.split('\n').length;
  const newLines = newText.split('\n').length;
  const occurrences = countOccurrences(current, oldText);
  const replacedCount = replaceAll ? occurrences : 1;

  return (
    `OK: replaced ${replacedCount} occurrence(s) in ${path} ` +
    `(${oldLines} line(s) -> ${newLines} line(s))`
  );
}

// ── Internal ─────────────────────────────────────────────────────────────

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
