import type { HSLAdjustment } from './types';

// Convert RGB (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1)
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

// Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB (0-255)
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = ((t % 1) + 1) % 1;
    if (tt < 1/6) return p + (q - p) * 6 * tt;
    if (tt < 1/2) return q;
    if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(p, q, hn + 1/3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1/3) * 255),
  ];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Apply HSL color shift to an image and return an offscreen canvas.
 * Only modifies non-transparent pixels.
 */
export function applyHslShift(
  img: HTMLImageElement,
  hsl: HSLAdjustment
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  // If no shift is applied, return as-is
  if (hsl.hue === 0 && hsl.saturation === 0 && hsl.lightness === 0) {
    return canvas;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue; // skip transparent

    const r = data[i], g = data[i + 1], b = data[i + 2];
    let [h, s, l] = rgbToHsl(r, g, b);

    h = (h + hsl.hue + 360) % 360;
    s = clamp(s + hsl.saturation / 100, 0, 1);
    l = clamp(l + hsl.lightness / 100, 0, 1);

    const [nr, ng, nb] = hslToRgb(h, s, l);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
    // alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Cache manager: stores color-shifted canvases keyed by layer id + hsl values.
 * Call invalidate(id) when the image changes.
 */
export class ColorShiftCache {
  private cache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();

  getKey(hsl: HSLAdjustment): string {
    return `${hsl.hue}:${hsl.saturation}:${hsl.lightness}`;
  }

  get(
    layerId: string,
    img: HTMLImageElement,
    hsl: HSLAdjustment
  ): HTMLCanvasElement {
    const key = this.getKey(hsl);
    const cached = this.cache.get(layerId);
    if (cached && cached.key === key) return cached.canvas;
    const canvas = applyHslShift(img, hsl);
    this.cache.set(layerId, { key, canvas });
    return canvas;
  }

  invalidate(layerId: string) {
    this.cache.delete(layerId);
  }

  clear() {
    this.cache.clear();
  }
}
