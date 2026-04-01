/**
 * pipeline.ts — Resolution pipeline for sprite generation.
 *
 * Four stages, each progressively higher quality:
 *   1. Draft  (64x64)      — fast, for prototyping
 *   2. Refine (256x256)    — mid-quality, for review
 *   3. Final  (1024x1024)  — high-quality, for production
 *   4. Upscale (2048x2048) — optional, for print/assets
 *
 * Users progress through stages via feedback:
 *   "This looks good, refine it" → step 2
 *   "Perfect, make it final"     → step 3
 *   "I need this for print"      → step 4
 */

import { type GeneratedAsset, type SpriteOptions, type SpriteSize, SpriteGenerator } from './sprites.js';

// ── Types ────────────────────────────────────────────────────────────────

export type PipelineStage = 'draft' | 'refine' | 'final' | 'upscale';

export interface StageConfig {
  stage: PipelineStage;
  size: number;
  quality: number; // 0-1
  description: string;
}

export interface PipelineState {
  assetId: string;
  prompt: string;
  currentStage: PipelineStage;
  stages: Record<PipelineStage, StageResult | null>;
  createdAt: string;
  updatedAt: string;
}

export interface StageResult {
  stage: PipelineStage;
  asset: GeneratedAsset;
  approved: boolean;
  feedback?: string;
  timestamp: string;
}

// ── Stage Definitions ────────────────────────────────────────────────────

export const PIPELINE_STAGES: Record<PipelineStage, StageConfig> = {
  draft:   { stage: 'draft',   size: 64,   quality: 0.3, description: 'Fast draft for prototyping' },
  refine:  { stage: 'refine',  size: 256,  quality: 0.6, description: 'Mid-quality for review' },
  final:   { stage: 'final',   size: 1024, quality: 0.85, description: 'High-quality for production' },
  upscale: { stage: 'upscale', size: 2048, quality: 1.0, description: 'Maximum quality for print/assets' },
};

export const STAGE_ORDER: PipelineStage[] = ['draft', 'refine', 'final', 'upscale'];

export const FEEDBACK_TRIGGERS: Record<string, PipelineStage> = {
  'refine it': 'refine',
  'looks good, refine it': 'refine',
  'make it final': 'final',
  'perfect, make it final': 'final',
  'i need this for print': 'upscale',
  'for print': 'upscale',
  'upscale it': 'upscale',
  'maximum quality': 'upscale',
};

// ── Pipeline ─────────────────────────────────────────────────────────────

export class ResolutionPipeline {
  private generator: SpriteGenerator;
  private states: Map<string, PipelineState> = new Map();

  constructor(generator?: SpriteGenerator) {
    this.generator = generator ?? new SpriteGenerator();
  }

  /**
   * Start a new pipeline at draft stage.
   */
  async start(
    prompt: string,
    options: Omit<SpriteOptions, 'size'> = {},
  ): Promise<PipelineState> {
    const draftAsset = await this.generator.generateSprite(prompt, {
      ...options,
      size: 64,
    });

    const state: PipelineState = {
      assetId: draftAsset.id,
      prompt,
      currentStage: 'draft',
      stages: {
        draft: {
          stage: 'draft',
          asset: draftAsset,
          approved: false,
          timestamp: new Date().toISOString(),
        },
        refine: null,
        final: null,
        upscale: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.states.set(state.assetId, state);
    return state;
  }

  /**
   * Advance pipeline to the next stage.
   */
  async advance(
    assetId: string,
    targetStage?: PipelineStage,
    feedback?: string,
  ): Promise<PipelineState> {
    const state = this.states.get(assetId);
    if (!state) throw new Error(`[pipeline] No pipeline found for asset ${assetId}`);

    const currentIdx = STAGE_ORDER.indexOf(state.currentStage);
    const nextStage = targetStage ?? STAGE_ORDER[currentIdx + 1];
    if (!nextStage) throw new Error(`[pipeline] Already at maximum stage (upscale)`);

    const nextIdx = STAGE_ORDER.indexOf(nextStage);
    if (nextIdx <= currentIdx) {
      throw new Error(`[pipeline] Cannot advance backwards from ${state.currentStage} to ${nextStage}`);
    }

    // Mark current stage as approved
    if (state.stages[state.currentStage]) {
      state.stages[state.currentStage]!.approved = true;
    }

    // Generate at the new resolution (clamp to valid sprite sizes)
    const config = PIPELINE_STAGES[nextStage];
    const validSizes: SpriteSize[] = [16, 32, 64, 128];
    const nearestSize = validSizes.reduce((prev, curr) =>
      Math.abs(curr - config.size) < Math.abs(prev - config.size) ? curr : prev,
    );
    const newAsset = await this.generator.generateSprite(state.prompt, {
      size: nearestSize,
    });

    state.stages[nextStage] = {
      stage: nextStage,
      asset: newAsset,
      approved: false,
      feedback,
      timestamp: new Date().toISOString(),
    };
    state.currentStage = nextStage;
    state.updatedAt = new Date().toISOString();

    return state;
  }

  /**
   * Parse user feedback and advance pipeline accordingly.
   */
  async processFeedback(
    assetId: string,
    feedback: string,
  ): Promise<PipelineState> {
    const lower = feedback.toLowerCase().trim();

    // Match feedback to target stage
    for (const [trigger, stage] of Object.entries(FEEDBACK_TRIGGERS)) {
      if (lower.includes(trigger)) {
        return this.advance(assetId, stage, feedback);
      }
    }

    // Default: advance to next stage
    return this.advance(assetId, undefined, feedback);
  }

  /**
   * Get the current state of a pipeline.
   */
  getState(assetId: string): PipelineState | undefined {
    return this.states.get(assetId);
  }

  /**
   * Get all active pipelines.
   */
  listPipelines(): PipelineState[] {
    return Array.from(this.states.values());
  }

  /**
   * Get the asset at a specific stage.
   */
  getStageAsset(assetId: string, stage: PipelineStage): GeneratedAsset | undefined {
    const state = this.states.get(assetId);
    return state?.stages[stage]?.asset;
  }

  /**
   * Get the history of all completed stages.
   */
  getHistory(assetId: string): StageResult[] {
    const state = this.states.get(assetId);
    if (!state) return [];
    return STAGE_ORDER
      .map((s) => state.stages[s])
      .filter((r): r is StageResult => r !== null);
  }
}
