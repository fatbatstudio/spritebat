declare module 'gifenc' {
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  type Palette = RGB[] | RGBA[];

  interface GIFEncoderOpts {
    auto?: boolean;
    initialCapacity?: number;
  }

  interface WriteFrameOpts {
    palette?: Palette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    colorDepth?: number;
    first?: boolean;
  }

  interface Encoder {
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(opts?: GIFEncoderOpts): Encoder;

  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444';
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaColor?: number;
      clearAlphaThreshold?: number;
    }
  ): Palette;

  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array;

  export function prequantize(
    data: Uint8Array | Uint8ClampedArray,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number }
  ): void;

  export function snapColorsToPalette(
    palette: Palette,
    knownColors: Palette,
    threshold?: number
  ): void;

  export default GIFEncoder;
}
