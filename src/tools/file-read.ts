/**
 * file_read tool — read file content from the repo.
 *
 * Supports two storage backends:
 *   - R2Bucket (Cloudflare Workers)
 *   - FsProvider (local / Node.js)
 */

// ── Storage abstractions ─────────────────────────────────────────────────

/** Cloudflare R2 bucket — provided by the Workers runtime. */
export interface R2BucketLike {
  get(key: string): Promise<{ body: ReadableStream | null } | null>;
}

/** Local filesystem provider for Node.js environments. */
export interface FsProvider {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/** Union type accepted by the executor. */
export type StorageBackend = R2BucketLike | FsProvider;

// ── Tool definition ──────────────────────────────────────────────────────

export const fileReadTool = {
  name: 'file_read',
  description: 'Read file content from the repo',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path relative to repo root' },
      encoding: {
        type: 'string',
        default: 'utf-8',
        description: 'Text encoding (default utf-8)',
      },
    },
    required: ['path'],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function isFsProvider(storage: StorageBackend): storage is FsProvider {
  return typeof (storage as FsProvider).readFile === 'function';
}

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeFileRead(
  input: { path: string; encoding?: string },
  storage: StorageBackend,
): Promise<string> {
  const encoding: BufferEncoding = (input.encoding as BufferEncoding) ?? 'utf-8';
  const normalized = normalizePath(input.path);

  if (isFsProvider(storage)) {
    const exists = await storage.exists(normalized);
    if (!exists) {
      return `Error: file not found: ${normalized}`;
    }
    const content = await storage.readFile(normalized, encoding);
    return content;
  }

  // R2 bucket path
  const obj = await storage.get(normalized);
  if (!obj || !obj.body) {
    return `Error: file not found: ${normalized}`;
  }

  const reader = obj.body.getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const decoder = new TextDecoder(encoding);
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}

// ── Internal ─────────────────────────────────────────────────────────────

/** Collapse `..`, `.` segments and strip leading `/`. */
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
