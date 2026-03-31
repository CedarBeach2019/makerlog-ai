// KV-backed memory store — persistent agent memory with confidence decay

export interface MemoryEntry {
  key: string;
  value: string;
  confidence: number; // 0-1, decays over time
  source: 'explicit' | 'preference' | 'error-pattern' | 'implicit' | 'git-derived';
  createdAt: number;
  lastAccessed: number;
}

/** Maximum entries before oldest-lowest-confidence are pruned. */
const MAX_ENTRIES = 1000;

/** Confidence floor — entries below this are pruned during decay. */
const CONFIDENCE_FLOOR = 0.3;

/** Decay factor applied per decay() call. */
const DECAY_FACTOR = 0.95;

/** Initial confidence by source. */
const SOURCE_CONFIDENCE: Record<MemoryEntry['source'], number> = {
  explicit: 1.0,
  preference: 0.9,
  'error-pattern': 0.8,
  implicit: 0.7,
  'git-derived': 0.6,
};

/**
 * A persistent key-value memory store for agent facts.
 *
 * Accepts either a Cloudflare KVNamespace or a plain Map for local use.
 * Entries carry a confidence score that decays over time; low-confidence
 * entries are automatically pruned.
 */
export class MemoryStore {
  private kv: KVNamespace | Map<string, string>;
  private cache: Map<string, MemoryEntry> = new Map();
  private hydrated: boolean = false;

  constructor(kv: KVNamespace | Map<string, string>) {
    this.kv = kv;
  }

  /**
   * Store a memory entry.
   * If the key already exists, the value is overwritten but the original
   * createdAt is preserved (memory is reinforced, not replaced).
   */
  async set(
    key: string,
    value: string,
    source: MemoryEntry['source'],
  ): Promise<void> {
    await this.hydrate();

    const now = Date.now();
    const existing = this.cache.get(key);

    const entry: MemoryEntry = {
      key,
      value,
      confidence: existing
        ? Math.min(1.0, existing.confidence + 0.1) // reinforce
        : SOURCE_CONFIDENCE[source],
      source,
      createdAt: existing?.createdAt ?? now,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    await this.persist(key, entry);
    await this.enforceLimit();
  }

  /** Retrieve a single entry by key. */
  async get(key: string): Promise<MemoryEntry | null> {
    await this.hydrate();

    const entry = this.cache.get(key);
    if (!entry) {
      // Try loading from backing store (may have been evicted from cache)
      const raw = await this.kvGet(key);
      if (!raw) return null;

      const parsed = this.parseEntry(raw);
      if (!parsed) return null;

      this.cache.set(key, parsed);
      return parsed;
    }

    // Touch last accessed
    entry.lastAccessed = Date.now();
    await this.persist(key, entry);
    return entry;
  }

  /**
   * Search memories by query.
   * Uses simple substring matching against both key and value.
   * Returns results sorted by confidence (highest first).
   */
  async search(query: string): Promise<MemoryEntry[]> {
    await this.hydrate();

    const lowerQuery = query.toLowerCase();
    const results: MemoryEntry[] = [];

    for (const entry of this.cache.values()) {
      if (this.matchesQuery(entry, lowerQuery)) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /** Delete a memory entry by key. */
  async delete(key: string): Promise<void> {
    await this.hydrate();
    this.cache.delete(key);
    await this.kvDelete(key);
  }

  /**
   * Decay all entries — reduce confidence by DECAY_FACTOR and prune
   * any entries that fall below CONFIDENCE_FLOOR.
   *
   * Should be called periodically (e.g. every 6 hours via scheduler).
   */
  async decay(): Promise<void> {
    await this.hydrate();

    const toDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      // Explicit entries never decay
      if (entry.source === 'explicit') continue;

      entry.confidence *= DECAY_FACTOR;

      if (entry.confidence < CONFIDENCE_FLOOR) {
        toDelete.push(key);
      } else {
        await this.persist(key, entry);
      }
    }

    // Prune below-floor entries
    for (const key of toDelete) {
      this.cache.delete(key);
      await this.kvDelete(key);
    }
  }

  /** Export all entries as a plain object. */
  async export(): Promise<Record<string, MemoryEntry>> {
    await this.hydrate();

    const result: Record<string, MemoryEntry> = {};
    for (const [key, entry] of this.cache) {
      result[key] = { ...entry };
    }
    return result;
  }

  /** Simple substring match against key and value. */
  private matchesQuery(entry: MemoryEntry, lowerQuery: string): boolean {
    const lowerKey = entry.key.toLowerCase();
    const lowerValue = entry.value.toLowerCase();
    return lowerKey.includes(lowerQuery) || lowerValue.includes(lowerQuery);
  }

  // -----------------------------------------------------------------------
  // Backing store helpers — abstract over KVNamespace vs Map
  // -----------------------------------------------------------------------

  private async persist(key: string, entry: MemoryEntry): Promise<void> {
    const serialized = JSON.stringify(entry);
    await this.kvPut(`memory:${key}`, serialized);
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;

    // For Map-backed stores, list is not available — entries are loaded on demand.
    // For KVNamespace, we attempt a list and bulk-load.
    if (this.kv instanceof Map) {
      // Map entries are already in-memory; nothing to hydrate.
      // Convert raw Map entries into MemoryEntry objects on first access.
      for (const [k, v] of this.kv.entries()) {
        if (k.startsWith('memory:') && !this.cache.has(k.slice(7))) {
          const parsed = this.parseEntry(v);
          if (parsed) {
            this.cache.set(parsed.key, parsed);
          }
        }
      }
    }

    this.hydrated = true;
  }

  private async enforceLimit(): Promise<void> {
    if (this.cache.size <= MAX_ENTRIES) return;

    // Sort by confidence ascending, then by lastAccessed ascending (oldest first)
    const entries = [...this.cache.entries()].sort(([, a], [, b]) => {
      if (a.confidence !== b.confidence) return a.confidence - b.confidence;
      return a.lastAccessed - b.lastAccessed;
    });

    const excess = this.cache.size - MAX_ENTRIES;
    for (let i = 0; i < excess; i++) {
      const [key] = entries[i];
      this.cache.delete(key);
      await this.kvDelete(key);
    }
  }

  private parseEntry(raw: string): MemoryEntry | null {
    try {
      return JSON.parse(raw) as MemoryEntry;
    } catch {
      return null;
    }
  }

  private async kvPut(key: string, value: string): Promise<void> {
    if (this.kv instanceof Map) {
      this.kv.set(key, value);
    } else {
      await (this.kv as KVNamespace).put(key, value);
    }
  }

  private async kvGet(key: string): Promise<string | null> {
    if (this.kv instanceof Map) {
      return (this.kv as Map<string, string>).get(key) ?? null;
    }
    return await (this.kv as KVNamespace).get(key);
  }

  private async kvDelete(key: string): Promise<void> {
    if (this.kv instanceof Map) {
      (this.kv as Map<string, string>).delete(key);
    } else {
      await (this.kv as KVNamespace).delete(key);
    }
  }
}

/**
 * Minimal KVNamespace type stub so this module compiles without
 * @cloudflare/workers-types installed.
 */
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ keys: Array<{ name: string }> }>;
}
