import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { AppState, AppAction, LibraryAsset, SplitterTool, SelectionMode } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { trimTransparent, compositeFrame, renderFullSheet } from '../compositing';
import { ColorShiftCache } from '../colorShift';
import { getDirectionRow } from '../state';
import { ImportFrameModal } from './ImportFrameModal';

interface AssetSplitterProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  cache: ColorShiftCache;
}

const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
function zoomLabel(z: number) {
  return z < 1 ? `${Math.round(z * 100)}%` : `${z}×`;
}

// ─── Mask helpers ─────────────────────────────────────────────────────────────

function createMask(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function computeBounds(
  mask: HTMLCanvasElement
): { x: number; y: number; w: number; h: number } | null {
  const ctx = mask.getContext('2d')!;
  const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (data[(y * mask.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Build a Path2D tracing the outline of all selected (alpha > 0) pixels in
 * the mask. For every pixel that is "on", we emit a unit edge segment for each
 * of its four sides that borders an "off" pixel or the image boundary.
 * The result can be stroked at zoom-scale to produce accurate marching ants
 * for any mask shape — boxes, lassos, composites after add/subtract, etc.
 *
 * Coordinates are in image-pixel space (multiply by zoom before stroking).
 * For large masks we sample at a lower resolution for performance, then scale
 * the path coordinates back up so the outline still aligns with the image.
 */
function buildMaskOutlinePath(mask: HTMLCanvasElement): Path2D {
  // Cap trace resolution so the pixel loop stays fast on large sprite sheets.
  const MAX_TRACE = 512;
  const { width: origW, height: origH } = mask;
  const scale = Math.min(1, MAX_TRACE / Math.max(origW, origH));
  const W = Math.max(1, Math.round(origW * scale));
  const H = Math.max(1, Math.round(origH * scale));
  const invScale = 1 / scale; // multiply path coords by this to restore image-space

  let data: Uint8ClampedArray;
  if (scale < 1) {
    // Downsample mask into a small offscreen canvas
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d')!.drawImage(mask, 0, 0, W, H);
    data = tmp.getContext('2d')!.getImageData(0, 0, W, H).data;
  } else {
    data = mask.getContext('2d')!.getImageData(0, 0, W, H).data;
  }

  const path = new Path2D();

  function on(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return data[(y * W + x) * 4 + 3] > 0;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      const px = x * invScale, py = y * invScale;
      const px1 = (x + 1) * invScale, py1 = (y + 1) * invScale;
      if (!on(x, y - 1)) { path.moveTo(px,  py);  path.lineTo(px1, py);  }
      if (!on(x, y + 1)) { path.moveTo(px,  py1); path.lineTo(px1, py1); }
      if (!on(x - 1, y)) { path.moveTo(px,  py);  path.lineTo(px,  py1); }
      if (!on(x + 1, y)) { path.moveTo(px1, py);  path.lineTo(px1, py1); }
    }
  }
  return path;
}

function paintBox(
  mask: HTMLCanvasElement,
  x: number, y: number, w: number, h: number,
  mode: SelectionMode
) {
  const ctx = mask.getContext('2d')!;
  if (mode === 'replace') ctx.clearRect(0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
  ctx.fillStyle = 'white';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

function paintLasso(
  mask: HTMLCanvasElement,
  points: Array<{ x: number; y: number }>,
  mode: SelectionMode
) {
  if (points.length < 3) return;
  const ctx = mask.getContext('2d')!;
  if (mode === 'replace') ctx.clearRect(0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Handle hit testing ───────────────────────────────────────────────────────

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function getHandles(b: { x: number; y: number; w: number; h: number }, zoom: number) {
  const cx = b.x * zoom, cy = b.y * zoom, cw = b.w * zoom, ch = b.h * zoom;
  const mx = cx + cw / 2, my = cy + ch / 2;
  return [
    { id: 'nw' as HandleId, px: cx,      py: cy      },
    { id: 'n'  as HandleId, px: mx,      py: cy      },
    { id: 'ne' as HandleId, px: cx + cw, py: cy      },
    { id: 'e'  as HandleId, px: cx + cw, py: my      },
    { id: 'se' as HandleId, px: cx + cw, py: cy + ch },
    { id: 's'  as HandleId, px: mx,      py: cy + ch },
    { id: 'sw' as HandleId, px: cx,      py: cy + ch },
    { id: 'w'  as HandleId, px: cx,      py: my      },
  ];
}

function hitHandle(
  px: number, py: number,
  bounds: { x: number; y: number; w: number; h: number },
  zoom: number
): HandleId | null {
  const RADIUS = 6;
  for (const h of getHandles(bounds, zoom)) {
    if (Math.abs(px - h.px) <= RADIUS && Math.abs(py - h.py) <= RADIUS) return h.id;
  }
  return null;
}

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
  e: 'e-resize', se: 'se-resize', s: 's-resize',
  sw: 'sw-resize', w: 'w-resize',
};

// ─── Drag state ───────────────────────────────────────────────────────────────

type DragState =
  | { kind: 'none' }
  | { kind: 'box';    mode: SelectionMode; startImgX: number; startImgY: number }
  | { kind: 'lasso';  mode: SelectionMode; points: Array<{ x: number; y: number }> }
  | { kind: 'handle'; handleId: HandleId; origBounds: { x: number; y: number; w: number; h: number }; startImgX: number; startImgY: number }
  | { kind: 'pan';    startClientX: number; startClientY: number; startScrollLeft: number; startScrollTop: number };

// ─── Extract through mask ─────────────────────────────────────────────────────

function extractThroughMask(
  image: HTMLImageElement,
  mask: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number }
): HTMLCanvasElement {
  const crop = document.createElement('canvas');
  crop.width = bounds.w; crop.height = bounds.h;
  const ctx = crop.getContext('2d')!;
  ctx.drawImage(image, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  ctx.globalCompositeOperation = 'source-over';

  const trimmed = trimTransparent(crop);
  if (!trimmed) return crop;
  const out = document.createElement('canvas');
  out.width = trimmed.w; out.height = trimmed.h;
  out.getContext('2d')!.drawImage(crop, trimmed.x, trimmed.y, trimmed.w, trimmed.h, 0, 0, trimmed.w, trimmed.h);
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AssetSplitter({ state, dispatch, cache }: AssetSplitterProps) {
  const { splitter } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFrameRef = useRef<number>(0);
  const marchingPhaseRef = useRef(0);

  const [tool, setTool] = useState<SplitterTool>('box');
  const [zoom, setZoom] = useState(1);
  const [extractName, setExtractName] = useState('asset');
  const [cursor, setCursor] = useState('crosshair');
  // Canvas pending "Add as Layer" — shows the frame picker modal
  const [importCanvas, setImportCanvas] = useState<HTMLCanvasElement | null>(null);
  // "Load from Layer" dropdown + frame picker
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const layerMenuRef = useRef<HTMLDivElement>(null);
  const [framePickerLayerId, setFramePickerLayerId] = useState<string | null>(null);

  const liveMaskRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  // Cached outline path for the committed mask. Rebuilt whenever a new mask is
  // committed. Used to draw marching ants that accurately follow any mask shape
  // (box, lasso, or add/subtract composite).
  const maskOutlineRef = useRef<Path2D | null>(null);
  // Checkerboard pattern cached as an offscreen canvas — rebuilt only on size change.
  const checkerPatternRef = useRef<CanvasPattern | null>(null);
  const checkerSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Live drag rect in image-space, used for box/handle preview without mask allocation.
  const liveDragRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Redraw ───────────────────────────────────────────────────────────────────

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splitter.image) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Checkerboard — cached as a CanvasPattern, rebuilt only when canvas size changes
    if (checkerSizeRef.current.w !== W || checkerSizeRef.current.h !== H || !checkerPatternRef.current) {
      const cs = 8;
      const tile = document.createElement('canvas');
      tile.width = cs * 2; tile.height = cs * 2;
      const tc = tile.getContext('2d')!;
      tc.fillStyle = '#1a1a2e'; tc.fillRect(0,  0,  cs, cs);
      tc.fillStyle = '#16213e'; tc.fillRect(cs, 0,  cs, cs);
      tc.fillStyle = '#16213e'; tc.fillRect(0,  cs, cs, cs);
      tc.fillStyle = '#1a1a2e'; tc.fillRect(cs, cs, cs, cs);
      checkerPatternRef.current = ctx.createPattern(tile, 'repeat')!;
      checkerSizeRef.current = { w: W, h: H };
    }
    ctx.fillStyle = checkerPatternRef.current!;
    ctx.fillRect(0, 0, W, H);

    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(splitter.image, 0, 0, W, H);

    const drag = dragRef.current;
    const phase = marchingPhaseRef.current;

    // ── Marching ants: stroke a scaled Path2D with the animated dash ──────────
    function strokeMarchingAnts(path: Path2D, scale: number) {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.strokeStyle = 'white'; ctx.lineDashOffset = -phase / scale;
      ctx.stroke(path);
      ctx.strokeStyle = 'black'; ctx.lineDashOffset = (-phase + 4) / scale;
      ctx.stroke(path);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Committed selection marching ants (always from mask outline) ──────────
    const outlinePath = maskOutlineRef.current;
    const committedBounds = splitter.selectionBounds;

    if (outlinePath && committedBounds) {
      strokeMarchingAnts(outlinePath, zoom);

      // Resize handles — only when idle and no live drag
      if (drag.kind === 'none') {
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1.5;
        for (const hh of getHandles(committedBounds, zoom)) {
          ctx.fillRect(hh.px - 4, hh.py - 4, 8, 8);
          ctx.strokeRect(hh.px - 4, hh.py - 4, 8, 8);
        }
      }

      // Size label
      const bx = committedBounds.x * zoom, by = committedBounds.y * zoom;
      ctx.fillStyle = 'rgba(20,20,40,0.85)';
      ctx.fillRect(bx, by > 18 ? by - 18 : by + 2, 70, 15);
      ctx.fillStyle = '#d0d0ff';
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(`${committedBounds.w}×${committedBounds.h}px`, bx + 3, by > 18 ? by - 16 : by + 4);
    }

    // ── In-progress drag preview (drawn on top of committed selection) ─────────
    if ((drag.kind === 'box' || drag.kind === 'handle') && liveDragRectRef.current) {
      // Live box/handle: draw rect directly from stored coords — no mask read needed
      const lb = liveDragRectRef.current;
      ctx.save();
      ctx.strokeStyle = 'rgba(99,102,241,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(lb.x * zoom + 0.5, lb.y * zoom + 0.5, lb.w * zoom, lb.h * zoom);
      ctx.setLineDash([]);
      ctx.restore();
    } else if (drag.kind === 'lasso' && drag.points.length > 1) {
      // In-progress lasso path — color-coded by mode, drawn straight from points
      const pts = drag.points;
      const color = drag.mode === 'subtract' ? '#f87171' : drag.mode === 'add' ? '#4ade80' : '#facc15';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x * zoom, pts[0].y * zoom);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * zoom, pts[i].y * zoom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [splitter.image, splitter.selectionBounds, zoom]);

  // Marching-ants animation loop — only redraws when a selection exists or drag is active
  useEffect(() => {
    let last = 0;
    function tick(ts: number) {
      const hasAnything = maskOutlineRef.current || dragRef.current.kind !== 'none';
      if (hasAnything && ts - last > 80) {
        marchingPhaseRef.current = (marchingPhaseRef.current + 1) % 8;
        last = ts;
        redraw();
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [redraw]);

  // Resize canvas on image/zoom change — invalidate checkerboard pattern cache
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splitter.image) return;
    canvas.width = Math.round(splitter.image.naturalWidth * zoom);
    canvas.height = Math.round(splitter.image.naturalHeight * zoom);
    checkerPatternRef.current = null; // force rebuild on next draw
    redraw();
  }, [splitter.image, zoom, redraw]);

  // Fit zoom on first image load only — subsequent loads retain the current zoom level
  const hadImageRef = useRef(false);
  useEffect(() => {
    if (!splitter.image) {
      hadImageRef.current = false;
      return;
    }
    if (hadImageRef.current) return; // keep current zoom on subsequent loads
    hadImageRef.current = true;
    const container = containerRef.current;
    const availW = container ? container.clientWidth - 32 : 680;
    const availH = container ? container.clientHeight - 32 : 480;
    const fit = Math.min(1, availW / splitter.image.naturalWidth, availH / splitter.image.naturalHeight);
    const nearest = [...ZOOM_STEPS].reverse().find(z => z <= fit) ?? ZOOM_STEPS[0];
    setZoom(nearest); // eslint-disable-line react-hooks/set-state-in-effect
  }, [splitter.image]);

  // ── Coordinate helpers ───────────────────────────────────────────────────────

  function canvasXY(e: React.PointerEvent): { cx: number; cy: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      cx: (e.clientX - rect.left) * (canvas.width / rect.width),
      cy: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function toImgCoords(cx: number, cy: number): { x: number; y: number } {
    return { x: Math.round(cx / zoom), y: Math.round(cy / zoom) };
  }

  function clampToImg(x: number, y: number) {
    const img = splitter.image!;
    return {
      x: Math.max(0, Math.min(x, img.naturalWidth)),
      y: Math.max(0, Math.min(y, img.naturalHeight)),
    };
  }

  function selectionMode(e: React.PointerEvent): SelectionMode {
    if (e.shiftKey) return 'add';
    if (e.altKey)   return 'subtract';
    return 'replace';
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent) {
    if (!splitter.image) return;

    // Middle-click: pan the scroll container instead of selecting
    if (e.button === 1) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const container = containerRef.current!;
      dragRef.current = {
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScrollLeft: container.scrollLeft,
        startScrollTop:  container.scrollTop,
      };
      setCursor('grabbing');
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const { cx, cy } = canvasXY(e);
    const ip = toImgCoords(cx, cy);
    const mode = selectionMode(e);

    // Check resize handle first (box tool only)
    if (tool === 'box' && splitter.selectionBounds) {
      const handle = hitHandle(cx, cy, splitter.selectionBounds, zoom);
      if (handle) {
        dragRef.current = { kind: 'handle', handleId: handle, origBounds: { ...splitter.selectionBounds }, startImgX: ip.x, startImgY: ip.y };
        return;
      }
    }

    if (tool === 'box') {
      dragRef.current = { kind: 'box', mode, startImgX: ip.x, startImgY: ip.y };
      if (mode === 'replace') liveMaskRef.current = null;
    } else {
      dragRef.current = { kind: 'lasso', mode, points: [clampToImg(ip.x, ip.y)] };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!splitter.image) return;
    const drag = dragRef.current;

    // Pan mode — scroll the container
    if (drag.kind === 'pan') {
      const container = containerRef.current!;
      container.scrollLeft = drag.startScrollLeft - (e.clientX - drag.startClientX);
      container.scrollTop  = drag.startScrollTop  - (e.clientY - drag.startClientY);
      return;
    }

    const { cx, cy } = canvasXY(e);
    const ip = toImgCoords(cx, cy);
    const img = splitter.image;

    if (drag.kind === 'none') {
      if (tool === 'box' && splitter.selectionBounds) {
        const handle = hitHandle(cx, cy, splitter.selectionBounds, zoom);
        setCursor(handle ? HANDLE_CURSORS[handle] : 'crosshair');
      }
      return;
    }

    if (drag.kind === 'box') {
      const { startImgX: sx, startImgY: sy } = drag;
      const x = Math.max(0, Math.min(sx, ip.x));
      const y = Math.max(0, Math.min(sy, ip.y));
      const w = Math.min(Math.abs(ip.x - sx), img.naturalWidth  - x);
      const h = Math.min(Math.abs(ip.y - sy), img.naturalHeight - y);
      if (w > 0 && h > 0) {
        // Store rect directly — no mask canvas allocation during drag
        liveDragRectRef.current = { x, y, w, h };
        redraw();
      }
    } else if (drag.kind === 'lasso') {
      // Throttle: only add point if it moved at least 2 image-pixels from the last
      const pts = drag.points;
      const last = pts[pts.length - 1];
      if (Math.abs(ip.x - last.x) >= 2 || Math.abs(ip.y - last.y) >= 2) {
        pts.push(clampToImg(ip.x, ip.y));
        redraw();
      }
    } else if (drag.kind === 'handle') {
      const { handleId, origBounds, startImgX: sx, startImgY: sy } = drag;
      const dx = ip.x - sx, dy = ip.y - sy;
      let { x, y, w, h } = origBounds;

      if (handleId.includes('w')) { x = Math.min(origBounds.x + origBounds.w - 1, x + dx); w = origBounds.x + origBounds.w - x; }
      if (handleId.includes('e')) { w = Math.max(1, origBounds.w + dx); }
      if (handleId.includes('n')) { y = Math.min(origBounds.y + origBounds.h - 1, y + dy); h = origBounds.y + origBounds.h - y; }
      if (handleId.includes('s')) { h = Math.max(1, origBounds.h + dy); }

      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, img.naturalWidth  - x);
      h = Math.min(h, img.naturalHeight - y);

      if (w > 0 && h > 0) {
        liveDragRectRef.current = { x, y, w, h };
        redraw();
      }
    }
  }

  function commitMask(mask: HTMLCanvasElement) {
    maskOutlineRef.current = buildMaskOutlinePath(mask);
    liveMaskRef.current = null;
    const bounds = computeBounds(mask);
    dispatch({ type: 'SET_SPLITTER', updates: { selectionMask: mask, selectionBounds: bounds, extractedCanvas: null } });
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = { kind: 'none' };
    const liveRect = liveDragRectRef.current;
    liveDragRectRef.current = null;
    liveMaskRef.current = null;

    // Pan ended — restore default cursor
    if (drag.kind === 'pan') {
      setCursor('crosshair');
      return;
    }

    if (!splitter.image) return;
    const img = splitter.image;

    if (drag.kind === 'lasso') {
      const pts = drag.points;
      if (pts.length >= 3) {
        const m = createMask(img.naturalWidth, img.naturalHeight);
        if (drag.mode !== 'replace' && splitter.selectionMask)
          m.getContext('2d')!.drawImage(splitter.selectionMask, 0, 0);
        paintLasso(m, pts, drag.mode);
        commitMask(m);
      }
    } else if ((drag.kind === 'box' || drag.kind === 'handle') && liveRect) {
      const m = createMask(img.naturalWidth, img.naturalHeight);
      if (drag.kind === 'box' && drag.mode !== 'replace' && splitter.selectionMask)
        m.getContext('2d')!.drawImage(splitter.selectionMask, 0, 0);
      paintBox(m, liveRect.x, liveRect.y, liveRect.w, liveRect.h,
        drag.kind === 'box' ? drag.mode : 'replace');
      commitMask(m);
    }
    redraw();
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const idx = ZOOM_STEPS.indexOf(zoom);
    if (e.deltaY < 0 && idx < ZOOM_STEPS.length - 1) setZoom(ZOOM_STEPS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) setZoom(ZOOM_STEPS[idx - 1]);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function doExtract(): HTMLCanvasElement | null {
    const { image, selectionMask, selectionBounds } = splitter;
    if (!image || !selectionMask || !selectionBounds) return null;
    const extracted = extractThroughMask(image, selectionMask, selectionBounds);
    dispatch({ type: 'SET_SPLITTER', updates: { extractedCanvas: extracted } });
    return extracted;
  }

  function handleAddToLibrary() {
    const canvas = splitter.extractedCanvas ?? doExtract();
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const asset: LibraryAsset = {
          id: crypto.randomUUID(),
          name: extractName,
          tags: [],
          objectUrl,
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          createdAt: Date.now(),
        };
        dispatch({ type: 'ADD_LIBRARY_ASSET', asset });
        dispatch({ type: 'SET_TAB', tab: 'library' });
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  function handleAddAsLayer() {
    const canvas = splitter.extractedCanvas ?? doExtract();
    if (!canvas) return;
    setImportCanvas(canvas);
  }

  function handleDownload() {
    const canvas = splitter.extractedCanvas;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = extractName + '.png'; a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function handleClear() {
    liveMaskRef.current = null;
    maskOutlineRef.current = null;
    dispatch({ type: 'SET_SPLITTER', updates: { selectionMask: null, selectionBounds: null, extractedCanvas: null } });
  }

  function handleSelectAll() {
    if (!splitter.image) return;
    const { naturalWidth: w, naturalHeight: h } = splitter.image;
    const mask = createMask(w, h);
    paintBox(mask, 0, 0, w, h, 'replace');
    commitMask(mask);
  }

  function handleUnload() {
    if (!window.confirm('Unload image? Any selection will be lost.')) return;
    if (splitter.objectUrl) URL.revokeObjectURL(splitter.objectUrl);
    maskOutlineRef.current = null;
    liveMaskRef.current = null;
    hadImageRef.current = false;
    dispatch({ type: 'SET_SPLITTER', updates: { image: null, objectUrl: null, selectionMask: null, selectionBounds: null, extractedCanvas: null } });
    setExtractName('asset');
  }

  // ── Load from Layer ────────────────────────────────────────────────────────

  /** Load a layer's full sheet (with HSL applied) into the splitter. */
  function loadLayerSheet(layerId: string) {
    const layer = state.layers.find(l => l.id === layerId);
    if (!layer?.image) return;
    const canvas = renderFullSheet([layer], state.config, cache);
    loadCanvasIntoSplitter(canvas, `${layer.name} (sheet)`);
    setShowLayerMenu(false);
  }

  /** Load a specific frame of a layer into the splitter. */
  function loadLayerFrame(layerId: string, dirRow: number, frameIdx: number) {
    const layer = state.layers.find(l => l.id === layerId);
    if (!layer?.image) return;
    const dirs = state.config.directions === 4 ? DIRECTIONS_4 : DIRECTIONS_8;
    const dirName = dirs[dirRow] ?? `dir${dirRow}`;
    const cv = document.createElement('canvas');
    cv.width = state.config.frameWidth;
    cv.height = state.config.frameHeight;
    compositeFrame(cv, [layer], state.config, dirRow, frameIdx, cache);
    loadCanvasIntoSplitter(cv, `${layer.name} (${dirName} #${frameIdx + 1})`);
    setShowLayerMenu(false);
    setFramePickerLayerId(null);
  }

  /** Common helper: convert a canvas to an HTMLImageElement and load it into the splitter. */
  function loadCanvasIntoSplitter(canvas: HTMLCanvasElement, name: string) {
    canvas.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (splitter.objectUrl) URL.revokeObjectURL(splitter.objectUrl);
        maskOutlineRef.current = null;
        liveMaskRef.current = null;
        dispatch({ type: 'SET_SPLITTER', updates: { image: img, objectUrl, selectionMask: null, selectionBounds: null, extractedCanvas: null } });
        setExtractName(name);
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  // Close layer menu when clicking outside
  useEffect(() => {
    if (!showLayerMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setShowLayerMenu(false);
      }
    }
    document.addEventListener('pointerdown', onClickOutside, true);
    return () => document.removeEventListener('pointerdown', onClickOutside, true);
  }, [showLayerMenu]);

  const layersWithImages = state.layers.filter(l => l.image);

  const hasSelection = !!(splitter.selectionMask && splitter.selectionBounds);
  const zoomIdx = ZOOM_STEPS.indexOf(zoom);

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0 flex-wrap">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Asset Splitter</span>

        <button
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
          onClick={() => fileInputRef.current?.click()}
        >
          Load Image
        </button>

        {/* Load from Layer dropdown */}
        {layersWithImages.length > 0 && (
          <div className="relative" ref={layerMenuRef}>
            <button
              className="text-xs bg-teal-700 hover:bg-teal-600 text-white px-2 py-1 rounded"
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              title="Load a composer layer into the splitter"
            >
              Load from Layer ▾
            </button>
            {showLayerMenu && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[220px] max-h-80 overflow-y-auto">
                {layersWithImages.map(layer => (
                  <div key={layer.id} className="border-b border-gray-700 last:border-b-0">
                    <div className="px-3 py-1.5 text-xs text-gray-300 font-medium truncate bg-gray-800/80">
                      {layer.name}
                      <span className="text-gray-500 ml-1">({layer.type})</span>
                    </div>
                    <div className="flex gap-1 px-3 pb-2">
                      <button
                        onClick={() => loadLayerSheet(layer.id)}
                        className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                        title="Load full sprite sheet into splitter"
                      >
                        Full Sheet
                      </button>
                      <button
                        onClick={() => { setFramePickerLayerId(layer.id); setShowLayerMenu(false); }}
                        className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                        title="Pick a specific frame to load into splitter"
                      >
                        Pick Frame…
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {splitter.image && (
          <>
            <button
              className="text-xs bg-gray-700 hover:bg-red-900 hover:text-red-300 text-gray-400 px-2 py-1 rounded"
              onClick={handleUnload}
              title="Unload image and return to empty state"
            >
              ✕ Unload
            </button>

            {/* Tool selector */}
            <div className="flex gap-1 bg-gray-800 p-0.5 rounded">
              <button
                className={`text-xs px-2 py-1 rounded transition-colors ${tool === 'box' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setTool('box')}
                title="Box selection (B)"
              >
                ▭ Box
              </button>
              <button
                className={`text-xs px-2 py-1 rounded transition-colors ${tool === 'lasso' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setTool('lasso')}
                title="Lasso selection (L)"
              >
                ⌾ Lasso
              </button>
            </div>

            {/* Modifier hint */}
            <span className="text-xs text-gray-600 border border-gray-800 rounded px-1.5 py-0.5 select-none">
              <kbd className="text-gray-400">Shift</kbd> add &nbsp;
              <kbd className="text-gray-400">Alt</kbd> subtract
            </span>

            <div className="w-px h-4 bg-gray-700" />

            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
              onClick={handleSelectAll}
            >
              All
            </button>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded disabled:opacity-40"
              onClick={handleClear}
              disabled={!hasSelection && !splitter.extractedCanvas}
            >
              Clear
            </button>

            {hasSelection && (
              <button
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded"
                onClick={doExtract}
              >
                ✂ Extract
              </button>
            )}

            <div className="w-px h-4 bg-gray-700" />

            {/* Zoom */}
            <span className="text-xs text-gray-400">Zoom:</span>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded disabled:opacity-40"
              onClick={() => zoomIdx > 0 && setZoom(ZOOM_STEPS[zoomIdx - 1])}
              disabled={zoomIdx === 0}
            >−</button>
            <span className="text-xs text-gray-200 w-10 text-center tabular-nums">{zoomLabel(zoom)}</span>
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded disabled:opacity-40"
              onClick={() => zoomIdx < ZOOM_STEPS.length - 1 && setZoom(ZOOM_STEPS[zoomIdx + 1])}
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
            >+</button>
            <div className="flex gap-1">
              {ZOOM_STEPS.map(z => (
                <button key={z} onClick={() => setZoom(z)}
                  className={`text-xs px-1.5 py-0.5 rounded ${zoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >{zoomLabel(z)}</button>
              ))}
            </div>

            <span className="text-xs text-gray-500 ml-1">
              {splitter.image.naturalWidth}×{splitter.image.naturalHeight}px
              {splitter.selectionBounds && (
                <> · sel: <span className="text-gray-300">
                  {splitter.selectionBounds.w}×{splitter.selectionBounds.h}
                </span> at ({splitter.selectionBounds.x},{splitter.selectionBounds.y})</>
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
              maskOutlineRef.current = null;
              liveMaskRef.current = null;
              dispatch({ type: 'SET_SPLITTER', updates: { image: img, objectUrl, selectionMask: null, selectionBounds: null, extractedCanvas: null } });
            };
            img.src = objectUrl;
          }}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-950"
          style={{ scrollbarGutter: 'stable' }}
        >
          {/* Inner wrapper: centres when canvas fits, expands to full canvas size when larger.
              Using inline-block + text-align trick so the scroll area always matches
              the canvas dimensions, while still centering when smaller than viewport. */}
          <div style={{ display: 'grid', placeItems: 'center', minWidth: '100%', minHeight: '100%', width: 'max-content', padding: '1rem' }}>
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
                img.onload = () => { maskOutlineRef.current = null; liveMaskRef.current = null; dispatch({ type: 'SET_SPLITTER', updates: { image: img, objectUrl } }); };
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
              className="block"
              style={{ cursor, imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onWheel={onWheel}
              onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
              onKeyDown={e => { if (e.key === 'b') setTool('box'); if (e.key === 'l') setTool('lasso'); }}
              tabIndex={0}
            />
          )}
          </div>
        </div>

        {/* Right panel */}
        {(splitter.extractedCanvas || hasSelection) && (
          <div className="flex flex-col gap-3 p-4 bg-gray-900 border-l border-gray-700 flex-shrink-0 overflow-y-auto" style={{ width: 210 }}>
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
              {splitter.extractedCanvas ? 'Extracted' : 'Selection'}
            </span>

            {splitter.extractedCanvas ? (
              <>
                <div
                  className="border border-gray-700 rounded overflow-hidden"
                  style={{ background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px' }}
                >
                  <canvas
                    style={{ imageRendering: 'pixelated' }}
                    ref={el => {
                      if (el && splitter.extractedCanvas) {
                        const src = splitter.extractedCanvas;
                        const maxW = 178;
                        const s = Math.min(4, maxW / src.width);
                        el.width = src.width; el.height = src.height;
                        el.style.width  = src.width  * s + 'px';
                        el.style.height = src.height * s + 'px';
                        el.getContext('2d')!.drawImage(src, 0, 0);
                      }
                    }}
                  />
                </div>
                <span className="text-xs text-gray-500">
                  {splitter.extractedCanvas.width}×{splitter.extractedCanvas.height}px
                </span>
              </>
            ) : splitter.selectionBounds ? (
              <p className="text-xs text-gray-400">
                {splitter.selectionBounds.w}×{splitter.selectionBounds.h}px selected<br />
                <span className="text-gray-600">Click Extract to preview</span>
              </p>
            ) : null}

            <input
              type="text"
              value={extractName}
              onChange={e => setExtractName(e.target.value)}
              placeholder="Asset name"
              className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded"
            />

            {hasSelection && !splitter.extractedCanvas && (
              <button
                className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded"
                onClick={doExtract}
              >
                ✂ Extract
              </button>
            )}

            {splitter.extractedCanvas && (
              <>
                <button
                  className="text-xs bg-violet-700 hover:bg-violet-600 text-white px-2 py-1 rounded"
                  onClick={handleAddToLibrary}
                >
                  + Add to Library
                </button>
                <button
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
                  onClick={handleAddAsLayer}
                >
                  + Add as Layer
                </button>
                <button
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                  onClick={handleDownload}
                >
                  Download PNG
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Frame picker modal — shown when user clicks "Add as Layer" */}
    {importCanvas && (
      <ImportFrameModal
        assetCanvas={importCanvas}
        assetName={extractName}
        config={state.config}
        onImport={layer => {
          dispatch({ type: 'ADD_LAYER', layer });
          dispatch({ type: 'SET_TAB', tab: 'composer' });
          setImportCanvas(null);
        }}
        onClose={() => setImportCanvas(null)}
      />
    )}

    {/* Layer frame picker — shown when user clicks "Pick Frame…" in Load from Layer */}
    {framePickerLayerId && (() => {
      const pickerLayer = state.layers.find(l => l.id === framePickerLayerId);
      if (!pickerLayer?.image) return null;
      return (
        <LayerFramePickerModal
          layer={pickerLayer}
          config={state.config}
          cache={cache}
          onPick={(dirRow, frameIdx) => loadLayerFrame(framePickerLayerId, dirRow, frameIdx)}
          onClose={() => setFramePickerLayerId(null)}
        />
      );
    })()}
    </>
  );
}

// ─── Layer Frame Picker Modal ─────────────────────────────────────────────────

interface LayerFramePickerModalProps {
  layer: import('../types').Layer;
  config: import('../types').ProjectConfig;
  cache: ColorShiftCache;
  onPick: (dirRow: number, frameIdx: number) => void;
  onClose: () => void;
}

function LayerFramePickerModal({ layer, config, cache, onPick, onClose }: LayerFramePickerModalProps) {
  const { directions, framesPerDirection, frameWidth, frameHeight } = config;
  const dirLabels = directions === 4 ? DIRECTIONS_4 : DIRECTIONS_8;

  const CELL_SIZE = Math.max(24, Math.min(48, Math.floor(400 / framesPerDirection)));
  // Render each frame thumbnail at a scale that fits CELL_SIZE
  const thumbScale = Math.min(1, (CELL_SIZE - 4) / Math.max(frameWidth, frameHeight));
  const thumbW = Math.round(frameWidth * thumbScale);
  const thumbH = Math.round(frameHeight * thumbScale);

  const [hoveredCell, setHoveredCell] = useState<{ dir: number; frame: number } | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-5" style={{ maxWidth: 600, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">
            Pick Frame from "{layer.name}"
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <p className="text-xs text-gray-400">
          Click a frame to load it into the Asset Splitter.
          {hoveredCell && (
            <span className="text-gray-300 ml-2">
              {dirLabels[hoveredCell.dir]} / frame {hoveredCell.frame + 1}
            </span>
          )}
        </p>

        {/* Frame grid */}
        <div className="overflow-auto">
          {/* Column header — frame numbers */}
          <div className="flex gap-0 mb-0.5" style={{ marginLeft: 56 }}>
            {Array.from({ length: framesPerDirection }, (_, f) => (
              <div
                key={f}
                className="text-gray-600 text-center flex-shrink-0"
                style={{ width: CELL_SIZE, fontSize: 9 }}
              >
                {f + 1}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="flex flex-col gap-0">
            {Array.from({ length: directions }, (_, d) => (
              <div key={d} className="flex items-center gap-0">
                {/* Direction label */}
                <span
                  className="text-gray-500 text-right flex-shrink-0 pr-1 capitalize"
                  style={{ width: 56, fontSize: 9 }}
                >
                  {dirLabels[d]}
                </span>

                {Array.from({ length: framesPerDirection }, (_, f) => (
                  <button
                    key={f}
                    onClick={() => onPick(d, f)}
                    onMouseEnter={() => setHoveredCell({ dir: d, frame: f })}
                    onMouseLeave={() => setHoveredCell(null)}
                    className="flex-shrink-0 border border-transparent hover:border-indigo-400 rounded-sm transition-colors relative"
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 6px 6px',
                    }}
                    title={`${dirLabels[d]} / frame ${f + 1}`}
                  >
                    <FrameThumb
                      layer={layer}
                      config={config}
                      cache={cache}
                      dirRow={d}
                      frameIdx={f}
                      thumbW={thumbW}
                      thumbH={thumbH}
                    />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end">
          <button onClick={onClose} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Renders a single frame thumbnail for the picker grid. */
function FrameThumb({ layer, config, cache, dirRow, frameIdx, thumbW, thumbH }: {
  layer: import('../types').Layer;
  config: import('../types').ProjectConfig;
  cache: ColorShiftCache;
  dirRow: number;
  frameIdx: number;
  thumbW: number;
  thumbH: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const src = document.createElement('canvas');
    src.width = config.frameWidth;
    src.height = config.frameHeight;
    compositeFrame(src, [layer], config, dirRow, frameIdx, cache);
    cv.width = thumbW;
    cv.height = thumbH;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, thumbW, thumbH);
  }, [layer, config, cache, dirRow, frameIdx, thumbW, thumbH]);

  return (
    <canvas
      ref={ref}
      className="block mx-auto"
      style={{ imageRendering: 'pixelated', width: thumbW, height: thumbH }}
    />
  );
}
