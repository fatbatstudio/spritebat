import React, { useRef, useState, useCallback } from 'react';
import type { Layer, LayerType, AppAction, ProjectConfig } from '../types';
import { NumericInput } from './NumericInput';
import { TileToSheetModal } from './TileToSheetModal';
import { ClearFramesModal } from './ClearFramesModal';
import { ColorShiftCache } from '../colorShift';
import { renderFullSheet } from '../compositing';

const LAYER_TYPES: LayerType[] = ['Base', 'Hair', 'Top', 'Bottom', 'Accessory', 'Hat', 'Weapon', 'Custom'];

const TYPE_COLORS: Record<LayerType, string> = {
  Base: '#6366f1',
  Hair: '#f59e0b',
  Top: '#10b981',
  Bottom: '#3b82f6',
  Accessory: '#ec4899',
  Hat: '#8b5cf6',
  Weapon: '#ef4444',
  Custom: '#6b7280',
};

interface LayersPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  config: ProjectConfig;
  dispatch: React.Dispatch<AppAction>;
  cache: ColorShiftCache;
  mobile?: boolean;
  onClose?: () => void;
}

export function LayersPanel({ layers, selectedLayerId, config, dispatch, cache, mobile, onClose }: LayersPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function createLayer(file: File): Promise<Layer> {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const lower = file.name.toLowerCase();
        let type: LayerType = 'Custom';
        for (const t of LAYER_TYPES) {
          if (lower.includes(t.toLowerCase())) { type = t; break; }
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          type,
          visible: true,
          opacity: 100,
          hsl: { hue: 0, saturation: 0, lightness: 0 },
          image: img,
          objectUrl,
          fileName: file.name,
          offsetX: 0,
          offsetY: 0,
          // Inherit the project's default input layout
          inputLayout: { ...config.defaultInputLayout },
        });
      };
      img.src = objectUrl;
    });
  }

  async function handleFiles(files: FileList) {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.type.includes('image')) continue;
      const layer = await createLayer(file);
      dispatch({ type: 'ADD_LAYER', layer });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  function onDragStart(e: React.DragEvent, index: number) {
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function onDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (draggingIndex !== null && draggingIndex !== toIndex) {
      dispatch({ type: 'REORDER_LAYERS', fromIndex: draggingIndex, toIndex });
    }
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function onDragEnd() {
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function handleMergeDown(index: number) {
    if (index < 1) return;
    const topLayer = layers[index];
    const bottomLayer = layers[index - 1];
    // Composite just these two layers into a full sheet
    const sheet = renderFullSheet([bottomLayer, topLayer], config, cache);
    sheet.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const mergedLayer: Layer = {
          id: crypto.randomUUID(),
          name: `${bottomLayer.name} + ${topLayer.name}`,
          type: bottomLayer.type,
          visible: true,
          opacity: 100,
          hsl: { hue: 0, saturation: 0, lightness: 0 },
          image: img,
          objectUrl,
          fileName: 'merged.png',
          offsetX: 0,
          offsetY: 0,
          inputLayout: { ...config.defaultInputLayout },
        };
        dispatch({ type: 'MERGE_LAYERS_DOWN', index, mergedLayer });
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  const reversedLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700" style={{ width: mobile ? '100%' : 240 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Layers</span>
        <div className="flex items-center gap-1.5">
          <button
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors"
            onClick={() => fileInputRef.current?.click()}
            title="Add layer from PNG file"
          >
            + Add
          </button>
          {mobile && onClose && (
            <button
              className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded transition-colors"
              onClick={onClose}
              title="Close panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        {layers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-xs text-center px-4 mt-4">
            <span className="text-2xl mb-2">🗂️</span>
            Drop PNG sprite sheets here or click Add
          </div>
        )}

        {reversedLayers.map((layer, reversedIndex) => {
          const index = layers.length - 1 - reversedIndex;
          const isSelected = layer.id === selectedLayerId;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={layer.id}
              className={`
                relative flex items-center gap-2 px-2 py-2 cursor-pointer select-none text-sm
                border-b border-gray-800
                ${isSelected ? 'bg-gray-700' : 'hover:bg-gray-800'}
                ${isDragOver ? 'border-t-2 border-t-indigo-500' : ''}
                ${draggingIndex === index ? 'opacity-40' : ''}
              `}
              onClick={() => dispatch({ type: 'SELECT_LAYER', id: layer.id })}
              draggable
              onDragStart={e => onDragStart(e, index)}
              onDragOver={e => onDragOver(e, index)}
              onDrop={e => onDrop(e, index)}
              onDragEnd={onDragEnd}
            >
              <span className="drag-handle text-gray-600 text-xs select-none" title="Drag to reorder">⠿</span>

              <span
                className="text-xs px-1 rounded font-bold flex-shrink-0"
                style={{ backgroundColor: TYPE_COLORS[layer.type] + '33', color: TYPE_COLORS[layer.type] }}
              >
                {layer.type.slice(0, 3)}
              </span>

              <span className="flex-1 truncate text-gray-200 text-xs" title={layer.name}>
                {layer.name}
              </span>

              {/* Layout badge */}
              <span className="text-gray-600 text-xs flex-shrink-0" title="Input layout (cols×rows)">
                {layer.inputLayout.cols}×{layer.inputLayout.rows}
              </span>

              <button
                className="text-gray-400 hover:text-white flex-shrink-0 text-sm"
                onClick={e => {
                  e.stopPropagation();
                  dispatch({ type: 'UPDATE_LAYER', id: layer.id, updates: { visible: !layer.visible } });
                }}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? '👁' : '🚫'}
              </button>

              {index > 0 && (
                <button
                  className="text-gray-600 hover:text-amber-400 flex-shrink-0 text-sm"
                  onClick={e => {
                    e.stopPropagation();
                    handleMergeDown(index);
                  }}
                  title="Merge down — composite this layer onto the one below"
                >
                  ⤵
                </button>
              )}

              <button
                className="text-gray-600 hover:text-red-400 flex-shrink-0 text-sm"
                onClick={e => {
                  e.stopPropagation();
                  dispatch({ type: 'REMOVE_LAYER', id: layer.id });
                }}
                title="Remove layer"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/*"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) { handleFiles(e.target.files); e.target.value = ''; } }}
      />
    </div>
  );
}

interface LayerPropertiesProps {
  layer: Layer | undefined;
  config: ProjectConfig;
  dispatch: React.Dispatch<AppAction>;
  cache: ColorShiftCache;
  frameOffsetMode: boolean;
  mobile?: boolean;
}

export function LayerProperties({ layer, config, dispatch, cache, frameOffsetMode, mobile }: LayerPropertiesProps) {
  const [showTileModal, setShowTileModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showHslModal, setShowHslModal] = useState(false);

  if (!layer) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs">
        Select a layer to edit properties
      </div>
    );
  }

  const LAYER_TYPES_LIST: LayerType[] = ['Base', 'Hair', 'Top', 'Bottom', 'Accessory', 'Hat', 'Weapon', 'Custom'];
  const total = config.directions * config.framesPerDirection;

  function update(updates: Partial<Layer>) {
    dispatch({ type: 'UPDATE_LAYER', id: layer!.id, updates });
  }

  /** Live feedback during drag — does NOT push an undo step */
  function updateTransient(updates: Partial<Layer>) {
    dispatch({ type: 'UPDATE_LAYER_TRANSIENT', id: layer!.id, updates });
  }

  const layoutOk = layer.inputLayout.cols * layer.inputLayout.rows >= total;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-1.5 ${mobile ? 'pb-3' : 'h-full'}`}>
      {/* Section 1: Layer identity */}
      <div className="flex items-start gap-3">
        {/* Name */}
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-400">Name</label>
          <input
            type="text"
            value={layer.name}
            onChange={e => update({ name: e.target.value })}
            className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-28"
          />
        </div>

        {/* Type */}
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-400">Type</label>
          <select
            value={layer.type}
            onChange={e => update({ type: e.target.value as LayerType })}
            className="bg-gray-800 border border-gray-600 text-white text-xs px-1 py-1 rounded"
          >
            {LAYER_TYPES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Input layout */}
        <div className="flex flex-col gap-0.5">
          <label className={`text-xs ${layoutOk ? 'text-gray-400' : 'text-red-400'}`}>
            Layout <span className="text-gray-600">(≥{total})</span>
          </label>
          <div className="flex items-center gap-1">
            <NumericInput
              value={layer.inputLayout.cols}
              min={1} max={total * 2}
              onChange={cols => update({ inputLayout: { cols, rows: layer.inputLayout.rows } })}
              className="bg-gray-800 border border-gray-600 text-white text-xs px-1 py-1 rounded w-10"
            />
            <span className="text-gray-600 text-xs">×</span>
            <NumericInput
              value={layer.inputLayout.rows}
              min={1} max={total * 2}
              onChange={rows => update({ inputLayout: { cols: layer.inputLayout.cols, rows } })}
              className="bg-gray-800 border border-gray-600 text-white text-xs px-1 py-1 rounded w-10"
            />
            <button
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1 py-1 rounded"
              onClick={() => update({ inputLayout: { ...config.defaultInputLayout } })}
              title="Reset to project default"
            >↺</button>
          </div>
        </div>
      </div>

      {/* Section 2: HSL + Adjust */}
      <div className="flex items-center gap-3">
        <div className="w-px self-stretch bg-gray-700" />

        {/* Hue */}
        <div className="flex flex-col gap-1.5" style={{ minWidth: 80 }}>
          <label className="text-xs text-gray-400">Hue <span className="text-gray-500">{layer.hsl.hue}°</span></label>
          <input
            type="range" min={-180} max={180} step={1}
            value={layer.hsl.hue}
            onPointerDown={() => dispatch({ type: 'SNAPSHOT' })}
            onChange={e => updateTransient({ hsl: { ...layer.hsl, hue: Number(e.target.value) } })}
          />
        </div>

        {/* Saturation */}
        <div className="flex flex-col gap-1.5" style={{ minWidth: 80 }}>
          <label className="text-xs text-gray-400">Sat <span className="text-gray-500">{layer.hsl.saturation}</span></label>
          <input
            type="range" min={-100} max={100} step={1}
            value={layer.hsl.saturation}
            onPointerDown={() => dispatch({ type: 'SNAPSHOT' })}
            onChange={e => updateTransient({ hsl: { ...layer.hsl, saturation: Number(e.target.value) } })}
          />
        </div>

        {/* Lightness */}
        <div className="flex flex-col gap-1.5" style={{ minWidth: 80 }}>
          <label className="text-xs text-gray-400">Light <span className="text-gray-500">{layer.hsl.lightness}</span></label>
          <input
            type="range" min={-100} max={100} step={1}
            value={layer.hsl.lightness}
            onPointerDown={() => dispatch({ type: 'SNAPSHOT' })}
            onChange={e => updateTransient({ hsl: { ...layer.hsl, lightness: Number(e.target.value) } })}
          />
        </div>

        {/* Opacity */}
        <div className="flex flex-col gap-1.5" style={{ minWidth: 80 }}>
          <label className="text-xs text-gray-400">Opacity <span className="text-gray-500">{layer.opacity}%</span></label>
          <input
            type="range" min={0} max={100} step={1}
            value={layer.opacity}
            onPointerDown={() => dispatch({ type: 'SNAPSHOT' })}
            onChange={e => updateTransient({ opacity: Number(e.target.value) })}
          />
        </div>

        {/* Adjust HSL — opens dialog for precise numeric input */}
        <button
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-1 rounded transition-colors"
          onClick={() => setShowHslModal(true)}
          title="Open dialog to enter precise HSL & opacity values"
        >
          Adjust
        </button>
      </div>

      {/* Section 3: Offset + action buttons */}
      <div className="flex items-center gap-2">
        <div className="w-px self-stretch bg-gray-700" />

        <label className="text-xs text-gray-400">Offset</label>
        <NumericInput
          value={layer.offsetX}
          min={-512} max={512}
          onChange={v => update({ offsetX: v })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-1 py-1 rounded w-12"
        />
        <NumericInput
          value={layer.offsetY}
          min={-512} max={512}
          onChange={v => update({ offsetY: v })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-1 py-1 rounded w-12"
        />
        <button
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1 py-1 rounded transition-colors"
          onClick={() => update({ offsetX: 0, offsetY: 0 })}
          title="Reset position to 0,0"
        >↺</button>

        <button
          className="text-xs bg-violet-700 hover:bg-violet-600 text-white px-2 py-1 rounded transition-colors whitespace-nowrap"
          onClick={() => setShowTileModal(true)}
          title="Stamp this image across multiple frames/directions to build a full sheet"
        >
          ⊞ Tile
        </button>

        <button
          className="text-xs bg-gray-700 hover:bg-red-900 hover:text-red-300 text-gray-300 px-2 py-1 rounded transition-colors whitespace-nowrap"
          onClick={() => setShowClearModal(true)}
          title="Erase selected frame cells to transparent"
          disabled={!layer.image}
        >
          ✂ Clear
        </button>

        {layer.frameOffsets?.some(o => o.x !== 0 || o.y !== 0) && (
          <span className="text-amber-400 text-xs leading-none">●</span>
        )}
        <button
          className={`text-xs px-2 py-1 rounded transition-colors whitespace-nowrap ${
            frameOffsetMode
              ? 'bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          onClick={() => dispatch({ type: 'SET_FRAME_OFFSET_MODE', active: !frameOffsetMode })}
          title="Toggle frame offset drag mode — drag the canvas to nudge this layer per frame"
        >
          ↕ Offsets
        </button>
        {layer.frameOffsets?.some(o => o.x !== 0 || o.y !== 0) && (
          <button
            className="text-xs px-1.5 py-1 rounded bg-gray-700 hover:bg-red-900 text-gray-400 hover:text-red-300 transition-colors"
            onClick={() => update({ frameOffsets: undefined })}
            title="Clear all frame offsets"
          >✕</button>
        )}
      </div>

      {/* Tile to Sheet modal */}
      {showTileModal && layer.image && (
        <TileToSheetModal
          layer={layer}
          config={config}
          onApply={(newImage, newObjectUrl) => {
            // Invalidate color shift cache for this layer
            cache.invalidate(layer.id);
            // Update the layer with the new full sheet image + matching layout.
            // Reset offset and frameOffsets to 0 — the tiled sheet already has the
            // sprite placed correctly within each cell, so old offsets would double-shift it.
            update({
              image: newImage,
              objectUrl: newObjectUrl,
              inputLayout: { ...config.defaultInputLayout },
              offsetX: 0,
              offsetY: 0,
              frameOffsets: undefined,
            });
            setShowTileModal(false);
          }}
          onClose={() => setShowTileModal(false)}
        />
      )}

      {/* Clear Frames modal */}
      {showClearModal && layer.image && (
        <ClearFramesModal
          layer={layer}
          config={config}
          onApply={(newImage, newObjectUrl) => {
            cache.invalidate(layer.id);
            update({ image: newImage, objectUrl: newObjectUrl });
            setShowClearModal(false);
          }}
          onClose={() => setShowClearModal(false)}
        />
      )}

      {/* HSL & Opacity dialog */}
      {showHslModal && (
        <HslDialog
          hsl={layer.hsl}
          opacity={layer.opacity}
          onUpdate={updates => update(updates)}
          onTransientUpdate={updates => updateTransient(updates)}
          onSnapshot={() => dispatch({ type: 'SNAPSHOT' })}
          onClose={() => setShowHslModal(false)}
          mobile={mobile}
        />
      )}

    </div>
  );
}

// ── HSL & Opacity Dialog ────────────────────────────────────────────────────

interface HslDialogProps {
  hsl: { hue: number; saturation: number; lightness: number };
  opacity: number;
  onUpdate: (updates: Partial<Layer>) => void;
  onTransientUpdate: (updates: Partial<Layer>) => void;
  onSnapshot: () => void;
  onClose: () => void;
  mobile?: boolean;
}

function HslDialog({ hsl, opacity, onUpdate, onTransientUpdate, onSnapshot, onClose, mobile }: HslDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);

  // Position the panel centered-ish on first render
  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    if (node && !initialized) {
      const rect = node.getBoundingClientRect();
      setPos({
        x: Math.round((window.innerWidth - rect.width) / 2),
        y: Math.max(40, Math.round((window.innerHeight - rect.height) / 2 - 100)),
      });
      setInitialized(true);
    }
    (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [initialized]);

  function onDragStart(e: React.PointerEvent) {
    // Only drag from the title bar area
    if ((e.target as HTMLElement).closest('input, button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }

  function onDragEnd() {
    dragRef.current = null;
  }

  const sliderContent = (
    <div className="flex flex-col gap-3 p-4">
      {/* Hue */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Hue (-180 to 180)</label>
        <div className="flex items-center gap-2">
          <input
            type="range" min={-180} max={180} step={1}
            value={hsl.hue}
            onPointerDown={onSnapshot}
            onChange={e => onTransientUpdate({ hsl: { ...hsl, hue: Number(e.target.value) } })}
            className="flex-1"
          />
          <NumericInput
            value={hsl.hue}
            min={-180} max={180}
            onChange={v => onUpdate({ hsl: { ...hsl, hue: v } })}
            className="bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16 text-right"
          />
        </div>
      </div>

      {/* Saturation */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Saturation (-100 to 100)</label>
        <div className="flex items-center gap-2">
          <input
            type="range" min={-100} max={100} step={1}
            value={hsl.saturation}
            onPointerDown={onSnapshot}
            onChange={e => onTransientUpdate({ hsl: { ...hsl, saturation: Number(e.target.value) } })}
            className="flex-1"
          />
          <NumericInput
            value={hsl.saturation}
            min={-100} max={100}
            onChange={v => onUpdate({ hsl: { ...hsl, saturation: v } })}
            className="bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16 text-right"
          />
        </div>
      </div>

      {/* Lightness */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Lightness (-100 to 100)</label>
        <div className="flex items-center gap-2">
          <input
            type="range" min={-100} max={100} step={1}
            value={hsl.lightness}
            onPointerDown={onSnapshot}
            onChange={e => onTransientUpdate({ hsl: { ...hsl, lightness: Number(e.target.value) } })}
            className="flex-1"
          />
          <NumericInput
            value={hsl.lightness}
            min={-100} max={100}
            onChange={v => onUpdate({ hsl: { ...hsl, lightness: v } })}
            className="bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16 text-right"
          />
        </div>
      </div>

      {/* Opacity */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Opacity (0 to 100%)</label>
        <div className="flex items-center gap-2">
          <input
            type="range" min={0} max={100} step={1}
            value={opacity}
            onPointerDown={onSnapshot}
            onChange={e => onTransientUpdate({ opacity: Number(e.target.value) })}
            className="flex-1"
          />
          <NumericInput
            value={opacity}
            min={0} max={100}
            onChange={v => onUpdate({ opacity: v })}
            className="bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16 text-right"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-1">
        <button
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded transition-colors"
          onClick={() => onUpdate({ hsl: { hue: 0, saturation: 0, lightness: 0 }, opacity: 100 })}
        >
          Reset All
        </button>
        <button
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );

  // Mobile: bottom sheet
  if (mobile) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end bg-black/40"
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-gray-800 border-t border-gray-600 rounded-t-xl max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">HSL & Opacity</h3>
            <button className="text-gray-500 hover:text-white text-sm leading-none" onClick={onClose}>✕</button>
          </div>
          {sliderContent}
        </div>
      </div>
    );
  }

  // Desktop: draggable floating panel
  return (
    <div
      ref={measuredRef}
      className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-72"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Draggable title bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-gray-700 cursor-move select-none rounded-t-lg bg-gray-750"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">HSL & Opacity</h3>
        <button
          className="text-gray-500 hover:text-white text-sm leading-none"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>
      {sliderContent}
    </div>
  );
}
