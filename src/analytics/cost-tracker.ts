/**
 * CostTracker — Per-provider/model token usage and cost tracking.
 *
 * Stores aggregated costs in KV (analytics/costs.json) for fast reads.
 * Granular records go to D1 for reporting.
 */

import { PRICING } from '../providers/index.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface CostRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: string;
}

export interface CostSummary {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  byDay: Array<{ date: string; tokens: number; cost: number }>;
  period: string;
}

interface KVAggregates {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  updatedAt: string;
}

// ── CostTracker ────────────────────────────────────────────────────────

export class CostTracker {
  private kvKey = 'analytics/costs';

  constructor(
    private kv: KVNamespace,
    private db?: D1Database,
  ) {}

  /**
   * Record a usage event. Updates both KV (fast aggregate) and D1 (granular).
   */
  async record(record: CostRecord): Promise<void> {
    // Update KV aggregate
    const agg = await this.getAggregates();
    const provider = record.provider;
    const model = record.model;
    const tokens = record.inputTokens + record.outputTokens;

    agg.totalTokens += tokens;
    agg.totalCost += record.cost;
    agg.updatedAt = new Date().toISOString();

    if (!agg.byProvider[provider]) agg.byProvider[provider] = { tokens: 0, cost: 0 };
    agg.byProvider[provider].tokens += tokens;
    agg.byProvider[provider].cost += record.cost;

    if (!agg.byModel[model]) agg.byModel[model] = { tokens: 0, cost: 0 };
    agg.byModel[model].tokens += tokens;
    agg.byModel[model].cost += record.cost;

    await this.kv.put(this.kvKey, JSON.stringify(agg));

    // Write granular record to D1 (if available)
    if (this.db) {
      await this.db
        .prepare(
          `INSERT INTO cost_records (provider, model, input_tokens, output_tokens, cost, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(provider, model, record.inputTokens, record.outputTokens, record.cost, record.timestamp)
        .run()
        .catch(() => {
          // Table may not exist yet — KV is the source of truth
        });
    }
  }

  /**
   * Get the current cost summary (from KV for speed).
   */
  async getSummary(): Promise<CostSummary> {
    const agg = await this.getAggregates();

    // Build byDay from D1 if available
    let byDay: Array<{ date: string; tokens: number; cost: number }> = [];
    if (this.db) {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const rows = await this.db
          .prepare(
            `SELECT provider, model, input_tokens, output_tokens, cost, recorded_at
             FROM cost_records
             WHERE recorded_at >= ?
             ORDER BY recorded_at DESC`,
          )
          .bind(thirtyDaysAgo.toISOString())
          .all<{ provider: string; model: string; input_tokens: number; output_tokens: number; cost: number; recorded_at: string }>();

        const dayMap: Record<string, { tokens: number; cost: number }> = {};
        for (const row of rows.results) {
          const day = (row.recorded_at ?? '').slice(0, 10);
          if (!dayMap[day]) dayMap[day] = { tokens: 0, cost: 0 };
          dayMap[day].tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
          dayMap[day].cost += row.cost ?? 0;
        }
        byDay = Object.entries(dayMap)
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));
      } catch {
        // D1 table may not exist
      }
    }

    return {
      totalTokens: agg.totalTokens,
      totalCost: Math.round(agg.totalCost * 100) / 100,
      byProvider: agg.byProvider,
      byModel: agg.byModel,
      byDay,
      period: new Date().toISOString().slice(0, 7),
    };
  }

  /**
   * Calculate cost from token counts using provider pricing.
   */
  static calculateCost(
    provider: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const rates = PRICING[provider] ?? PRICING.custom;
    return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async getAggregates(): Promise<KVAggregates> {
    const raw = await this.kv.get(this.kvKey, 'text');
    if (raw) {
      try {
        return JSON.parse(raw) as KVAggregates;
      } catch {
        // Corrupt data — reset
      }
    }
    return {
      totalTokens: 0,
      totalCost: 0,
      byProvider: {},
      byModel: {},
      updatedAt: new Date().toISOString(),
    };
  }
}
