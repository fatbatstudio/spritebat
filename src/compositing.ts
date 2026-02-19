import type { Layer, ProjectConfig } from './types';
import { frameRect, flatIndex } from './types';
import { ColorShiftCache } from './colorShift';

/**
 * Composite all visible layers for a given (directionRow, frameIndex) onto canvas.
 * Each layer's source pixel location is determined by its own inputLayout.
 */
export function compositeFrame(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  config: ProjectConfig,
  directionRow: number,
  frameIndex: number,
  cache: ColorShiftCache,
  clearFirst = true
) {
  const ctx = canvas.getContext('2d')!;
  if (clearFirst) ctx.clearRect(0, 0, canvas.width, canvas.height);

  const n = flatIndex(directionRow, frameIndex, config.framesPerDirection);
  const { frameWidth, frameHeight } = config;

  for (const layer of layers) {
    if (!layer.visible || !layer.image) continue;
    const { sx, sy } = frameRect(n, layer.inputLayout, frameWidth, frameHeight);
    const shiftedCanvas = cache.get(layer.id, layer.image, layer.hsl);
    const fof = layer.frameOffsets?.[frameIndex];
    const dx = layer.offsetX + (fof?.x ?? 0);
    const dy = layer.offsetY + (fof?.y ?? 0);
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(
      shiftedCanvas,
      sx, sy, frameWidth, frameHeight,
      dx, dy, canvas.width, canvas.height
    );
  }
  ctx.globalAlpha = 1;
}

/**
 * Render the full composite sheet using the exportLayout from config.
 * Frames are placed at positions determined by exportLayout.
 */
export function renderFullSheet(
  layers: Layer[],
  config: ProjectConfig,
  cache: ColorShiftCache
): HTMLCanvasElement {
  const { frameWidth, frameHeight, framesPerDirection, directions, exportLayout } = config;
  const totalFrameCount = directions * framesPerDirection;

  const canvas = document.createElement('canvas');
  canvas.width = frameWidth * exportLayout.cols;
  canvas.height = frameHeight * exportLayout.rows;
  const ctx = canvas.getContext('2d')!;

  for (let dirRow = 0; dirRow < directions; dirRow++) {
    for (let f = 0; f < framesPerDirection; f++) {
      const n = flatIndex(dirRow, f, framesPerDirection);
      if (n >= totalFrameCount) continue;

      // Destination position in the export sheet
      const destCol = n % exportLayout.cols;
      const destRow = Math.floor(n / exportLayout.cols);
      const dx = destCol * frameWidth;
      const dy = destRow * frameHeight;

      for (const layer of layers) {
        if (!layer.visible || !layer.image) continue;
        const { sx, sy } = frameRect(n, layer.inputLayout, frameWidth, frameHeight);
        const shiftedCanvas = cache.get(layer.id, layer.image, layer.hsl);
        const fof = layer.frameOffsets?.[f];
        ctx.globalAlpha = layer.opacity / 100;
        ctx.drawImage(
          shiftedCanvas,
          sx, sy, frameWidth, frameHeight,
          dx + layer.offsetX + (fof?.x ?? 0), dy + layer.offsetY + (fof?.y ?? 0), frameWidth, frameHeight
        );
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * Render all frames as individual canvases, in logical order
 * (dirRow 0 frame 0, dirRow 0 frame 1, ... dirRow N frame M).
 */
export function renderAllFrames(
  layers: Layer[],
  config: ProjectConfig,
  cache: ColorShiftCache
): HTMLCanvasElement[] {
  const { frameWidth, frameHeight, framesPerDirection, directions } = config;
  const frames: HTMLCanvasElement[] = [];

  for (let dirRow = 0; dirRow < directions; dirRow++) {
    for (let f = 0; f < framesPerDirection; f++) {
      const c = document.createElement('canvas');
      c.width = frameWidth;
      c.height = frameHeight;
      compositeFrame(c, layers, config, dirRow, f, cache);
      frames.push(c);
    }
  }
  return frames;
}

/**
 * Tile a single-frame source image into a full sprite sheet.
 *
 * `sourceCanvas`  — the single frame to stamp (e.g. a hat extracted from the splitter)
 * `config`        — project config (frame size, directions, framesPerDirection, exportLayout)
 * `dirMask`       — which direction rows to fill; use null to fill all directions
 * `frameMask`     — which frame indices to fill; use null to fill all frames
 *
 * Returns a new canvas sized to config.defaultInputLayout, with the source
 * stamped at every selected (dir, frame) cell and transparent elsewhere.
 */
export function tileToSheet(
  sourceCanvas: HTMLCanvasElement,
  config: ProjectConfig,
  dirMask: number[] | null,
  frameMask: number[] | null,
  offsetX = 0,
  offsetY = 0,
  frameOffsets?: Array<{ x: number; y: number }>
): HTMLCanvasElement {
  const { frameWidth, frameHeight, framesPerDirection, directions, defaultInputLayout } = config;
  const layout = defaultInputLayout;

  const out = document.createElement('canvas');
  out.width  = layout.cols * frameWidth;
  out.height = layout.rows * frameHeight;
  const ctx = out.getContext('2d')!;

  for (let dirRow = 0; dirRow < directions; dirRow++) {
    if (dirMask && !dirMask.includes(dirRow)) continue;
    for (let f = 0; f < framesPerDirection; f++) {
      if (frameMask && !frameMask.includes(f)) continue;
      const n = flatIndex(dirRow, f, framesPerDirection);
      const { sx, sy } = frameRect(n, layout, frameWidth, frameHeight);
      // Draw source at natural size, with the layer's current offset + per-frame offset baked in.
      // This means after tiling the layer offset can safely be reset to 0.
      const fof = frameOffsets?.[f];
      const dx = sx + offsetX + (fof?.x ?? 0);
      const dy = sy + offsetY + (fof?.y ?? 0);
      ctx.drawImage(sourceCanvas, dx, dy);
    }
  }

  return out;
}

/**
 * Trim transparent pixels from a canvas, returning a tight bounding box.
 */
export function trimTransparent(
  canvas: HTMLCanvasElement
): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 0) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
