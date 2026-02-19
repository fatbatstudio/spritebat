import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { AppState, AppAction, Layer, LayerType } from '../types';
import { trimTransparent } from '../compositing';

interface AssetSplitterProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

type Tool = 'select' | 'move';

// Zoom steps available in the toolbar
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8];

function zoomLabel(z: number) {
  return z < 1 ? `${Math.round(z * 100)}%` : `${z}x`;
}

export function AssetSplitter({ state, dispatch }: AssetSplitterProps) {
  const { splitter } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  // zoom is the display multiplier relative to the image's natural size
  const [zoom, setZoom] = useState(1);
  // fitScale is computed when image loads so we know the "fit" baseline
  const fitScaleRef = useRef(1);
  const [extractName, setExtractName] = useState('extracted');

  // Total canvas scale = zoom (zoom is already in image-pixel terms)
  // canvas dimensions = naturalW * zoom, naturalH * zoom
  // mouse → image coords: divide canvas pos by zoom

  // Draw the image + selection overlay onto the canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splitter.image) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Checkerboard (fixed 8px tiles regardless of zoom)
    const size = 8;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = (x / size + y / size) % 2 === 0 ? '#1a1a2e' : '#16213e';
        ctx.fillRect(x, y, size, size);
      }
    }

    // Draw image scaled to fill canvas
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(splitter.image, 0, 0, w, h);

    // Draw selection rect (coords are in image-pixel space, scale to canvas)
    if (splitter.selection) {
      const { x, y, w: sw, h: sh } = splitter.selection;
      const cx = x * zoom, cy = y * zoom, cw = sw * zoom, ch = sh * zoom;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(99,102,241,0.1)';
      ctx.fillRect(cx, cy, cw, ch);

      // Corner handles — fixed 6px regardless of zoom
      const hs = 6;
      ctx.fillStyle = '#6366f1';
      [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      });

      // Size label
      ctx.fillStyle = 'rgba(99,102,241,0.85)';
      ctx.fillRect(cx, cy - 17, 72, 15);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(`${sw}×${sh}px`, cx + 3, cy - 15);
    }
  }, [splitter.image, splitter.selection, zoom]);

  useEffect(() => { redraw(); }, [redraw]);

  // Resize canvas when image or zoom changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splitter.image) return;
    canvas.width = Math.round(splitter.image.naturalWidth * zoom);
    canvas.height = Math.round(splitter.image.naturalHeight * zoom);
    redraw();
  }, [splitter.image, zoom]);

  // When a new image is loaded, compute fit-scale and set initial zoom
  useEffect(() => {
    if (!splitter.image) return;
    const container = containerRef.current;
    const availW = container ? container.clientWidth - 32 : 680;
    const availH = container ? container.clientHeight - 32 : 480;
    const imgW = splitter.image.naturalWidth;
    const imgH = splitter.image.naturalHeight;
    const fit = Math.min(1, availW / imgW, availH / imgH);
    fitScaleRef.current = fit;
    // Find the nearest zoom step at or below fit
    const nearest = [...ZOOM_STEPS].reverse().find(z => z <= fit) ?? ZOOM_STEPS[0];
    setZoom(nearest);
  }, [splitter.image]);

  // Convert mouse event → image-pixel coords
  function getImagePos(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // canvas CSS size == canvas pixel size (we set width/height directly),
    // so no extra scaling needed — just divide by zoom
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: Math.round(cx / zoom),
      y: Math.round(cy / zoom),
    };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!splitter.image) return;
    const pos = getImagePos(e);
    setStartPos(pos);
    setIsDrawing(true);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!isDrawing || !splitter.image) return;
    const pos = getImagePos(e);
    const imgW = splitter.image.naturalWidth;
    const imgH = splitter.image.naturalHeight;
    const x = Math.max(0, Math.min(startPos.x, pos.x));
    const y = Math.max(0, Math.min(startPos.y, pos.y));
    const w = Math.min(Math.abs(pos.x - startPos.x), imgW - x);
    const h = Math.min(Math.abs(pos.y - startPos.y), imgH - y);
    dispatch({
      type: 'SET_SPLITTER',
      updates: { selection: { x, y, w, h } },
    });
  }

  function onMouseUp() {
    setIsDrawing(false);
  }

  // Zoom with scroll wheel when over canvas
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const idx = ZOOM_STEPS.indexOf(zoom);
    if (e.deltaY < 0 && idx < ZOOM_STEPS.length - 1) setZoom(ZOOM_STEPS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) setZoom(ZOOM_STEPS[idx - 1]);
  }

  function handleExtract() {
    if (!splitter.image || !splitter.selection) return;
    const { x, y, w, h } = splitter.selection;
    if (w <= 0 || h <= 0) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(splitter.image, x, y, w, h, 0, 0, w, h);

    const trimmed = trimTransparent(offscreen);
    let finalCanvas: HTMLCanvasElement;
    if (trimmed) {
      finalCanvas = document.createElement('canvas');
      finalCanvas.width = trimmed.w;
      finalCanvas.height = trimmed.h;
      const fc = finalCanvas.getContext('2d')!;
      fc.drawImage(offscreen, trimmed.x, trimmed.y, trimmed.w, trimmed.h, 0, 0, trimmed.w, trimmed.h);
    } else {
      finalCanvas = offscreen;
    }

    dispatch({ type: 'SET_SPLITTER', updates: { extractedCanvas: finalCanvas } });
  }

  function handleAddAsLayer() {
    if (!splitter.extractedCanvas) return;
    const canvas = splitter.extractedCanvas;
    canvas.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const layer: Layer = {
          id: crypto.randomUUID(),
          name: extractName,
          type: 'Custom' as LayerType,
          visible: true,
          opacity: 100,
          hsl: { hue: 0, saturation: 0, lightness: 0 },
          image: img,
          objectUrl,
          fileName: extractName + '.png',
          offsetX: 0,
          offsetY: 0,
          inputLayout: { ...state.config.defaultInputLayout },
        };
        dispatch({ type: 'ADD_LAYER', layer });
        dispatch({ type: 'SET_TAB', tab: 'composer' });
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  function handleDownloadExtracted() {
    if (!splitter.extractedCanvas) return;
    splitter.extractedCanvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = extractName + '.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function handleClear() {
    dispatch({ type: 'SET_SPLITTER', updates: { selection: null, extractedCanvas: null } });
  }

  const zoomIdx = ZOOM_STEPS.indexOf(zoom);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0 flex-wrap">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Asset Splitter</span>
        <button
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
          onClick={() => fileInputRef.current?.click()}
        >
          Load Image
        </button>

        {splitter.image && (
          <>
            <button
              className={`text-xs px-2 py-1 rounded ${tool === 'select' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              onClick={() => setTool('select')}
            >
              ✂ Select
            </button>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
              onClick={handleClear}
            >
              Clear
            </button>
            {splitter.selection && splitter.selection.w > 0 && splitter.selection.h > 0 && (
              <button
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded"
                onClick={handleExtract}
              >
                Extract + Trim
              </button>
            )}

            {/* Divider */}
            <div className="w-px h-4 bg-gray-700" />

            {/* Zoom controls */}
            <span className="text-xs text-gray-400">Zoom:</span>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded disabled:opacity-40"
              onClick={() => zoomIdx > 0 && setZoom(ZOOM_STEPS[zoomIdx - 1])}
              disabled={zoomIdx === 0}
              title="Zoom out (or scroll down)"
            >−</button>
            <span className="text-xs text-gray-200 w-10 text-center tabular-nums">{zoomLabel(zoom)}</span>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded disabled:opacity-40"
              onClick={() => zoomIdx < ZOOM_STEPS.length - 1 && setZoom(ZOOM_STEPS[zoomIdx + 1])}
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              title="Zoom in (or scroll up)"
            >+</button>
            {/* Preset zoom buttons */}
            <div className="flex gap-1">
              {ZOOM_STEPS.map(z => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`text-xs px-1.5 py-0.5 rounded ${zoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {zoomLabel(z)}
                </button>
              ))}
            </div>

            <span className="text-xs text-gray-500 ml-1">
              {splitter.image.naturalWidth}×{splitter.image.naturalHeight}px
              {splitter.selection && splitter.selection.w > 0 && (
                <> · sel: <span className="text-gray-300">{splitter.selection.w}×{splitter.selection.h}</span>
                  {' '}at ({splitter.selection.x},{splitter.selection.y})</>
              )}
            </span>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
              if (splitter.objectUrl) URL.revokeObjectURL(splitter.objectUrl);
              dispatch({ type: 'SET_SPLITTER', updates: { image: img, objectUrl, selection: null, extractedCanvas: null } });
            };
            img.src = objectUrl;
          }}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area — scrollable so zoomed images pan freely */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-950 p-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          {!splitter.image ? (
            <div
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-700 rounded-lg text-gray-500 text-sm mx-auto"
              style={{ width: 400, height: 300 }}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                const objectUrl = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => dispatch({ type: 'SET_SPLITTER', updates: { image: img, objectUrl } });
                img.src = objectUrl;
              }}
              onDragOver={e => e.preventDefault()}
            >
              <span className="text-3xl mb-2">🖼️</span>
              <span>Drop an image or click Load Image</span>
              <span className="text-xs mt-1 text-gray-600">PNG sprite sheets, tilesets, reference images</span>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="cursor-crosshair block"
              style={{ imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onWheel={onWheel}
            />
          )}
        </div>

        {/* Right panel: extracted preview */}
        {splitter.extractedCanvas && (
          <div className="flex flex-col gap-3 p-4 bg-gray-900 border-l border-gray-700 flex-shrink-0" style={{ width: 200 }}>
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Extracted</span>
            <div
              className="border border-gray-700 rounded overflow-hidden"
              style={{ background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px' }}
            >
              <canvas
                style={{ imageRendering: 'pixelated' }}
                ref={el => {
                  if (el && splitter.extractedCanvas) {
                    const src = splitter.extractedCanvas;
                    const maxW = 168;
                    const s = Math.min(4, maxW / src.width);
                    el.width = src.width;
                    el.height = src.height;
                    el.style.width = src.width * s + 'px';
                    el.style.height = src.height * s + 'px';
                    el.getContext('2d')!.drawImage(src, 0, 0);
                  }
                }}
              />
            </div>
            <span className="text-xs text-gray-500">
              {splitter.extractedCanvas.width}×{splitter.extractedCanvas.height}px
            </span>
            <input
              type="text"
              value={extractName}
              onChange={e => setExtractName(e.target.value)}
              placeholder="Layer name"
              className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded"
            />
            <button
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
              onClick={handleAddAsLayer}
            >
              + Add as Layer
            </button>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
              onClick={handleDownloadExtracted}
            >
              Download PNG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
