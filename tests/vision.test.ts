/**
 * vision.test.ts — Tests for sprite generation, tileset, pipeline, and PNG encoding.
 *
 * Uses Vitest. No external dependencies — tests the pure procedural generators
 * and PNG encoder without network calls.
 */

import { describe, it, expect } from 'vitest';
import {
  SpriteGenerator,
  encodePNG,
  PALETTES,
  RESOLUTIONS,
  type SpriteOptions,
  type TileTheme,
} from '../src/vision/sprites.js';
import { ResolutionPipeline, PIPELINE_STAGES, STAGE_ORDER, FEEDBACK_TRIGGERS } from '../src/vision/pipeline.js';

// ── PNG Encoder Tests ────────────────────────────────────────────────────

describe('encodePNG', () => {
  it('encodes a 2x2 RGBA image as valid PNG', () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,    // red
      0, 255, 0, 255,    // green
      0, 0, 255, 255,    // blue
      255, 255, 0, 255,  // yellow
    ]);
    const png = encodePNG(pixels, 2, 2);

    // PNG signature
    expect(png[0]).toBe(137); // \x89
    expect(png[1]).toBe(80);  // P
    expect(png[2]).toBe(78);  // N
    expect(png[3]).toBe(71);  // G

    // Should be at least signature + IHDR + IDAT + IEND
    expect(png.length).toBeGreaterThan(32);
  });

  it('encodes a 1x1 transparent pixel', () => {
    const pixels = new Uint8Array([0, 0, 0, 0]);
    const png = encodePNG(pixels, 1, 1);
    expect(png.length).toBeGreaterThan(20);
  });

  it('encodes a 16x16 image', () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    // Fill with a gradient
    for (let i = 0; i < 256; i++) {
      pixels[i * 4] = i;
      pixels[i * 4 + 1] = 255 - i;
      pixels[i * 4 + 2] = 128;
      pixels[i * 4 + 3] = 255;
    }
    const png = encodePNG(pixels, 16, 16);
    expect(png.length).toBeGreaterThan(100);
  });
});

// ── Sprite Generation Tests ──────────────────────────────────────────────

describe('SpriteGenerator', () => {
  const gen = new SpriteGenerator({ backend: 'auto' });

  it('generates a character sprite at 16x16', async () => {
    const asset = await gen.generateSprite('knight', {
      size: 16,
      category: 'character',
      palette: PALETTES.snes,
      seed: 42,
    });

    expect(asset.id).toBeDefined();
    expect(asset.type).toBe('sprite');
    expect(asset.size).toEqual({ width: 16, height: 16 });
    expect(asset.data).toBeDefined();
    expect(asset.prompt).toBe('knight');
    expect(asset.metadata.size).toBe(16);
    expect(asset.metadata.category).toBe('character');
  });

  it('generates a 32x32 item sprite', async () => {
    const asset = await gen.generateSprite('potion', {
      size: 32,
      category: 'item',
      seed: 100,
    });

    expect(asset.size).toEqual({ width: 32, height: 32 });
    expect(asset.metadata.category).toBe('item');
  });

  it('generates an animated sprite sheet (4 frames)', async () => {
    const asset = await gen.generateSprite('walking hero', {
      size: 32,
      animate: true,
      frames: 4,
      seed: 7,
    });

    expect(asset.size.width).toBe(128); // 32 * 4 frames
    expect(asset.size.height).toBe(32);
    expect(asset.metadata.animated).toBe(true);
    expect(asset.metadata.frames).toBe(4);
  });

  it('generates consistent output with same seed', async () => {
    const opts: SpriteOptions = { size: 16, seed: 999, category: 'character' };
    const a = await gen.generateSprite('test', opts);
    const b = await gen.generateSprite('test', opts);

    expect(a.data).toBe(b.data);
  });

  it('generates different output with different seeds', async () => {
    const a = await gen.generateSprite('test', { size: 16, seed: 1 });
    const b = await gen.generateSprite('test', { size: 16, seed: 2 });

    expect(a.data).not.toBe(b.data);
  });

  it('supports all size options', async () => {
    for (const size of [16, 32, 64, 128] as const) {
      const asset = await gen.generateSprite('test', { size, seed: 1 });
      expect(asset.size).toEqual({ width: size, height: size });
    }
  });

  it('supports all style options', async () => {
    for (const style of ['pixel-art', '16-color', '256-color', 'grayscale'] as const) {
      const asset = await gen.generateSprite('test', { style, size: 16, seed: 1 });
      expect(asset.metadata.style).toBe(style);
    }
  });

  it('caches generated assets', async () => {
    const asset = await gen.generateSprite('cached', { size: 16, seed: 42 });
    const retrieved = gen.getAsset(asset.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(asset.id);
  });

  it('lists all generated assets', async () => {
    await gen.generateSprite('a', { size: 16, seed: 1 });
    await gen.generateSprite('b', { size: 16, seed: 2 });
    const all = gen.listAssets();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Tileset Generation Tests ─────────────────────────────────────────────

describe('SpriteGenerator — tileset', () => {
  const gen = new SpriteGenerator({ backend: 'auto' });

  it('generates a dungeon tileset', async () => {
    const asset = await gen.generateTileset('dungeon', {
      tileSize: 16,
      tileCount: 9,
      seed: 42,
    });

    expect(asset.type).toBe('tileset');
    expect(asset.metadata.theme).toBe('dungeon');
    expect(asset.metadata.tileSize).toBe(16);
    expect(asset.metadata.tileCount).toBe(9);
    // 3x3 grid for 9 tiles
    expect(asset.size.width).toBe(48);
    expect(asset.size.height).toBe(48);
    expect(asset.data).toBeDefined();
  });

  it('generates tileset for all themes', async () => {
    const themes: TileTheme[] = ['dungeon', 'forest', 'castle', 'village', 'underwater', 'space'];
    for (const theme of themes) {
      const asset = await gen.generateTileset(theme, { tileSize: 16, tileCount: 4, seed: 1 });
      expect(asset.metadata.theme).toBe(theme);
    }
  });

  it('uses consistent grid layout', async () => {
    const asset = await gen.generateTileset('forest', { tileSize: 32, tileCount: 16, seed: 1 });
    // 4x4 grid for 16 tiles at 32px each
    expect(asset.size.width).toBe(128);
    expect(asset.size.height).toBe(128);
  });
});

// ── UI Element Generation Tests ──────────────────────────────────────────

describe('SpriteGenerator — UI', () => {
  const gen = new SpriteGenerator({ backend: 'auto' });

  it('generates a button UI element', async () => {
    const asset = await gen.generateUI('Start Game', {
      element: 'button',
      width: 80,
      height: 32,
      seed: 42,
    });

    expect(asset.type).toBe('ui');
    expect(asset.size).toEqual({ width: 80, height: 32 });
    expect(asset.metadata.element).toBe('button');
  });

  it('generates a health bar', async () => {
    const asset = await gen.generateUI('HP', {
      element: 'health-bar',
      width: 120,
      height: 16,
      seed: 42,
    });

    expect(asset.metadata.element).toBe('health-bar');
    expect(asset.size.width).toBe(120);
  });

  it('generates an inventory slot', async () => {
    const asset = await gen.generateUI('Inventory', {
      element: 'inventory-slot',
      width: 32,
      height: 32,
      seed: 42,
    });

    expect(asset.size).toEqual({ width: 32, height: 32 });
  });
});

// ── Background Generation Tests ──────────────────────────────────────────

describe('SpriteGenerator — background', () => {
  const gen = new SpriteGenerator({ backend: 'auto' });

  it('generates a SNES-resolution background', async () => {
    const asset = await gen.generateBackground(
      'forest scene',
      ['sky', 'background', 'mid'],
      { resolution: '256x224', style: 'pixel-art', seed: 42 },
    );

    expect(asset.type).toBe('background');
    expect(asset.size).toEqual({ width: 256, height: 224 });
    expect(asset.metadata.resolution).toBe('256x224');
  });

  it('picks correct palette for scene keywords', async () => {
    const forest = await gen.generateBackground('dark forest', ['sky'], { resolution: '256x224', seed: 1 });
    const dungeon = await gen.generateBackground('underground dungeon', ['sky'], { resolution: '256x224', seed: 1 });

    expect(forest.data).not.toBe(dungeon.data);
  });

  it('supports all resolutions', async () => {
    for (const res of Object.keys(RESOLUTIONS)) {
      const asset = await gen.generateBackground('test', ['sky'], { resolution: res as `${number}x${number}`, seed: 1 });
      expect(asset.size).toEqual(RESOLUTIONS[res]);
    }
  });
});

// ── Pipeline Tests ───────────────────────────────────────────────────────

describe('ResolutionPipeline', () => {
  it('starts at draft stage (64x64)', async () => {
    const pipeline = new ResolutionPipeline();
    const state = await pipeline.start('test sprite', { seed: 42 });

    expect(state.currentStage).toBe('draft');
    expect(state.stages.draft).toBeDefined();
    expect(state.stages.draft!.asset.size.width).toBe(64);
    expect(state.stages.refine).toBeNull();
  });

  it('advances to refine stage', async () => {
    const pipeline = new ResolutionPipeline();
    const state = await pipeline.start('test', { seed: 42 });
    const refined = await pipeline.advance(state.assetId, 'refine');

    expect(refined.currentStage).toBe('refine');
    expect(refined.stages.draft!.approved).toBe(true);
    expect(refined.stages.refine).toBeDefined();
  });

  it('advances through all stages', async () => {
    const pipeline = new ResolutionPipeline();
    let state = await pipeline.start('test', { seed: 42 });

    state = await pipeline.advance(state.assetId, 'refine');
    expect(state.currentStage).toBe('refine');

    state = await pipeline.advance(state.assetId, 'final');
    expect(state.currentStage).toBe('final');

    state = await pipeline.advance(state.assetId, 'upscale');
    expect(state.currentStage).toBe('upscale');
  });

  it('rejects backwards advancement', async () => {
    const pipeline = new ResolutionPipeline();
    const state = await pipeline.start('test', { seed: 42 });
    await pipeline.advance(state.assetId, 'refine');

    await expect(pipeline.advance(state.assetId, 'draft')).rejects.toThrow('Cannot advance backwards');
  });

  it('processes feedback triggers', async () => {
    const pipeline = new ResolutionPipeline();
    const state = await pipeline.start('test', { seed: 42 });

    const refined = await pipeline.processFeedback(state.assetId, 'this looks good, refine it');
    expect(refined.currentStage).toBe('refine');
  });

  it('tracks pipeline history', async () => {
    const pipeline = new ResolutionPipeline();
    const state = await pipeline.start('test', { seed: 42 });
    await pipeline.advance(state.assetId, 'refine');

    const history = pipeline.getHistory(state.assetId);
    expect(history.length).toBe(2);
    expect(history[0].stage).toBe('draft');
    expect(history[1].stage).toBe('refine');
  });

  it('lists active pipelines', async () => {
    const pipeline = new ResolutionPipeline();
    await pipeline.start('test1', { seed: 1 });
    await pipeline.start('test2', { seed: 2 });

    const list = pipeline.listPipelines();
    expect(list.length).toBe(2);
  });

  it('throws for unknown asset', async () => {
    const pipeline = new ResolutionPipeline();
    await expect(pipeline.advance('nonexistent')).rejects.toThrow('No pipeline found');
  });
});

// ── Pipeline Constants Tests ─────────────────────────────────────────────

describe('Pipeline constants', () => {
  it('has 4 stages in order', () => {
    expect(STAGE_ORDER).toEqual(['draft', 'refine', 'final', 'upscale']);
  });

  it('stages have increasing sizes', () => {
    const sizes = STAGE_ORDER.map((s) => PIPELINE_STAGES[s].size);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it('feedback triggers map to valid stages', () => {
    for (const [trigger, stage] of Object.entries(FEEDBACK_TRIGGERS)) {
      expect(STAGE_ORDER).toContain(stage);
      expect(trigger.length).toBeGreaterThan(0);
    }
  });
});

// ── Palette Tests ────────────────────────────────────────────────────────

describe('Palettes', () => {
  it('has all built-in palettes', () => {
    expect(PALETTES.nes).toBeDefined();
    expect(PALETTES.snes).toBeDefined();
    expect(PALETTES.gameboy).toBeDefined();
    expect(PALETTES.grayscale).toBeDefined();
    expect(PALETTES.pastel).toBeDefined();
    expect(PALETTES.darkFantasy).toBeDefined();
  });

  it('each palette has at least 4 colors', () => {
    for (const [name, colors] of Object.entries(PALETTES)) {
      expect(colors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('palette colors are valid hex', () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const colors of Object.values(PALETTES)) {
      for (const c of colors) {
        expect(c).toMatch(hexRegex);
      }
    }
  });
});

// ── Resolution Constants Tests ───────────────────────────────────────────

describe('Resolutions', () => {
  it('has SNES resolution', () => {
    expect(RESOLUTIONS['256x224']).toEqual({ width: 256, height: 224 });
  });

  it('has all standard resolutions', () => {
    expect(Object.keys(RESOLUTIONS)).toContain('256x224');
    expect(Object.keys(RESOLUTIONS)).toContain('320x240');
    expect(Object.keys(RESOLUTIONS)).toContain('640x480');
    expect(Object.keys(RESOLUTIONS)).toContain('1920x1080');
  });
});
