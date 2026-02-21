import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import type { AppState, AppAction, Layer } from '../types';
import { frameRect, flatIndex } from '../types';
import { ColorShiftCache } from '../colorShift';
import { compositeFrame } from '../compositing';
import { getDirectionRow } from '../state';
import { useIsMobile } from '../hooks/useIsMobile';

interface MainCanvasProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  cache: ColorShiftCache;
}

// ── Source sheet overlay ───────────────────────────────────────────────────────
// Renders the selected layer composited in isolation — same grid as the export
// sheet, same offsets applied — so the user sees exactly how this layer
// contributes to each frame, positioned correctly.

interface SourceSheetProps {
  layer: Layer;
  config: { frameWidth: number; frameHeight: number; framesPerDirection: number; directions: number; exportLayout: { cols: number; rows: number } };
  dirRow: number;
  frameIndex: number;
  zoom: number;
  cache: ColorShiftCache;
}

function SourceSheetOverlay({ layer, config, dirRow, frameIndex, zoom, cache }: SourceSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { frameWidth, frameHeight, framesPerDirection, directions, exportLayout } = config;
  const { cols, rows } = exportLayout;
  const total = framesPerDirection * directions;

  // Current-frame highlight uses export layout position
  const currentN = flatIndex(dirRow, frameIndex, framesPerDirection);
  const hlCol = currentN % cols;
  const hlRow = Math.floor(currentN / cols);
  const highlightX = hlCol * frameWidth;
  const highlightY = hlRow * frameHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layer.image) return;
    const w = cols * frameWidth;
    const h = rows * frameHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    // Composite this layer into each export-grid cell, applying offset + HSL —
    // exactly as compositeFrame does, but for a single layer.
    const shiftedCanvas = cache.get(layer.id, layer.image, layer.hsl);
    ctx.globalAlpha = layer.opacity / 100;

    for (let d = 0; d < directions; d++) {
      for (let f = 0; f < framesPerDirection; f++) {
        const n = flatIndex(d, f, framesPerDirection);
        if (n >= total) continue;

        // Where this frame lives in the export sheet
        const destCol = n % cols;
        const destRow = Math.floor(n / cols);
        const destX = destCol * frameWidth;
        const destY = destRow * frameHeight;

        // Where to sample from in the (potentially HSL-shifted) source image
        const { sx, sy } = frameRect(n, layer.inputLayout, frameWidth, frameHeight);

        // Per-frame and global offsets
        const fof = layer.frameOffsets?.[f];
        const ox = layer.offsetX + (fof?.x ?? 0);
        const oy = layer.offsetY + (fof?.y ?? 0);

        ctx.drawImage(
          shiftedCanvas,
          sx, sy, frameWidth, frameHeight,
          destX + ox, destY + oy, frameWidth, frameHeight
        );
      }
    }
    ctx.globalAlpha = 1;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(99,102,241,0.35)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * frameHeight); ctx.lineTo(w, r * frameHeight); ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath(); ctx.moveTo(c * frameWidth, 0); ctx.lineTo(c * frameWidth, h); ctx.stroke();
    }

    // Highlight current frame
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(highlightX + 0.75, highlightY + 0.75, frameWidth - 1.5, frameHeight - 1.5);

  }, [layer, cols, rows, frameWidth, frameHeight, total, directions, framesPerDirection, currentN, highlightX, highlightY, cache]);

  const naturalW = cols * frameWidth;
  const naturalH = rows * frameHeight;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="border border-gray-700 rounded overflow-hidden"
        style={{ background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px' }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: naturalW * zoom,
            height: naturalH * zoom,
            display: 'block',
            imageRendering: zoom > 1 ? 'pixelated' : 'auto',
          }}
        />
      </div>
      <span className="text-xs text-gray-600">
        {cols}×{rows} export layout · {naturalW}×{naturalH}px · frame #{currentN} highlighted
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MainCanvas({ state, dispatch, cache }: MainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();
  const { config, layers, previewDirection, previewFrame, canvasZoom, sheetZoom, selectedLayerId, frameOffsetMode } = state;

  const dirRow = useMemo(
    () => getDirectionRow(previewDirection, config.directions),
    [previewDirection, config.directions]
  );

  // Drag state — stored in refs so pointer handlers don't need to be recreated
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selectedLayer) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Snapshot the pre-drag state so the entire drag can be undone in one step
    dispatch({ type: 'SNAPSHOT' });
    if (frameOffsetMode) {
      // Drag moves the per-frame offset for the current frame
      const fof = selectedLayer.frameOffsets?.[previewFrame];
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: fof?.x ?? 0,
        origY: fof?.y ?? 0,
      };
    } else {
      // Drag moves the global layer offset
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: selectedLayer.offsetX,
        origY: selectedLayer.offsetY,
      };
    }
  }, [selectedLayer, frameOffsetMode, previewFrame, dispatch]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || !selectedLayer) return;
    const { startX, startY, origX, origY } = dragRef.current;
    // Scale mouse delta from display pixels → sprite pixels
    const dx = Math.round((e.clientX - startX) / canvasZoom);
    const dy = Math.round((e.clientY - startY) / canvasZoom);

    if (frameOffsetMode) {
      // Build a new frameOffsets array with this frame's offset updated
      const count = config.framesPerDirection;
      const current = selectedLayer.frameOffsets ?? [];
      const next: Array<{ x: number; y: number }> = Array.from({ length: count }, (_, i) => ({
        x: current[i]?.x ?? 0,
        y: current[i]?.y ?? 0,
      }));
      next[previewFrame] = { x: origX + dx, y: origY + dy };
      // Transient during drag — no undo step per pixel
      dispatch({
        type: 'UPDATE_LAYER_TRANSIENT',
        id: selectedLayer.id,
        updates: { frameOffsets: next },
      });
    } else {
      // Transient during drag — no undo step per pixel
      dispatch({
        type: 'UPDATE_LAYER_TRANSIENT',
        id: selectedLayer.id,
        updates: { offsetX: origX + dx, offsetY: origY + dy },
      });
    }
  }, [selectedLayer, canvasZoom, frameOffsetMode, previewFrame, config.framesPerDirection, dispatch]);

  const onPointerUp = useCallback(() => {
    // Transient updates already modified state during drag.
    // The SNAPSHOT at drag start ensures undo restores the pre-drag position.
    dragRef.current = null;
  }, []);

  // Redraw whenever relevant state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = config.frameWidth;
    canvas.height = config.frameHeight;
    compositeFrame(canvas, layers, config, dirRow, previewFrame, cache);
  }, [layers, config, dirRow, previewFrame, cache]);

  // Sheet preview mirrors the export layout exactly.
  const { exportLayout, framesPerDirection, directions, frameWidth, frameHeight } = config;
  const exportCols = exportLayout.cols;
  const exportRows = exportLayout.rows;
  const totalFrameCount = directions * framesPerDirection;

  // Full composited sheet preview canvas
  const sheetRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = sheetRef.current;
    if (!canvas) return;
    const sheetW = frameWidth * exportCols;
    const sheetH = frameHeight * exportRows;
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, sheetW, sheetH);

    // Draw each frame at its export-layout position (matches renderFullSheet logic)
    for (let d = 0; d < directions; d++) {
      for (let f = 0; f < framesPerDirection; f++) {
        const n = flatIndex(d, f, framesPerDirection);
        if (n >= totalFrameCount) continue;
        const destCol = n % exportCols;
        const destRow = Math.floor(n / exportCols);
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = frameWidth;
        frameCanvas.height = frameHeight;
        compositeFrame(frameCanvas, layers, config, d, f, cache);
        ctx.drawImage(frameCanvas, destCol * frameWidth, destRow * frameHeight);
      }
    }

    // Draw grid lines on top
    ctx.strokeStyle = 'rgba(99,102,241,0.3)';
    ctx.lineWidth = 0.5;
    for (let row = 0; row <= exportRows; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * frameHeight);
      ctx.lineTo(sheetW, row * frameHeight);
      ctx.stroke();
    }
    for (let col = 0; col <= exportCols; col++) {
      ctx.beginPath();
      ctx.moveTo(col * frameWidth, 0);
      ctx.lineTo(col * frameWidth, sheetH);
      ctx.stroke();
    }

    // Highlight the current (dirRow, previewFrame) cell in the export grid
    const currentN = flatIndex(dirRow, previewFrame, framesPerDirection);
    const hlCol = currentN % exportCols;
    const hlRow = Math.floor(currentN / exportCols);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      hlCol * frameWidth + 0.75,
      hlRow * frameHeight + 0.75,
      frameWidth - 1.5,
      frameHeight - 1.5
    );
  }, [layers, config, dirRow, previewFrame, cache, exportCols, exportRows, totalFrameCount, directions, framesPerDirection, frameWidth, frameHeight]);

  function handleSheetClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = sheetRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const clickCol = Math.floor(x / frameWidth);
    const clickRow = Math.floor(y / frameHeight);

    // Reverse-map click position → flat index → (dirRow, frameIdx)
    const n = clickRow * exportCols + clickCol;
    if (n < 0 || n >= totalFrameCount) return;
    const d = Math.floor(n / framesPerDirection);
    const f = n % framesPerDirection;

    const dirs4 = ['down', 'left', 'right', 'up'] as const;
    const dirs8 = ['down', 'down-left', 'left', 'up-left', 'up', 'up-right', 'right', 'down-right'] as const;
    const dirs = config.directions === 4 ? dirs4 : dirs8;
    if (d >= 0 && d < dirs.length) {
      dispatch({ type: 'SET_PREVIEW_DIRECTION', direction: dirs[d] });
      dispatch({ type: 'SET_PREVIEW_FRAME', frame: f });
    }
  }

  const displaySize = frameWidth * canvasZoom;
  const displayHeight = frameHeight * canvasZoom;

  const sheetNativeWidth = frameWidth * exportCols;
  const sheetNativeHeight = frameHeight * exportRows;
  // The outer container is overflow-auto, so just apply zoom directly — no cap needed.
  const sheetScale = sheetZoom;

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-auto items-center">
      {/* Zoom controls */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 border-b border-gray-800 w-full flex-wrap">
        <span className="text-xs text-gray-400">Canvas:</span>
        {(isMobile ? [0.5, 1, 2, 4] : [0.25, 0.5, 1, 2, 4, 8]).map(z => (
          <button
            key={z}
            onClick={() => dispatch({ type: 'SET_CANVAS_ZOOM', zoom: z })}
            className={`text-xs px-2 py-0.5 rounded ${canvasZoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            {z < 1 ? `1/${1/z}` : `${z}x`}
          </button>
        ))}
        <div className="w-px h-4 bg-gray-700" />
        <span className="text-xs text-gray-400">Sheets:</span>
        {(isMobile ? [0.5, 1, 2, 4] : [0.25, 0.5, 1, 2, 4, 8]).map(z => (
          <button
            key={z}
            onClick={() => dispatch({ type: 'SET_SHEET_ZOOM', zoom: z })}
            className={`text-xs px-2 py-0.5 rounded ${sheetZoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            {z < 1 ? `1/${1/z}` : `${z}x`}
          </button>
        ))}
        <span className="text-xs text-gray-600 ml-1">
          {config.frameWidth}×{config.frameHeight}px · {config.framesPerDirection}f · {config.directions}dir
        </span>
      </div>

      <div className="flex flex-col items-center gap-6 p-4 overflow-auto w-full">
        {/* Current frame preview */}
        <div className="flex flex-col items-center gap-2">
          <span className={`text-xs uppercase tracking-wider ${frameOffsetMode ? 'text-amber-400' : 'text-gray-500'}`}>
            {frameOffsetMode ? '✦ Frame Offset Mode — drag to set offset for this frame' : 'Current Frame'}
          </span>
          <div
            className="rounded"
            style={{
              width: displaySize,
              height: displayHeight,
              background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
              border: frameOffsetMode ? '2px solid #f59e0b' : '1px solid #374151',
              boxSizing: 'content-box',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: displaySize,
                height: displayHeight,
                cursor: selectedLayer ? 'crosshair' : 'default',
                imageRendering: canvasZoom >= 1 ? 'pixelated' : 'auto',
                touchAction: 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
          </div>
          <span className="text-xs text-gray-600">
            {previewDirection} · frame {previewFrame + 1}/{config.framesPerDirection}
            {selectedLayer && !frameOffsetMode && (
              <span className="text-gray-500 ml-2">· drag to reposition "{selectedLayer.name}" · offset {selectedLayer.offsetX},{selectedLayer.offsetY}</span>
            )}
            {selectedLayer && frameOffsetMode && (() => {
              const fof = selectedLayer.frameOffsets?.[previewFrame];
              return (
                <span className="text-amber-500 ml-2">
                  · frame offset {fof?.x ?? 0},{fof?.y ?? 0}
                  {(fof?.x || fof?.y) ? ' ●' : ''}
                </span>
              );
            })()}
          </span>
        </div>

        {/* Composited sheet preview */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Composited Sheet Preview <span className="text-gray-700 normal-case">(click to select frame)</span>
          </span>
          <div
            className="border border-gray-700 rounded overflow-hidden"
            style={{
              background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
            }}
          >
            <canvas
              ref={sheetRef}
              style={{
                width: sheetNativeWidth * sheetScale,
                height: sheetNativeHeight * sheetScale,
                cursor: 'crosshair',
                imageRendering: sheetZoom > 1 ? 'pixelated' : 'auto',
              }}
              onClick={handleSheetClick}
            />
          </div>
          <span className="text-xs text-gray-600">
            {exportCols}×{exportRows} export layout · {sheetNativeWidth}×{sheetNativeHeight}px
          </span>
        </div>

        {/* Source sheet for selected layer */}
        {selectedLayer?.image && (
          <div className="flex flex-col items-center gap-2 w-full">
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              Layer Preview — <span className="text-indigo-400 normal-case">{selectedLayer.name}</span>
              <span className="text-gray-700 ml-1 normal-case">(this layer only)</span>
            </span>
            <SourceSheetOverlay
              layer={selectedLayer}
              config={config}
              dirRow={dirRow}
              frameIndex={previewFrame}
              zoom={sheetZoom}
              cache={cache}
            />
          </div>
        )}
      </div>
    </div>
  );
}
