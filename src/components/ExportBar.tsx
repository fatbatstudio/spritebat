import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { AppState } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { ColorShiftCache } from '../colorShift';
import { renderFullSheet, renderAllFrames, compositeFrame } from '../compositing';
import { getDirectionRow } from '../state';

interface ExportBarProps {
  state: AppState;
  cache: ColorShiftCache;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Scale a canvas by an integer multiplier using nearest-neighbour (no interpolation).
 * Returns a new canvas — the original is untouched.
 */
function scaleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return src;
  const out = document.createElement('canvas');
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

const SCALE_OPTIONS = [1, 2, 3, 4] as const;
type ExportScale = typeof SCALE_OPTIONS[number];

export function ExportBar({ state, cache }: ExportBarProps) {
  const { layers, config, previewDirection, previewFrame, selectedLayerId } = state;
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportScale, setExportScale] = useState<ExportScale>(1);

  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;
  const selectedLayerReady = !!(selectedLayer?.visible && selectedLayer?.image);

  async function exportFullSheet() {
    setExporting('sheet');
    try {
      const canvas = scaleCanvas(renderFullSheet(layers, config, cache), exportScale);
      const blob = await canvasToBlob(canvas);
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      downloadBlob(blob, `sprite-sheet${suffix}.png`);
    } finally {
      setExporting(null);
    }
  }

  async function exportCurrentFrame() {
    setExporting('frame');
    try {
      const dirRow = getDirectionRow(previewDirection, config.directions);
      const canvas = document.createElement('canvas');
      canvas.width = config.frameWidth;
      canvas.height = config.frameHeight;
      compositeFrame(canvas, layers, config, dirRow, previewFrame, cache);
      const scaled = scaleCanvas(canvas, exportScale);
      const blob = await canvasToBlob(scaled);
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      downloadBlob(blob, `frame-${previewDirection}-${previewFrame + 1}${suffix}.png`);
    } finally {
      setExporting(null);
    }
  }

  async function exportAllFrames() {
    setExporting('frames');
    try {
      const frames = renderAllFrames(layers, config, cache);
      const zip = new JSZip();
      const folder = zip.folder('frames')!;
      const dirs = config.directions === 4 ? [...DIRECTIONS_4] : [...DIRECTIONS_8];

      let idx = 0;
      for (let row = 0; row < config.directions; row++) {
        for (let col = 0; col < config.framesPerDirection; col++) {
          const scaled = scaleCanvas(frames[idx], exportScale);
          const blob = await canvasToBlob(scaled);
          const dirName = dirs[row];
          const frameName = `${String(col + 1).padStart(3, '0')}`;
          folder.file(`${dirName}/${frameName}.png`, blob);
          idx++;
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      saveAs(zipBlob, `frames${suffix}.zip`);
    } finally {
      setExporting(null);
    }
  }

  async function exportCurrentDirection() {
    setExporting('dir');
    try {
      const dirRow = getDirectionRow(previewDirection, config.directions);
      const zip = new JSZip();

      for (let col = 0; col < config.framesPerDirection; col++) {
        const canvas = document.createElement('canvas');
        canvas.width = config.frameWidth;
        canvas.height = config.frameHeight;
        compositeFrame(canvas, layers, config, dirRow, col, cache);
        const scaled = scaleCanvas(canvas, exportScale);
        const blob = await canvasToBlob(scaled);
        zip.file(`${previewDirection}-${String(col + 1).padStart(3, '0')}.png`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      saveAs(zipBlob, `frames-${previewDirection}${suffix}.zip`);
    } finally {
      setExporting(null);
    }
  }

  async function exportLayerSheet() {
    if (!selectedLayer) return;
    setExporting('layerSheet');
    try {
      // Render only this one layer as if it were the only visible layer
      const canvas = scaleCanvas(renderFullSheet([selectedLayer], config, cache), exportScale);
      const blob = await canvasToBlob(canvas);
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      const name = selectedLayer.fileName.replace(/\.[^.]+$/, '') || selectedLayer.name;
      downloadBlob(blob, `${name}-sheet${suffix}.png`);
    } finally {
      setExporting(null);
    }
  }

  async function exportLayerFrame() {
    if (!selectedLayer) return;
    setExporting('layerFrame');
    try {
      const dirRow = getDirectionRow(previewDirection, config.directions);
      const canvas = document.createElement('canvas');
      canvas.width = config.frameWidth;
      canvas.height = config.frameHeight;
      compositeFrame(canvas, [selectedLayer], config, dirRow, previewFrame, cache);
      const scaled = scaleCanvas(canvas, exportScale);
      const blob = await canvasToBlob(scaled);
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      const name = selectedLayer.fileName.replace(/\.[^.]+$/, '') || selectedLayer.name;
      downloadBlob(blob, `${name}-${previewDirection}-${previewFrame + 1}${suffix}.png`);
    } finally {
      setExporting(null);
    }
  }

  /**
   * Apply the current playback mode to the frame order.
   * 'forward'  — unchanged
   * 'reverse'  — reversed
   * 'pingpong' — forward then reversed (minus duplicate endpoints)
   */
  function applyPlaybackMode(frames: HTMLCanvasElement[]): HTMLCanvasElement[] {
    const mode = state.previewMode;
    if (mode === 'reverse') return [...frames].reverse();
    if (mode === 'pingpong') {
      if (frames.length <= 2) return frames;
      const back = [...frames].reverse().slice(1, -1);   // drop first & last (already in forward pass)
      return [...frames, ...back];
    }
    return frames;
  }

  /** Encode an array of frame canvases into an animated GIF blob with transparency. */
  function encodeGif(frames: HTMLCanvasElement[], delayMs: number): Blob {
    const w = frames[0].width, h = frames[0].height;
    const gif = GIFEncoder();

    for (let i = 0; i < frames.length; i++) {
      const ctx = frames[i].getContext('2d')!;
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const palette = quantize(rgba, 256, { format: 'rgba4444', clearAlpha: true, clearAlphaThreshold: 128 });
      const index = applyPalette(rgba, palette, 'rgba4444');

      // Find the palette entry with alpha=0 for GIF transparency
      let transparentIndex = 0;
      let hasTransparent = false;
      for (let p = 0; p < palette.length; p++) {
        if (palette[p].length >= 4 && (palette[p] as [number, number, number, number])[3] === 0) {
          transparentIndex = p;
          hasTransparent = true;
          break;
        }
      }

      gif.writeFrame(index, w, h, {
        palette,
        delay: delayMs,
        repeat: 0,                          // loop forever
        dispose: 2,                         // restore to background (needed for transparency between frames)
        transparent: hasTransparent,
        transparentIndex,
      });
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  async function exportGifDirection() {
    setExporting('gifDir');
    try {
      const dirRow = getDirectionRow(previewDirection, config.directions);
      const delayMs = Math.round(1000 / state.previewFps);
      const rawFrames: HTMLCanvasElement[] = [];

      for (let f = 0; f < config.framesPerDirection; f++) {
        const cv = document.createElement('canvas');
        cv.width = config.frameWidth;
        cv.height = config.frameHeight;
        compositeFrame(cv, layers, config, dirRow, f, cache);
        rawFrames.push(scaleCanvas(cv, exportScale));
      }

      const frames = applyPlaybackMode(rawFrames);
      const blob = encodeGif(frames, delayMs);
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      const modeTag = state.previewMode !== 'forward' ? `-${state.previewMode}` : '';
      downloadBlob(blob, `${previewDirection}${modeTag}${suffix}.gif`);
    } finally {
      setExporting(null);
    }
  }

  async function exportGifAllDirections() {
    setExporting('gifAll');
    try {
      const dirs = config.directions === 4 ? [...DIRECTIONS_4] : [...DIRECTIONS_8];
      const delayMs = Math.round(1000 / state.previewFps);
      const zip = new JSZip();

      for (let d = 0; d < config.directions; d++) {
        const rawFrames: HTMLCanvasElement[] = [];
        for (let f = 0; f < config.framesPerDirection; f++) {
          const cv = document.createElement('canvas');
          cv.width = config.frameWidth;
          cv.height = config.frameHeight;
          compositeFrame(cv, layers, config, d, f, cache);
          rawFrames.push(scaleCanvas(cv, exportScale));
        }
        const frames = applyPlaybackMode(rawFrames);
        const blob = encodeGif(frames, delayMs);
        zip.file(`${dirs[d]}.gif`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const suffix = exportScale > 1 ? `@${exportScale}x` : '';
      saveAs(zipBlob, `gifs${suffix}.zip`);
    } finally {
      setExporting(null);
    }
  }

  const hasLayers = layers.some(l => l.visible && l.image);

  return (
    <div className="flex items-center gap-x-2 gap-y-1 px-4 py-2 bg-gray-900 border-t border-gray-700 flex-shrink-0 flex-wrap">
      <span className="text-xs text-gray-500 uppercase tracking-wider mr-1">Export:</span>

      {/* Scale selector */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">Scale:</span>
        {SCALE_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setExportScale(s)}
            className={`text-xs px-1.5 py-1 rounded transition-colors ${
              exportScale === s
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-gray-700" />

      <button
        onClick={exportFullSheet}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export full sprite sheet as PNG"
      >
        {exporting === 'sheet' ? '⏳' : '📄'} Sheet
      </button>

      <button
        onClick={exportCurrentDirection}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title={`Export all frames for current direction (${previewDirection}) as ZIP`}
      >
        {exporting === 'dir' ? '⏳' : '🎞'} Dir ZIP
      </button>

      <button
        onClick={exportAllFrames}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export all frames as individual PNGs in a ZIP"
      >
        {exporting === 'frames' ? '⏳' : '📦'} All ZIP
      </button>

      <button
        onClick={exportCurrentFrame}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export just the current frame as PNG"
      >
        {exporting === 'frame' ? '⏳' : '🖼'} Frame
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* Single-layer export */}
      <button
        onClick={exportLayerSheet}
        disabled={!selectedLayerReady || !!exporting}
        className="text-xs bg-teal-700 hover:bg-teal-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title={selectedLayer ? `Export "${selectedLayer.name}" full sheet as PNG` : 'Select a layer to export'}
      >
        {exporting === 'layerSheet' ? '⏳' : '📄'} Layer Sheet
      </button>

      <button
        onClick={exportLayerFrame}
        disabled={!selectedLayerReady || !!exporting}
        className="text-xs bg-teal-700 hover:bg-teal-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title={selectedLayer ? `Export current frame of "${selectedLayer.name}" as PNG` : 'Select a layer to export'}
      >
        {exporting === 'layerFrame' ? '⏳' : '🖼'} Layer Frame
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* GIF export */}
      <button
        onClick={exportGifDirection}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title={`Export ${previewDirection} animation as GIF at ${state.previewFps} FPS`}
      >
        {exporting === 'gifDir' ? '⏳' : '🎞'} Dir GIF
      </button>

      <button
        onClick={exportGifAllDirections}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1.5 rounded transition-colors flex items-center gap-1"
        title={`Export all ${config.directions} directions as separate GIFs in a ZIP at ${state.previewFps} FPS`}
      >
        {exporting === 'gifAll' ? '⏳' : '📦'} All GIFs
      </button>

      {!hasLayers && (
        <span className="text-xs text-gray-600 ml-2">Add visible layers with images to enable export</span>
      )}
    </div>
  );
}
