/**
 * ClearFramesModal
 *
 * Lets the user pick which frame cells to erase from a layer's sprite sheet.
 * Selected cells are cleared to transparent in a copy of the layer's current
 * image, and the layer is updated in-place (UPDATE_LAYER — undoable).
 *
 * Props:
 *   layer   – the layer whose cells will be cleared
 *   config  – project config (frame size, directions, framesPerDirection, defaultInputLayout)
 *   onApply – called with (newImage, newObjectUrl); caller handles UPDATE_LAYER + cache invalidation
 *   onClose – cancel
 */

import { useRef, useEffect, useState } from 'react';
import type { Layer, ProjectConfig } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { frameRect, flatIndex } from '../types';

interface ClearFramesModalProps {
  layer: Layer;
  config: ProjectConfig;
  onApply: (newImage: HTMLImageElement, newObjectUrl: string) => void;
  onClose: () => void;
}

export function ClearFramesModal({ layer, config, onApply, onClose }: ClearFramesModalProps) {
  const { directions, framesPerDirection, frameWidth, frameHeight } = config;
  const dirLabels = directions === 4 ? DIRECTIONS_4 : DIRECTIONS_8;

  // Selected cells: Set of "dirRow_frameIdx" strings
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Preview canvas — shows current layer image
  const previewRef = useRef<HTMLCanvasElement>(null);

  const CELL_SIZE = Math.max(20, Math.min(40, Math.floor(300 / framesPerDirection)));

  // Draw layer image into the preview canvas on open
  useEffect(() => {
    const cv = previewRef.current;
    if (!cv || !layer.image) return;
    cv.width = layer.image.naturalWidth;
    cv.height = layer.image.naturalHeight;
    cv.getContext('2d')!.drawImage(layer.image, 0, 0);
  }, [layer.image]);

  function key(dir: number, frame: number) { return `${dir}_${frame}`; }

  function toggle(dir: number, frame: number) {
    const k = key(dir, frame);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) { next.delete(k); } else { next.add(k); }
      return next;
    });
  }

  function selectAll() {
    const all = new Set<string>();
    for (let d = 0; d < directions; d++)
      for (let f = 0; f < framesPerDirection; f++)
        all.add(key(d, f));
    setSelected(all);
  }

  function selectNone() { setSelected(new Set()); }

  function selectRow(dir: number) {
    setSelected(prev => {
      const next = new Set(prev);
      for (let f = 0; f < framesPerDirection; f++) next.add(key(dir, f));
      return next;
    });
  }

  function selectCol(frame: number) {
    setSelected(prev => {
      const next = new Set(prev);
      for (let d = 0; d < directions; d++) next.add(key(d, frame));
      return next;
    });
  }

  function handleApply() {
    if (selected.size === 0 || busy || !layer.image) return;
    setBusy(true);

    // Copy the current layer image onto a canvas
    const cv = document.createElement('canvas');
    cv.width = layer.image.naturalWidth;
    cv.height = layer.image.naturalHeight;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(layer.image, 0, 0);

    // Erase each selected cell using the layer's inputLayout
    for (const k of selected) {
      const [d, f] = k.split('_').map(Number);
      const n = flatIndex(d, f, framesPerDirection);
      const { sx, sy } = frameRect(n, layer.inputLayout, frameWidth, frameHeight);
      ctx.clearRect(sx, sy, frameWidth, frameHeight);
    }

    cv.toBlob(blob => {
      if (!blob) { setBusy(false); return; }
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { onApply(img, objectUrl); };
      img.src = objectUrl;
    }, 'image/png');
  }

  // Scale preview to fit nicely in the modal
  const previewScale = layer.image
    ? Math.min(4, Math.floor(120 / Math.max(layer.image.naturalWidth, layer.image.naturalHeight)))
    : 1;
  const previewW = (layer.image?.naturalWidth  ?? 0) * Math.max(1, previewScale);
  const previewH = (layer.image?.naturalHeight ?? 0) * Math.max(1, previewScale);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-5"
        style={{ maxWidth: 560, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">Clear Frame Cells</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Layer preview + info */}
        <div className="flex items-center gap-4">
          <div
            className="rounded border border-gray-700 flex items-center justify-center flex-shrink-0"
            style={{
              background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
              width: previewW + 8, height: previewH + 8,
            }}
          >
            <canvas ref={previewRef} style={{ imageRendering: 'pixelated', width: previewW, height: previewH }} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-xs font-medium text-gray-200">{layer.name}</span>
            <span className="text-xs text-gray-500">
              {layer.inputLayout.cols}×{layer.inputLayout.rows} input layout ·{' '}
              {layer.image?.naturalWidth ?? 0}×{layer.image?.naturalHeight ?? 0}px
            </span>
            <span className="text-xs text-gray-600">
              Selected cells will be erased to transparent.
            </span>
          </div>
        </div>

        {/* Frame grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              Select cells to clear <span className="text-gray-600">({selected.size} selected)</span>
            </span>
            <div className="flex gap-1">
              <button onClick={selectAll} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded">All</button>
              <button onClick={selectNone} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded">None</button>
            </div>
          </div>

          {/* Column header — frame numbers */}
          <div className="flex gap-px mb-px ml-14">
            {Array.from({ length: framesPerDirection }, (_, f) => (
              <button
                key={f}
                onClick={() => selectCol(f)}
                className="text-gray-600 hover:text-gray-300 text-center flex-shrink-0"
                style={{ width: CELL_SIZE, fontSize: 9 }}
                title={`Select column — frame ${f + 1}`}
              >
                {f + 1}
              </button>
            ))}
          </div>

          {/* Rows */}
          <div className="flex flex-col gap-px">
            {Array.from({ length: directions }, (_, d) => (
              <div key={d} className="flex items-center gap-px">
                {/* Direction label — click to select whole row */}
                <button
                  onClick={() => selectRow(d)}
                  className="text-gray-500 hover:text-gray-300 text-right flex-shrink-0 pr-1 capitalize"
                  style={{ width: 52, fontSize: 9 }}
                  title={`Select row — direction ${dirLabels[d]}`}
                >
                  {dirLabels[d]}
                </button>

                {Array.from({ length: framesPerDirection }, (_, f) => {
                  const isOn = selected.has(key(d, f));
                  return (
                    <button
                      key={f}
                      onClick={() => toggle(d, f)}
                      className={`flex-shrink-0 rounded-sm transition-colors ${
                        isOn
                          ? 'bg-red-600 hover:bg-red-500'
                          : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                      style={{ width: CELL_SIZE, height: CELL_SIZE }}
                      title={`${dirLabels[d]} / frame ${f + 1}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={selected.size === 0 || busy}
            className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium"
          >
            {busy ? 'Clearing…' : `Clear ${selected.size} cell${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
