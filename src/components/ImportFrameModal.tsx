/**
 * ImportFrameModal
 *
 * Shown when the user imports a single-frame asset (from the Library or Asset
 * Splitter) into the Composer.  The user picks which frame slot(s) to place the
 * asset in, then we call tileToSheet() to build a sparse sprite-sheet PNG with
 * the asset stamped only into the chosen cells.
 *
 * Props:
 *   assetCanvas  – the source image as an HTMLCanvasElement (single frame)
 *   assetName    – default layer name
 *   config       – project config (frame size, directions, framesPerDirection)
 *   onImport(layer) – called with the finished Layer; caller dispatches ADD_LAYER
 *   onClose      – called when the modal is dismissed without importing
 */

import React, { useRef, useEffect, useState } from 'react';
import type { Layer, LayerType, ProjectConfig } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { tileToSheet } from '../compositing';

interface ImportFrameModalProps {
  assetCanvas: HTMLCanvasElement;
  assetName: string;
  config: ProjectConfig;
  onImport: (layer: Layer) => void;
  onClose: () => void;
}

export function ImportFrameModal({ assetCanvas, assetName, config, onImport, onClose }: ImportFrameModalProps) {
  const { directions, framesPerDirection, frameWidth, frameHeight, defaultInputLayout } = config;
  const dirLabels = directions === 4 ? DIRECTIONS_4 : DIRECTIONS_8;

  // Selected cells: Set of "dirRow_frameIdx" strings
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Default: only frame 0 of direction 0
    return new Set(['0_0']);
  });
  const [name, setName] = useState(assetName);
  const [busy, setBusy] = useState(false);

  // Preview canvas — re-renders when selection changes
  const previewRef = useRef<HTMLCanvasElement>(null);

  const CELL_SIZE = Math.max(20, Math.min(40, Math.floor(300 / framesPerDirection)));

  useEffect(() => {
    const cv = previewRef.current;
    if (!cv) return;
    cv.width = assetCanvas.width;
    cv.height = assetCanvas.height;
    cv.getContext('2d')!.drawImage(assetCanvas, 0, 0);
  }, [assetCanvas]);

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

  function handleImport() {
    if (selected.size === 0 || busy) return;
    setBusy(true);

    // Build per-cell list — selection may be sparse (e.g. dir0-frame1 but not dir1-frame1)
    const dirSet = new Set<number>();
    const frameSet = new Set<number>();
    const cells: Array<{ dir: number; frame: number }> = [];
    for (const k of selected) {
      const [d, f] = k.split('_').map(Number);
      cells.push({ dir: d, frame: f });
      dirSet.add(d);
      frameSet.add(f);
    }

    // tileToSheet stamps all (dir, frame) combinations of dirMask × frameMask
    // For a non-rectangular selection we need to call it per-cell and composite.
    // We check if the selection IS rectangular first for the fast path.
    const isRectangular = cells.length === dirSet.size * frameSet.size;

    let sheet: HTMLCanvasElement;
    if (isRectangular) {
      sheet = tileToSheet(
        assetCanvas, config,
        Array.from(dirSet).sort((a, b) => a - b),
        Array.from(frameSet).sort((a, b) => a - b)
      );
    } else {
      // Composite one cell at a time
      const { cols, rows } = defaultInputLayout;
      sheet = document.createElement('canvas');
      sheet.width = cols * frameWidth;
      sheet.height = rows * frameHeight;
      const ctx = sheet.getContext('2d')!;
      for (const { dir, frame } of cells) {
        const single = tileToSheet(assetCanvas, config, [dir], [frame]);
        ctx.drawImage(single, 0, 0);
      }
    }

    sheet.toBlob(blob => {
      if (!blob) { setBusy(false); return; }
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const layer: Layer = {
          id: crypto.randomUUID(),
          name,
          type: 'Custom' as LayerType,
          visible: true,
          opacity: 100,
          hsl: { hue: 0, saturation: 0, lightness: 0 },
          image: img,
          objectUrl,
          fileName: name + '.png',
          offsetX: 0,
          offsetY: 0,
          inputLayout: { ...defaultInputLayout },
        };
        onImport(layer);
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  const previewScale = Math.min(4, Math.floor(120 / Math.max(assetCanvas.width, assetCanvas.height)));
  const previewW = assetCanvas.width * Math.max(1, previewScale);
  const previewH = assetCanvas.height * Math.max(1, previewScale);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-5" style={{ maxWidth: 560, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">Import into Frame</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Asset preview + name */}
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
            <label className="text-xs text-gray-400">Layer name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-full"
              autoFocus
            />
            <span className="text-xs text-gray-600">{assetCanvas.width}×{assetCanvas.height}px</span>
          </div>
        </div>

        {/* Frame grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Select target frames <span className="text-gray-600">({selected.size} selected)</span></span>
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
                title={`Select all of frame ${f + 1}`}
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
                  title={`Select all of direction ${dirLabels[d]}`}
                >
                  {dirLabels[d]}
                </button>

                {Array.from({ length: framesPerDirection }, (_, f) => {
                  const isOn = selected.has(key(d, f));
                  return (
                    <button
                      key={f}
                      onClick={() => toggle(d, f)}
                      className={`flex-shrink-0 rounded-sm transition-colors ${isOn ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-gray-700 hover:bg-gray-600'}`}
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
          <button onClick={onClose} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={selected.size === 0 || busy}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium"
          >
            {busy ? 'Importing…' : `Import into ${selected.size} frame${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
