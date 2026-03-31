/**
 * file_write tool — create or overwrite a file in the repo.
 *
 * Supports R2Bucket (Workers) and FsProvider (local Node.js).
 */

// ── Storage abstractions ─────────────────────────────────────────────────

export interface R2BucketLike {
  put(key: string, value: string | ReadableStream): Promise<unknown>;
}

export interface FsProvider {
  writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;
  mkdirp(dir: string): Promise<void>;
}

export type StorageBackend = R2BucketLike | FsProvider;

// ── Tool definition ──────────────────────────────────────────────────────

export const fileWriteTool = {
  name: 'file_write',
  description: 'Create or overwrite a file in the repo',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path relative to repo root' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function isFsProvider(storage: StorageBackend): storage is FsProvider {
  return typeof (storage as FsProvider).writeFile === 'function';
}

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeFileWrite(
  input: { path: string; content: string },
  storage: StorageBackend,
): Promise<string> {
  const normalized = normalizePath(input.path);

  if (isFsProvider(storage)) {
    // Ensure parent directories exist
    const dir = normalized.split('/').slice(0, -1).join('/');
    if (dir) {
      await storage.mkdirp(dir);
    }
    await storage.writeFile(normalized, input.content, 'utf-8');
    return `OK: wrote ${input.content.length} bytes to ${normalized}`;
  }

  // R2 bucket
  await storage.put(normalized, input.content);
  return `OK: wrote ${input.content.length} bytes to ${normalized}`;
}

// ── Internal ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  const parts = p.split('/').filter((s) => s && s !== '.');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length === 0) {
        throw new Error(`Path traversal above repo root: ${p}`);
      }
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}
