import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
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

  const hasLayers = layers.some(l => l.visible && l.image);

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-t border-gray-700 flex-shrink-0">
      <span className="text-xs text-gray-500 uppercase tracking-wider mr-1">Export:</span>

      {/* Scale selector */}
      <div className="flex items-center gap-1 mr-2">
        <span className="text-xs text-gray-500">Scale:</span>
        {SCALE_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setExportScale(s)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
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
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export full sprite sheet as PNG"
      >
        {exporting === 'sheet' ? '⏳' : '📄'} Full Sheet
      </button>

      <button
        onClick={exportCurrentDirection}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title={`Export all frames for current direction (${previewDirection}) as ZIP`}
      >
        {exporting === 'dir' ? '⏳' : '🎞'} Direction ZIP
      </button>

      <button
        onClick={exportAllFrames}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export all frames as individual PNGs in a ZIP"
      >
        {exporting === 'frames' ? '⏳' : '📦'} All Frames ZIP
      </button>

      <button
        onClick={exportCurrentFrame}
        disabled={!hasLayers || !!exporting}
        className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title="Export just the current frame as PNG"
      >
        {exporting === 'frame' ? '⏳' : '🖼'} Current Frame
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* Single-layer export — only relevant when a layer is selected */}
      <span className="text-xs text-gray-500">Layer:</span>

      <button
        onClick={exportLayerSheet}
        disabled={!selectedLayerReady || !!exporting}
        className="text-xs bg-teal-700 hover:bg-teal-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title={selectedLayer ? `Export "${selectedLayer.name}" full sheet as PNG` : 'Select a layer to export'}
      >
        {exporting === 'layerSheet' ? '⏳' : '📄'} Layer Sheet
      </button>

      <button
        onClick={exportLayerFrame}
        disabled={!selectedLayerReady || !!exporting}
        className="text-xs bg-teal-700 hover:bg-teal-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        title={selectedLayer ? `Export current frame of "${selectedLayer.name}" as PNG` : 'Select a layer to export'}
      >
        {exporting === 'layerFrame' ? '⏳' : '🖼'} Layer Frame
      </button>

      {!hasLayers && (
        <span className="text-xs text-gray-600 ml-2">Add visible layers with images to enable export</span>
      )}
    </div>
  );
}
