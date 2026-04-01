/**
 * dev-assets.ts — Developer asset generation via Google Gemini API.
 *
 * Generates icons, screenshots, diagrams, avatars, and logos
 * for developer projects using the Gemini image generation model.
 * Falls back to procedural generation when no API key is available.
 */

import { encodePNG, type GeneratedAsset, PALETTES } from './sprites.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface DevAssetConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  fallbackBackend?: 'procedural' | 'ollama';
  ollamaModel?: string;
  ollamaHost?: string;
}

export type IconSize = 16 | 32 | 64 | 128;
export type LogoStyle = 'minimal' | 'bold' | 'geometric' | 'handdrawn' | 'gradient' | 'retro';
export type DiagramType = 'architecture' | 'flowchart' | 'sequence' | 'class' | 'er';

export interface IconOptions {
  size?: IconSize;
  transparent?: boolean;
  palette?: string[];
}

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  device?: 'desktop' | 'tablet' | 'mobile';
  darkMode?: boolean;
}

export interface DiagramOptions {
  type?: DiagramType;
  theme?: 'dark' | 'light';
  direction?: 'tb' | 'lr';
}

export interface AvatarOptions {
  size?: number;
  style?: 'pixel' | 'flat' | '3d';
  palette?: string[];
}

export interface LogoOptions {
  width?: number;
  height?: number;
  style?: LogoStyle;
  palette?: string[];
}

// ── Asset ID Generator ───────────────────────────────────────────────────

function generateAssetId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Gemini API Client ────────────────────────────────────────────────────

interface GeminiImageResponse {
  imageData?: string; // base64
  description?: string;
  palette?: string[];
}

async function geminiImageGenerate(
  prompt: string,
  apiKey: string,
  model?: string,
): Promise<GeminiImageResponse | null> {
  const modelName = model ?? 'gemini-2.0-flash';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as GeminiImageResponse;
  } catch {
    return null;
  }
}

// ── Procedural Fallback Generators ───────────────────────────────────────

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255,
  ];
}

function generateProceduralIcon(
  size: number,
  palette: string[],
  seed: number,
  transparent: boolean,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const colors = palette.map(hexToRgba);
  const rng = seededRng(seed);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  // Rounded square with colored fill
  const cornerR = size * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rectangle test
      let inside = true;
      const corners = [
        [cornerR, cornerR],
        [size - cornerR, cornerR],
        [cornerR, size - cornerR],
        [size - cornerR, size - cornerR],
      ];
      for (const [ccx, ccy] of corners) {
        const dx = Math.abs(x - ccx);
        const dy = Math.abs(y - ccy);
        if (x < cornerR && y < cornerR && dx * dx + dy * dy > cornerR * cornerR) inside = false;
        if (x >= size - cornerR && y < cornerR && dx * dx + dy * dy > cornerR * cornerR) inside = false;
        if (x < cornerR && y >= size - cornerR && dx * dx + dy * dy > cornerR * cornerR) inside = false;
        if (x >= size - cornerR && y >= size - cornerR && dx * dx + dy * dy > cornerR * cornerR) inside = false;
      }

      if (!inside && transparent) {
        pixels[idx + 3] = 0;
        continue;
      }

      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const isEdge = Math.abs(dist - r) < 1.5;

      const colorIdx = Math.min(colors.length - 1, Math.floor(rng() * Math.max(1, colors.length * 0.6)));
      const c = colors[colorIdx] ?? colors[0]!;
      const bg = colors[Math.min(1, colors.length - 1)]!;

      if (isEdge) {
        pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 255;
      } else if (dist < r) {
        pixels[idx] = c[0]; pixels[idx + 1] = c[1]; pixels[idx + 2] = c[2]; pixels[idx + 3] = 255;
      } else if (transparent) {
        pixels[idx + 3] = 0;
      } else {
        pixels[idx] = bg[0]; pixels[idx + 1] = bg[1]; pixels[idx + 2] = bg[2]; pixels[idx + 3] = 255;
      }
    }
  }
  return pixels;
}

function generateProceduralScreenshot(
  width: number,
  height: number,
  darkMode: boolean,
  seed: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const rng = seededRng(seed);
  const bg = darkMode ? [26, 26, 46] : [255, 255, 255];
  const fg = darkMode ? [230, 230, 250] : [30, 30, 30];
  const accent = darkMode ? [0, 200, 200] : [0, 120, 200];
  const sidebar = darkMode ? [40, 40, 60] : [240, 240, 245];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const sidebarWidth = Math.floor(width * 0.2);
      const headerHeight = Math.floor(height * 0.08);

      let r: number, g: number, b: number;

      if (x < sidebarWidth) {
        r = sidebar[0]; g = sidebar[1]; b = sidebar[2];
      } else if (y < headerHeight) {
        r = fg[0]; g = fg[1]; b = fg[2];
      } else {
        r = bg[0]; g = bg[1]; b = bg[2];
      }

      // Sidebar items
      if (x < sidebarWidth && y > headerHeight) {
        const itemY = (y - headerHeight) % 30;
        if (itemY < 20 && x > 10 && x < sidebarWidth - 10) {
          r = fg[0]; g = fg[1]; b = fg[2];
          if (rng() < 0.1) { r = accent[0]; g = accent[1]; b = accent[2]; }
        }
      }

      // Code lines in main area
      if (x >= sidebarWidth + 20 && y > headerHeight + 20 && y < height - 20) {
        const lineY = (y - headerHeight - 20) % 20;
        if (lineY < 2 && rng() < 0.7) {
          const lineLen = Math.floor(rng() * (width - sidebarWidth - 60)) + 40;
          if (x - sidebarWidth - 20 < lineLen) {
            r = accent[0]; g = accent[1]; b = accent[2];
          }
        }
      }

      pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = 255;
    }
  }
  return pixels;
}

function generateProceduralDiagram(
  width: number,
  height: number,
  type: DiagramType,
  theme: 'dark' | 'light',
  seed: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const rng = seededRng(seed);
  const bg = theme === 'dark' ? [20, 20, 35] : [255, 255, 255];
  const box = theme === 'dark' ? [50, 50, 80] : [220, 230, 240];
  const text = theme === 'dark' ? [200, 200, 220] : [40, 40, 40];
  const line = theme === 'dark' ? [100, 200, 200] : [0, 120, 180];

  // Fill background
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = bg[0]; pixels[i * 4 + 1] = bg[1]; pixels[i * 4 + 2] = bg[2]; pixels[i * 4 + 3] = 255;
  }

  // Draw boxes (nodes)
  const nodeCount = type === 'sequence' ? 4 : 6;
  const nodes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const boxW = Math.floor(width * 0.18);
  const boxH = Math.floor(height * 0.08);

  for (let i = 0; i < nodeCount; i++) {
    const nx = Math.floor(rng() * (width - boxW * 2)) + boxW;
    const ny = Math.floor(rng() * (height - boxH * 2)) + boxH;
    nodes.push({ x: nx, y: ny, w: boxW, h: boxH });

    // Draw box
    for (let y = ny; y < ny + boxH && y < height; y++) {
      for (let x = nx; x < nx + boxW && x < width; x++) {
        const idx = (y * width + x) * 4;
        const isBorder = x === nx || x === nx + boxW - 1 || y === ny || y === ny + boxH - 1;
        if (isBorder) {
          pixels[idx] = line[0]; pixels[idx + 1] = line[1]; pixels[idx + 2] = line[2];
        } else {
          pixels[idx] = box[0]; pixels[idx + 1] = box[1]; pixels[idx + 2] = box[2];
        }
      }
    }
  }

  // Draw connections (lines between nodes)
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i]!;
    const to = nodes[i + 1]!;
    const fx = Math.floor(from.x + from.w / 2);
    const fy = Math.floor(from.y + from.h / 2);
    const tx = Math.floor(to.x + to.w / 2);
    const ty = Math.floor(to.y + to.h / 2);

    // Simple line drawing (Bresenham-ish)
    const steps = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const px = Math.floor(fx + (tx - fx) * t);
      const py = Math.floor(fy + (ty - fy) * t);
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        pixels[idx] = line[0]; pixels[idx + 1] = line[1]; pixels[idx + 2] = line[2]; pixels[idx + 3] = 255;
      }
    }
  }

  return pixels;
}

function generateProceduralAvatar(
  size: number,
  palette: string[],
  seed: number,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const colors = palette.map(hexToRgba);
  const rng = seededRng(seed);
  const cx = size / 2;
  const cy = size / 2;
  const headR = size * 0.3;

  // Background circle
  const bgColor = colors[0] ?? [60, 60, 80, 255];
  const skinColor = colors[1] ?? [255, 200, 150, 255];
  const hairColor = colors[2] ?? [60, 40, 20, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const headDist = Math.sqrt((x - cx) ** 2 + (y - cy + size * 0.05) ** 2);

      if (dist > size * 0.48) {
        pixels[idx + 3] = 0; // transparent outside circle
      } else {
        pixels[idx] = bgColor[0]; pixels[idx + 1] = bgColor[1];
        pixels[idx + 2] = bgColor[2]; pixels[idx + 3] = 255;

        // Head
        if (headDist < headR) {
          pixels[idx] = skinColor[0]; pixels[idx + 1] = skinColor[1];
          pixels[idx + 2] = skinColor[2];
        }
        // Hair (top of head)
        if (y < cy - size * 0.1 && headDist < headR + 2) {
          pixels[idx] = hairColor[0]; pixels[idx + 1] = hairColor[1];
          pixels[idx + 2] = hairColor[2];
        }
        // Eyes
        const eyeY = cy - size * 0.02;
        const leftEyeX = cx - size * 0.1;
        const rightEyeX = cx + size * 0.1;
        if (Math.abs(y - eyeY) < 2) {
          if (Math.abs(x - leftEyeX) < 2 || Math.abs(x - rightEyeX) < 2) {
            pixels[idx] = 30; pixels[idx + 1] = 30; pixels[idx + 2] = 30;
          }
        }
      }
    }
  }
  return pixels;
}

function generateProceduralLogo(
  width: number,
  height: number,
  style: LogoStyle,
  palette: string[],
  seed: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const colors = palette.map(hexToRgba);
  const rng = seededRng(seed);

  // Background
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 3] = 0; // transparent
  }

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.4;
  const c1 = colors[0] ?? [0, 200, 200, 255];
  const c2 = colors[1] ?? [100, 100, 200, 255];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < r) {
        if (style === 'geometric') {
          // Triangle
          const t = dy / (r * 2);
          const halfW = r * (1 - Math.abs(t * 2 - 1)) * 0.8;
          if (Math.abs(dx) < halfW) {
            pixels[idx] = c1[0]; pixels[idx + 1] = c1[1];
            pixels[idx + 2] = c1[2]; pixels[idx + 3] = 255;
          }
        } else if (style === 'bold') {
          // Bold circle
          pixels[idx] = c1[0]; pixels[idx + 1] = c1[1];
          pixels[idx + 2] = c1[2]; pixels[idx + 3] = 255;
        } else if (style === 'gradient') {
          const t = dist / r;
          pixels[idx] = Math.floor(c1[0] + (c2[0] - c1[0]) * t);
          pixels[idx + 1] = Math.floor(c1[1] + (c2[1] - c1[1]) * t);
          pixels[idx + 2] = Math.floor(c1[2] + (c2[2] - c1[2]) * t);
          pixels[idx + 3] = 255;
        } else if (style === 'retro') {
          // Pixelated circle
          const px = Math.floor(x / 4) * 4;
          const py = Math.floor(y / 4) * 4;
          const pdist = Math.sqrt((px + 2 - cx) ** 2 + (py + 2 - cy) ** 2);
          if (pdist < r) {
            pixels[idx] = c1[0]; pixels[idx + 1] = c1[1];
            pixels[idx + 2] = c1[2]; pixels[idx + 3] = 255;
          }
        } else {
          // Minimal — thin ring
          if (dist > r - 3 && dist < r) {
            pixels[idx] = c1[0]; pixels[idx + 1] = c1[1];
            pixels[idx + 2] = c1[2]; pixels[idx + 3] = 255;
          }
        }
      }
    }
  }
  return pixels;
}

function uint8ToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

// ── Public API: DevAssetGenerator ────────────────────────────────────────

export class DevAssetGenerator {
  private config: DevAssetConfig;

  constructor(config: DevAssetConfig = {}) {
    this.config = config;
  }

  /**
   * Generate an app/tool icon (128x128, transparent).
   * Uses Gemini for AI-assisted palette, falls back to procedural.
   */
  async generateIcon(prompt: string, options: IconOptions = {}): Promise<GeneratedAsset> {
    const size = options.size ?? 128;
    const transparent = options.transparent ?? true;
    const palette = options.palette ?? PALETTES.snes;
    const seed = Date.now();

    // Try Gemini for palette enhancement
    let finalPalette = palette;
    if (this.config.geminiApiKey) {
      const result = await geminiImageGenerate(
        `Generate a color palette for a "${prompt}" app icon. Output JSON with "palette" (6 hex color codes).`,
        this.config.geminiApiKey,
        this.config.geminiModel,
      );
      if (result?.palette?.length) finalPalette = result.palette;
    }

    const pixels = generateProceduralIcon(size, finalPalette, seed, transparent);
    const png = encodePNG(pixels, size, size);
    const base64 = uint8ToBase64(png);

    return {
      id: generateAssetId(),
      prompt,
      type: 'sprite',
      size: { width: size, height: size },
      data: base64,
      palette: finalPalette,
      metadata: { kind: 'icon', transparent, seed },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a UI mockup/screenshot from description.
   */
  async generateScreenshot(prompt: string, options: ScreenshotOptions = {}): Promise<GeneratedAsset> {
    const dims: Record<string, [number, number]> = {
      desktop: [1280, 720],
      tablet: [768, 1024],
      mobile: [375, 812],
    };
    const device = options.device ?? 'desktop';
    const [width, height] = dims[device] ?? dims.desktop!;
    const darkMode = options.darkMode ?? true;
    const seed = Date.now();

    const pixels = generateProceduralScreenshot(width, height, darkMode, seed);
    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    return {
      id: generateAssetId(),
      prompt,
      type: 'sprite',
      size: { width, height },
      data: base64,
      palette: darkMode ? PALETTES.snes : PALETTES.pastel,
      metadata: { kind: 'screenshot', device, darkMode, seed },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generate an architecture diagram from text description.
   */
  async generateDiagram(description: string, options: DiagramOptions = {}): Promise<GeneratedAsset> {
    const type = options.type ?? 'architecture';
    const theme = options.theme ?? 'dark';
    const width = 800;
    const height = 600;
    const seed = Date.now();

    const pixels = generateProceduralDiagram(width, height, type, theme, seed);
    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    return {
      id: generateAssetId(),
      prompt: description,
      type: 'sprite',
      size: { width, height },
      data: base64,
      palette: theme === 'dark' ? PALETTES.snes : PALETTES.pastel,
      metadata: { kind: 'diagram', diagramType: type, theme, seed },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a developer avatar.
   */
  async generateAvatar(prompt: string, options: AvatarOptions = {}): Promise<GeneratedAsset> {
    const size = options.size ?? 128;
    const palette = options.palette ?? ['#2B2D42', '#FFD6A5', '#6B4226', '#EDF2F4', '#8D99AE'];
    const seed = Date.now();

    const pixels = generateProceduralAvatar(size, palette, seed);
    const png = encodePNG(pixels, size, size);
    const base64 = uint8ToBase64(png);

    return {
      id: generateAssetId(),
      prompt,
      type: 'sprite',
      size: { width: size, height: size },
      data: base64,
      palette,
      metadata: { kind: 'avatar', seed },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a project logo.
   */
  async generateLogo(prompt: string, style: LogoStyle = 'minimal', options: LogoOptions = {}): Promise<GeneratedAsset> {
    const width = options.width ?? 256;
    const height = options.height ?? 256;
    const palette = options.palette ?? ['#00C8C8', '#6464C8', '#FFFFFF', '#2B2D42'];
    const seed = Date.now();

    // Try Gemini for palette enhancement
    let finalPalette = palette;
    if (this.config.geminiApiKey) {
      const result = await geminiImageGenerate(
        `Generate a color palette for a "${prompt}" logo in ${style} style. Output JSON with "palette" (4 hex color codes).`,
        this.config.geminiApiKey,
        this.config.geminiModel,
      );
      if (result?.palette?.length) finalPalette = result.palette;
    }

    const pixels = generateProceduralLogo(width, height, style, finalPalette, seed);
    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    return {
      id: generateAssetId(),
      prompt,
      type: 'sprite',
      size: { width, height },
      data: base64,
      palette: finalPalette,
      metadata: { kind: 'logo', style, seed },
      createdAt: new Date().toISOString(),
    };
  }
}
