/**
 * search tool — codebase search with regex support.
 *
 * Walks the file tree in the storage backend, reads each file that matches
 * the type filter, runs a regex query, and returns results in
 * `file:line:content` format (ripgrep-style).
 */

// ── Storage abstraction ──────────────────────────────────────────────────

export interface Storage {
  listFiles(prefix?: string): AsyncIterable<string>;
  readFile(path: string): Promise<string>;
}

// ── Tool definition ──────────────────────────────────────────────────────

export const searchTool = {
  name: 'search',
  description: 'Search the codebase for patterns',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search pattern (regex supported)',
      },
      path: {
        type: 'string',
        description: 'Limit search to this path prefix',
      },
      type: {
        type: 'string',
        description: 'File type filter (ts, js, py, etc.)',
      },
      maxResults: {
        type: 'number',
        default: 50,
        description: 'Maximum number of results',
      },
    },
    required: ['query'],
  },
};

// ── Type-to-extension mapping ────────────────────────────────────────────

const TYPE_EXTENSIONS: Record<string, string[]> = {
  ts: ['.ts', '.tsx'],
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  py: ['.py'],
  rs: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  rb: ['.rb'],
  php: ['.php'],
  css: ['.css', '.scss', '.less'],
  html: ['.html', '.htm'],
  json: ['.json'],
  yaml: ['.yaml', '.yml'],
  md: ['.md', '.mdx'],
  sql: ['.sql'],
  sh: ['.sh', '.bash'],
};

/** Directories to skip during search. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
  '.venv',
  'vendor',
]);

// ── Executor ─────────────────────────────────────────────────────────────

export async function executeSearch(
  input: { query: string; path?: string; type?: string; maxResults?: number },
  storage: Storage,
): Promise<string> {
  const { query, path, type, maxResults = 50 } = input;

  // 1. Compile regex (case-insensitive by default unless query has uppercase)
  let regex: RegExp;
  try {
    const flags = /[A-Z]/.test(query) ? 'g' : 'gi';
    regex = new RegExp(query, flags);
  } catch {
    // If the regex is invalid, fall back to literal search
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'gi');
  }

  // 2. Resolve allowed extensions from the type filter
  const allowedExtensions = type ? (TYPE_EXTENSIONS[type] ?? [`.${type}`]) : null;

  // 3. Walk files and search
  const results: string[] = [];
  const scanned: string[] = [];
  let matchCount = 0;

  for await (const filePath of storage.listFiles(path)) {
    // Skip blacklisted directories
    const segments = filePath.split('/');
    if (segments.some((s) => SKIP_DIRS.has(s))) continue;

    // Extension filter
    if (allowedExtensions) {
      const ext = getExtension(filePath);
      if (!allowedExtensions.includes(ext)) continue;
    }

    // Skip binary-ish files
    if (isLikelyBinary(filePath)) continue;

    scanned.push(filePath);

    try {
      const content = await storage.readFile(filePath);
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Reset regex state for global flag
        regex.lastIndex = 0;
        if (regex.test(line)) {
          matchCount++;
          if (results.length < maxResults) {
            results.push(`${filePath}:${i + 1}:${line.trimEnd()}`);
          }
        }
      }
    } catch {
      // File unreadable (binary, permissions, etc.) — skip silently
    }

    if (results.length >= maxResults) break;
  }

  // 4. Format output
  if (results.length === 0) {
    return `No matches found for "${query}" (scanned ${scanned.length} files).`;
  }

  const header = `Found ${matchCount} match(es) in ${scanned.length} file(s)`;
  const truncated =
    matchCount > maxResults
      ? `\n(showing first ${maxResults} of ${matchCount} matches)`
      : '';

  return `${header}${truncated}:\n${results.join('\n')}`;
}

// ── Internal ─────────────────────────────────────────────────────────────

function getExtension(filePath: string): string {
  const dotIdx = filePath.lastIndexOf('.');
  return dotIdx === -1 ? '' : filePath.slice(dotIdx);
}

function isLikelyBinary(filePath: string): boolean {
  const ext = getExtension(filePath).toLowerCase();
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.bz2', '.xz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.exe', '.dll', '.so', '.dylib',
    '.wasm', '.class', '.o', '.pyc',
  ]);
  return binaryExtensions.has(ext);
}
