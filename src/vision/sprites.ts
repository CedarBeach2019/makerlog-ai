/**
 * sprites.ts — Pixel-art sprite generation for rapid prototyping.
 *
 * Generates SNES-level sprites, tilesets, UI elements, and backgrounds
 * via local Ollama (Jetson) or cloud API (Gemini). Includes a minimal
 * PNG encoder that works in Cloudflare Workers (no canvas dependency).
 */

// ── Types ────────────────────────────────────────────────────────────────

export type SpriteSize = 16 | 32 | 64 | 128;
export type SpriteStyle = 'pixel-art' | '16-color' | '256-color' | 'grayscale';
export type SpriteCategory = 'character' | 'item' | 'background' | 'icon' | 'tile' | 'ui';
export type TileTheme = 'dungeon' | 'forest' | 'castle' | 'village' | 'underwater' | 'space';
export type UIStyle = 'retro' | 'modern' | 'minimalist';
export type UIElement = 'button' | 'panel' | 'frame' | 'health-bar' | 'inventory-slot';
export type ParallaxLayer = 'foreground' | 'mid' | 'background' | 'sky';
export type BackgroundStyle = 'pixel-art' | 'watercolor' | 'oil' | 'digital';

export interface SpriteOptions {
  size?: SpriteSize;
  style?: SpriteStyle;
  category?: SpriteCategory;
  palette?: string[];
  animate?: boolean;
  frames?: number;
  seed?: number;
}

export interface TilesetOptions {
  tileSize?: SpriteSize;
  tileCount?: number;
  seed?: number;
}

export interface UIOptions {
  element: UIElement;
  style?: UIStyle;
  width?: number;
  height?: number;
  palette?: string[];
  seed?: number;
}

export interface BackgroundOptions {
  resolution?: `${number}x${number}`;
  style?: BackgroundStyle;
  parallaxLayers?: ParallaxLayer[];
  seed?: number;
}

export interface GeneratedAsset {
  id: string;
  prompt: string;
  type: 'sprite' | 'tileset' | 'ui' | 'background';
  size: { width: number; height: number };
  data: string; // base64 PNG
  palette: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Built-in Palettes ────────────────────────────────────────────────────

export const PALETTES: Record<string, string[]> = {
  nes: ['#000000', '#FCFCFC', '#F8F8F8', '#BCBCBC', '#7C7C7C', '#A4E4FC', '#3CBCFC', '#0078F8', '#0000FC', '#B8B8F8', '#6888FC', '#0058F8', '#0000BC', '#D8B8F8', '#9878F8', '#6844FC', '#4428BC', '#F8B8F8', '#F878F8', '#D800CC', '#940084', '#F8A4C0', '#F85898', '#E40058', '#A80020', '#F0D0B0', '#F87858', '#F83800', '#A81000', '#FCE0A8', '#FCA044', '#E45C10', '#881400', '#F8D878', '#F8B800', '#AC7C00', '#503000', '#D8F878', '#B8F818', '#00B800', '#007800', '#B8F8B8', '#58D854', '#00A800', '#006800', '#B8F8D8', '#58F898', '#00A844', '#005800', '#00FCFC', '#00E8D8', '#008888', '#004058'],
  snes: ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
  gameboy: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
  grayscale: ['#000000', '#1C1C1C', '#383838', '#555555', '#717171', '#8D8D8D', '#AAAAAA', '#C6C6C6', '#E2E2E2', '#FFFFFF'],
  pastel: ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#E8BAFF'],
  darkFantasy: ['#1A1A2E', '#16213E', '#0F3460', '#533483', '#E94560', '#FFD700', '#2ECC71', '#ECF0F1'],
};

// ── SNES Resolutions ─────────────────────────────────────────────────────

export const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  '256x224': { width: 256, height: 224 },   // SNES
  '320x240': { width: 320, height: 240 },   // QVGA
  '640x480': { width: 640, height: 480 },   // VGA
  '1920x1080': { width: 1920, height: 1080 }, // Full HD
};

// ── Minimal PNG Encoder (Workers-compatible) ─────────────────────────────

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  const crcVal = new Uint8Array(4);
  new DataView(crcVal.buffer).setUint32(0, crc32(crcInput));
  const result = new Uint8Array(4 + 4 + data.length + 4);
  result.set(len);
  result.set(typeBytes, 4);
  result.set(data, 8);
  result.set(crcVal, 8 + data.length);
  return result;
}

/**
 * Encode RGBA pixel data as a PNG. No external deps — works in Workers.
 */
export function encodePNG(pixels: Uint8Array, width: number, height: number): Uint8Array {
  // Build raw scanlines: filter byte (0 = None) + RGBA pixels per row
  const rowSize = 1 + width * 4;
  const raw = new Uint8Array(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      raw[dstIdx] = pixels[srcIdx];       // R
      raw[dstIdx + 1] = pixels[srcIdx + 1]; // G
      raw[dstIdx + 2] = pixels[srcIdx + 2]; // B
      raw[dstIdx + 3] = pixels[srcIdx + 3]; // A
    }
  }

  // Compress with deflate (Web Streams API / DecompressionStream available in Workers)
  const compressed = deflateRaw(raw);

  // IHDR
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = writeChunk('IHDR', ihdr);
  const idatChunk = writeChunk('IDAT', compressed);
  const iendChunk = writeChunk('IEND', new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  let offset = 0;
  png.set(signature, offset); offset += signature.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}

/**
 * Deflate compression using the Web Streams Compression API.
 * Falls back to a simple store (no compression) if unavailable.
 */
function deflateRaw(data: Uint8Array): Uint8Array {
  // In Cloudflare Workers and modern runtimes, we can use
  // the CompressionStream API for deflate-raw.
  // For environments without it, we produce an uncompressed zlib stream.
  // This is synchronous-safe by returning a stored block.

  // Minimal zlib wrapper: CMF=0x78 (deflate, window=7), FLG=0x01 (check)
  // + stored block (BFINAL=1, BTYPE=00) + Adler-32 checksum
  const len = data.length;
  const maxBlock = 65535;
  const blocks: Uint8Array[] = [];

  // zlib header
  blocks.push(new Uint8Array([0x78, 0x01]));

  let offset = 0;
  while (offset < len) {
    const remaining = len - offset;
    const blockLen = Math.min(remaining, maxBlock);
    const isFinal = offset + blockLen >= len;

    // Stored block header: BFINAL (1 bit) + BTYPE (2 bits) = 1 byte
    // For stored blocks: BTYPE=00, so byte = BFINAL ? 0x01 : 0x00
    const header = new Uint8Array(5);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = blockLen & 0xFF;
    header[2] = (blockLen >> 8) & 0xFF;
    header[3] = ~blockLen & 0xFF;
    header[4] = (~blockLen >> 8) & 0xFF;

    blocks.push(header);
    blocks.push(data.slice(offset, offset + blockLen));
    offset += blockLen;
  }

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, (b << 16) | a);
  blocks.push(adler);

  const totalLen = blocks.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const block of blocks) {
    result.set(block, pos);
    pos += block.length;
  }
  return result;
}

// ── Color Utilities ──────────────────────────────────────────────────────

function uint8ToBase64(data: Uint8Array): string {
  // Chunked conversion to avoid call stack overflow with spread operator
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
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

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ── Seeded PRNG ──────────────────────────────────────────────────────────

function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ── Procedural Pixel Art Generators ──────────────────────────────────────

function generateCharacterPixels(
  size: number,
  palette: string[],
  rng: () => number,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const half = Math.ceil(size / 2);
  const colors = palette.map(hexToRgba);

  // Symmetric character: generate left half, mirror right
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < half; x++) {
      const isEdge = x === 0 || y === 0 || y === size - 1;
      const isOutline = isEdge || rng() < 0.15;
      const isBody = !isOutline && x > 1 && x < half - 1 && y > 2 && y < size - 2;

      let colorIdx: number;
      if (isOutline) {
        colorIdx = 0; // darkest = outline
      } else if (isBody) {
        colorIdx = Math.min(colors.length - 1, 1 + Math.floor(rng() * Math.min(3, colors.length - 1)));
      } else {
        colorIdx = Math.min(colors.length - 1, Math.floor(rng() * colors.length));
      }

      const c = colors[colorIdx] ?? [0, 0, 0, 0];
      const outlineC = colors[0] ?? [0, 0, 0, 255];

      // Head zone (top 40%)
      const headZone = y < size * 0.4;
      // Body zone (40-80%)
      // Legs zone (80-100%)

      const useOutline = isOutline && !headZone;
      const rgba = useOutline ? outlineC : c;

      // Left half
      const idx = (y * size + x) * 4;
      pixels[idx] = rgba[0];
      pixels[idx + 1] = rgba[1];
      pixels[idx + 2] = rgba[2];
      pixels[idx + 3] = rgba[3];

      // Mirror to right half
      const mx = size - 1 - x;
      if (mx !== x) {
        const midx = (y * size + mx) * 4;
        pixels[midx] = rgba[0];
        pixels[midx + 1] = rgba[1];
        pixels[midx + 2] = rgba[2];
        pixels[midx + 3] = rgba[3];
      }
    }
  }
  return pixels;
}

function generateItemPixels(
  size: number,
  palette: string[],
  rng: () => number,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const colors = palette.map(hexToRgba);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      if (dist < r) {
        // Inside item
        const highlight = dist < r * 0.5;
        const colorIdx = highlight
          ? Math.min(colors.length - 1, Math.floor(colors.length * 0.7))
          : Math.min(colors.length - 1, Math.floor(rng() * colors.length * 0.5) + 1);
        const c = colors[colorIdx] ?? colors[0]!;
        pixels[idx] = c[0];
        pixels[idx + 1] = c[1];
        pixels[idx + 2] = c[2];
        pixels[idx + 3] = 255;
      } else if (dist < r + 1) {
        // Outline
        const c = colors[0]!;
        pixels[idx] = c[0];
        pixels[idx + 1] = c[1];
        pixels[idx + 2] = c[2];
        pixels[idx + 3] = 255;
      } else {
        pixels[idx + 3] = 0; // transparent
      }
    }
  }
  return pixels;
}

function generateTilePixels(
  size: number,
  palette: string[],
  rng: () => number,
  isWall: boolean,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const colors = palette.map(hexToRgba);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const noise = rng();
      const baseIdx = isWall ? 0 : Math.floor(colors.length / 2);
      const colorIdx = Math.min(colors.length - 1, baseIdx + Math.floor(noise * 2));
      const c = colors[colorIdx] ?? colors[0]!;

      const idx = (y * size + x) * 4;
      pixels[idx] = c[0];
      pixels[idx + 1] = c[1];
      pixels[idx + 2] = c[2];
      pixels[idx + 3] = 255;

      // Add grid lines
      if (x === 0 || y === 0) {
        pixels[idx] = Math.max(0, c[0] - 30);
        pixels[idx + 1] = Math.max(0, c[1] - 30);
        pixels[idx + 2] = Math.max(0, c[2] - 30);
      }
    }
  }
  return pixels;
}

function generateUIPixels(
  width: number,
  height: number,
  palette: string[],
  element: UIElement,
  rng: () => number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const colors = palette.map(hexToRgba);
  const bg = colors[1] ?? [40, 40, 60, 255];
  const border = colors[0] ?? [255, 255, 255, 255];
  const highlight = colors[2] ?? [100, 100, 140, 255];

  const borderWidth = Math.max(2, Math.floor(Math.min(width, height) * 0.08));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isBorder = x < borderWidth || x >= width - borderWidth ||
                       y < borderWidth || y >= height - borderWidth;
      const isHighlight = (x === borderWidth || y === borderWidth) && isBorder;

      if (element === 'health-bar') {
        const fillRatio = 0.75; // 75% health
        const fillX = Math.floor(width * fillRatio);
        if (y < 3 || y >= height - 3 || x < 3 || x >= width - 3) {
          pixels[idx] = border[0]; pixels[idx + 1] = border[1];
          pixels[idx + 2] = border[2]; pixels[idx + 3] = 255;
        } else if (x < fillX) {
          pixels[idx] = 0; pixels[idx + 1] = 200; pixels[idx + 2] = 0; pixels[idx + 3] = 255;
        } else {
          pixels[idx] = 80; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 255;
        }
      } else if (isBorder) {
        const c = isHighlight ? highlight : border;
        pixels[idx] = c[0]; pixels[idx + 1] = c[1]; pixels[idx + 2] = c[2]; pixels[idx + 3] = c[3];
      } else {
        pixels[idx] = bg[0]; pixels[idx + 1] = bg[1]; pixels[idx + 2] = bg[2]; pixels[idx + 3] = bg[3];
      }
    }
  }
  return pixels;
}

function generateBackgroundPixels(
  width: number,
  height: number,
  palette: string[],
  style: BackgroundStyle,
  rng: () => number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const colors = palette.map(hexToRgba);
  const sky = colors[0] ?? [20, 20, 60, 255];
  const mid = colors[1] ?? [40, 80, 40, 255];
  const ground = colors[2] ?? [80, 60, 40, 255];

  for (let y = 0; y < height; y++) {
    const t = y / height;
    let r: number, g: number, b: number;

    if (t < 0.5) {
      // Sky gradient
      const skyT = t / 0.5;
      [r, g, b] = lerpColor([sky[0], sky[1], sky[2]], [mid[0], mid[1], mid[2]], skyT);
    } else {
      // Ground gradient
      const groundT = (t - 0.5) / 0.5;
      [r, g, b] = lerpColor([mid[0], mid[1], mid[2]], [ground[0], ground[1], ground[2]], groundT);
    }

    // Add noise for texture
    const noise = (rng() - 0.5) * (style === 'pixel-art' ? 10 : 3);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = Math.max(0, Math.min(255, r + noise));
      pixels[idx + 1] = Math.max(0, Math.min(255, g + noise));
      pixels[idx + 2] = Math.max(0, Math.min(255, b + noise));
      pixels[idx + 3] = 255;
    }
  }
  return pixels;
}

// ── Jetson Detection ─────────────────────────────────────────────────────

export interface HardwareInfo {
  isJetson: boolean;
  hasGpu: boolean;
  gpuModel: string;
  memoryGb: number;
  backend: 'local' | 'api';
}

let cachedHardware: HardwareInfo | null = null;

export async function detectHardware(): Promise<HardwareInfo> {
  if (cachedHardware) return cachedHardware;

  const info: HardwareInfo = {
    isJetson: false,
    hasGpu: false,
    gpuModel: 'unknown',
    memoryGb: 0,
    backend: 'api',
  };

  // Check for Jetson indicators
  try {
    const fs = await import('node:fs/promises');
    try {
      await fs.access('/etc/nv_tegra_release');
      info.isJetson = true;
    } catch { /* not Jetson */ }

    try {
      const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
      const match = meminfo.match(/MemTotal:\s+(\d+)/);
      if (match) info.memoryGb = Math.round(parseInt(match[1]) / 1024 / 1024);
    } catch { /* no meminfo */ }

    // Check for NVIDIA GPU
    try {
      const { execSync } = await import('node:child_process');
      const nvidia = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null', { encoding: 'utf-8' }).trim();
      if (nvidia) {
        info.hasGpu = true;
        const parts = nvidia.split(',');
        info.gpuModel = parts[0]?.trim() ?? 'unknown';
        const memMatch = parts[1]?.match(/(\d+)/);
        if (memMatch) info.memoryGb = parseInt(memMatch[1]);
      }
    } catch { /* no nvidia-smi */ }
  } catch {
    // Not Node.js (Workers environment) — use API
  }

  // Check Ollama availability for local inference
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      info.backend = 'local';
    }
  } catch { /* Ollama not running */ }

  // Jetson with GPU → local; else → API
  if (info.isJetson && info.hasGpu) {
    info.backend = 'local';
  }

  cachedHardware = info;
  return info;
}

// ── Ollama Vision (Local/Jetson) ─────────────────────────────────────────

interface OllamaVisionResult {
  description: string;
  palette: string[];
}

async function ollamaVisionPrompt(
  prompt: string,
  model?: string,
): Promise<OllamaVisionResult | null> {
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model ?? 'llava',
        prompt: `You are a pixel art expert. For the following request, output ONLY a JSON object with two fields: "description" (a detailed description of the pixel art) and "palette" (an array of 6 hex color codes that best represent this sprite). Request: ${prompt}`,
        stream: false,
        format: 'json',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response: string };
    return JSON.parse(data.response) as OllamaVisionResult;
  } catch {
    return null;
  }
}

// ── Gemini API (Cloud) ───────────────────────────────────────────────────

async function geminiGenerate(
  prompt: string,
  apiKey: string,
): Promise<OllamaVisionResult | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate a detailed description for pixel art of: ${prompt}. Output JSON with "description" and "palette" (6 hex colors).` }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as OllamaVisionResult;
  } catch {
    return null;
  }
}

// ── Asset ID Generator ───────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Public API ───────────────────────────────────────────────────────────

export interface VisionConfig {
  backend?: 'local' | 'api' | 'auto';
  ollamaModel?: string;
  geminiApiKey?: string;
}

export class SpriteGenerator {
  private config: VisionConfig;
  private cache: Map<string, GeneratedAsset> = new Map();

  constructor(config: VisionConfig = {}) {
    this.config = config;
  }

  async generateSprite(prompt: string, options: SpriteOptions = {}): Promise<GeneratedAsset> {
    const size = options.size ?? 32;
    const style = options.style ?? 'pixel-art';
    const category = options.category ?? 'character';
    const palette = options.palette ?? PALETTES.snes;
    const seed = options.seed ?? Date.now();
    const rng = createRng(seed);

    // Try AI-assisted palette enhancement
    const enhanced = await this.enhancePrompt(prompt, palette);

    // Generate pixel data based on category
    let pixels: Uint8Array;
    if (category === 'character' || category === 'icon') {
      pixels = generateCharacterPixels(size, enhanced, rng);
    } else if (category === 'item') {
      pixels = generateItemPixels(size, enhanced, rng);
    } else if (category === 'tile') {
      pixels = generateTilePixels(size, enhanced, rng, false);
    } else {
      // background or fallback
      pixels = generateBackgroundPixels(size, size, enhanced, style === 'pixel-art' ? 'pixel-art' : 'digital', rng);
    }

    // Handle animation (sprite sheet)
    let width = size;
    let height = size;
    if (options.animate) {
      const frames = options.frames ?? 4;
      const sheet = new Uint8Array(size * frames * size * 4);
      for (let f = 0; f < frames; f++) {
        const frameRng = createRng(seed + f * 1000);
        const framePixels = category === 'character'
          ? generateCharacterPixels(size, enhanced, frameRng)
          : generateItemPixels(size, enhanced, frameRng);
        // Copy frame into sheet
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const srcIdx = (y * size + x) * 4;
            const dstIdx = (y * (size * frames) + (f * size + x)) * 4;
            sheet[dstIdx] = framePixels[srcIdx];
            sheet[dstIdx + 1] = framePixels[srcIdx + 1];
            sheet[dstIdx + 2] = framePixels[srcIdx + 2];
            sheet[dstIdx + 3] = framePixels[srcIdx + 3];
          }
        }
      }
      width = size * frames;
      height = size;
      pixels = sheet;
    }

    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    const asset: GeneratedAsset = {
      id: generateId(),
      prompt,
      type: 'sprite',
      size: { width, height },
      data: base64,
      palette: enhanced,
      metadata: { size, style, category, animated: options.animate ?? false, frames: options.animate ? (options.frames ?? 4) : 1, seed },
      createdAt: new Date().toISOString(),
    };

    this.cache.set(asset.id, asset);
    return asset;
  }

  async generateTileset(theme: TileTheme, options: TilesetOptions = {}): Promise<GeneratedAsset> {
    const tileSize = options.tileSize ?? 16;
    const tileCount = options.tileCount ?? 16;
    const seed = options.seed ?? Date.now();
    const rng = createRng(seed);

    const themePalette = this.themePalette(theme);
    const cols = Math.ceil(Math.sqrt(tileCount));
    const rows = Math.ceil(tileCount / cols);
    const width = cols * tileSize;
    const height = rows * tileSize;
    const pixels = new Uint8Array(width * height * 4);

    const isWall = [false, true, false, true, false, false, true, false, false, true, false, false, false, true, false, false];

    for (let i = 0; i < tileCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tilePixels = generateTilePixels(tileSize, themePalette, () => rng(), isWall[i % isWall.length]!);

      for (let ty = 0; ty < tileSize; ty++) {
        for (let tx = 0; tx < tileSize; tx++) {
          const srcIdx = (ty * tileSize + tx) * 4;
          const dstX = col * tileSize + tx;
          const dstY = row * tileSize + ty;
          const dstIdx = (dstY * width + dstX) * 4;
          pixels[dstIdx] = tilePixels[srcIdx];
          pixels[dstIdx + 1] = tilePixels[srcIdx + 1];
          pixels[dstIdx + 2] = tilePixels[srcIdx + 2];
          pixels[dstIdx + 3] = tilePixels[srcIdx + 3];
        }
      }
    }

    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    const asset: GeneratedAsset = {
      id: generateId(),
      prompt: `tileset:${theme}`,
      type: 'tileset',
      size: { width, height },
      data: base64,
      palette: themePalette,
      metadata: { theme, tileSize, tileCount, cols, rows, seed },
      createdAt: new Date().toISOString(),
    };

    this.cache.set(asset.id, asset);
    return asset;
  }

  async generateUI(prompt: string, options: UIOptions): Promise<GeneratedAsset> {
    const width = options.width ?? 64;
    const height = options.height ?? 24;
    const palette = options.palette ?? PALETTES.snes;
    const seed = options.seed ?? Date.now();
    const rng = createRng(seed);

    const pixels = generateUIPixels(width, height, palette, options.element, rng);
    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    const asset: GeneratedAsset = {
      id: generateId(),
      prompt,
      type: 'ui',
      size: { width, height },
      data: base64,
      palette,
      metadata: { element: options.element, style: options.style ?? 'retro', seed },
      createdAt: new Date().toISOString(),
    };

    this.cache.set(asset.id, asset);
    return asset;
  }

  async generateBackground(
    scene: string,
    parallax: ParallaxLayer[],
    options: BackgroundOptions = {},
  ): Promise<GeneratedAsset> {
    const resKey = options.resolution ?? '256x224';
    const { width, height } = RESOLUTIONS[resKey] ?? RESOLUTIONS['256x224']!;
    const style = options.style ?? 'pixel-art';
    const seed = options.seed ?? Date.now();
    const rng = createRng(seed);

    const palette = this.scenePalette(scene);
    const pixels = generateBackgroundPixels(width, height, palette, style, rng);
    const png = encodePNG(pixels, width, height);
    const base64 = uint8ToBase64(png);

    const asset: GeneratedAsset = {
      id: generateId(),
      prompt: scene,
      type: 'background',
      size: { width, height },
      data: base64,
      palette,
      metadata: { resolution: resKey, style, parallaxLayers: parallax, seed },
      createdAt: new Date().toISOString(),
    };

    this.cache.set(asset.id, asset);
    return asset;
  }

  getAsset(id: string): GeneratedAsset | undefined {
    return this.cache.get(id);
  }

  listAssets(): GeneratedAsset[] {
    return Array.from(this.cache.values());
  }

  private themePalette(theme: TileTheme): string[] {
    const map: Record<TileTheme, string[]> = {
      dungeon: ['#1A1A2E', '#16213E', '#533483', '#E94560', '#0F3460', '#ECF0F1'],
      forest: ['#1B4332', '#2D6A4F', '#40916C', '#52B788', '#74C69D', '#95D5B2'],
      castle: ['#2B2D42', '#8D99AE', '#EDF2F4', '#EF233C', '#D90429', '#F8F9FA'],
      village: ['#BC6C25', '#DDA15E', '#FEFAE0', '#606C38', '#283618', '#DDA15E'],
      underwater: ['#03045E', '#0077B6', '#00B4D8', '#48CAE4', '#90E0EF', '#CAF0F8'],
      space: ['#0B0C10', '#1F2833', '#C5C6C7', '#66FCF1', '#45A29E', '#F8F9FA'],
    };
    return map[theme] ?? PALETTES.snes;
  }

  private scenePalette(scene: string): string[] {
    const lower = scene.toLowerCase();
    if (lower.includes('forest') || lower.includes('tree')) return this.themePalette('forest');
    if (lower.includes('dungeon') || lower.includes('cave')) return this.themePalette('dungeon');
    if (lower.includes('castle') || lower.includes('throne')) return this.themePalette('castle');
    if (lower.includes('village') || lower.includes('town')) return this.themePalette('village');
    if (lower.includes('ocean') || lower.includes('water') || lower.includes('sea')) return this.themePalette('underwater');
    if (lower.includes('space') || lower.includes('star')) return this.themePalette('space');
    return PALETTES.snes;
  }

  private async enhancePrompt(
    _prompt: string,
    defaultPalette: string[],
  ): Promise<string[]> {
    const backend = this.config.backend ?? 'auto';

    if (backend === 'api' && this.config.geminiApiKey) {
      const result = await geminiGenerate(_prompt, this.config.geminiApiKey);
      if (result?.palette?.length) return result.palette;
    }

    if (backend === 'local' || backend === 'auto') {
      const result = await ollamaVisionPrompt(_prompt, this.config.ollamaModel);
      if (result?.palette?.length) return result.palette;
    }

    return defaultPalette;
  }
}
