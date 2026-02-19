import React, { useRef, useState } from 'react';
import type { Layer, LayerType, AppAction, ProjectConfig } from '../types';
import { NumericInput } from './NumericInput';
import { TileToSheetModal } from './TileToSheetModal';
import { ColorShiftCache } from '../colorShift';

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
}

export function LayersPanel({ layers, selectedLayerId, config, dispatch }: LayersPanelProps) {
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

  const reversedLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700" style={{ width: 240 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Layers</span>
        <button
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors"
          onClick={() => fileInputRef.current?.click()}
          title="Add layer from PNG file"
        >
          + Add
        </button>
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

              <button
                className="text-gray-600 hover:text-red-400 flex-shrink-0 text-sm"
                onClick={e => {
                  e.stopPropagation();
                  if (layer.objectUrl) URL.revokeObjectURL(layer.objectUrl);
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
        onChange={e => e.target.files && handleFiles(e.target.files)}
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
}

export function LayerProperties({ layer, config, dispatch, cache, frameOffsetMode }: LayerPropertiesProps) {
  const [showTileModal, setShowTileModal] = useState(false);

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
    <div className="flex items-center gap-4 px-4 h-full overflow-x-auto">
      {/* Name */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">Name</label>
        <input
          type="text"
          value={layer.name}
          onChange={e => update({ name: e.target.value })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-32"
        />
      </div>

      {/* Type */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">Type</label>
        <select
          value={layer.type}
          onChange={e => update({ type: e.target.value as LayerType })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded"
        >
          {LAYER_TYPES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-gray-700 flex-shrink-0" />

      {/* Input layout */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className={`text-xs ${layoutOk ? 'text-gray-400' : 'text-red-400'}`}>
          Input layout <span className="text-gray-600">(cols×rows needs ≥{total} cells)</span>
        </label>
        <div className="flex items-center gap-1">
          <NumericInput
            value={layer.inputLayout.cols}
            min={1} max={total * 2}
            onChange={cols => update({ inputLayout: { cols, rows: layer.inputLayout.rows } })}
            className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-12"
          />
          <span className="text-gray-600 text-xs">×</span>
          <NumericInput
            value={layer.inputLayout.rows}
            min={1} max={total * 2}
            onChange={rows => update({ inputLayout: { cols: layer.inputLayout.cols, rows } })}
            className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-12"
          />
          <button
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1.5 py-1 rounded ml-1"
            onClick={() => update({ inputLayout: { ...config.defaultInputLayout } })}
            title="Reset to project default"
          >↺</button>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-gray-700 flex-shrink-0" />

      {/* Hue */}
      <div className="flex flex-col gap-1 flex-shrink-0" style={{ minWidth: 120 }}>
        <label className="text-xs text-gray-400">Hue <span className="text-gray-500">{layer.hsl.hue}°</span></label>
        <input
          type="range" min={-180} max={180} step={1}
          value={layer.hsl.hue}
          onChange={e => updateTransient({ hsl: { ...layer.hsl, hue: Number(e.target.value) } })}
          onPointerUp={e => update({ hsl: { ...layer.hsl, hue: Number((e.target as HTMLInputElement).value) } })}
        />
      </div>

      {/* Saturation */}
      <div className="flex flex-col gap-1 flex-shrink-0" style={{ minWidth: 120 }}>
        <label className="text-xs text-gray-400">Sat <span className="text-gray-500">{layer.hsl.saturation}</span></label>
        <input
          type="range" min={-100} max={100} step={1}
          value={layer.hsl.saturation}
          onChange={e => updateTransient({ hsl: { ...layer.hsl, saturation: Number(e.target.value) } })}
          onPointerUp={e => update({ hsl: { ...layer.hsl, saturation: Number((e.target as HTMLInputElement).value) } })}
        />
      </div>

      {/* Lightness */}
      <div className="flex flex-col gap-1 flex-shrink-0" style={{ minWidth: 120 }}>
        <label className="text-xs text-gray-400">Light <span className="text-gray-500">{layer.hsl.lightness}</span></label>
        <input
          type="range" min={-100} max={100} step={1}
          value={layer.hsl.lightness}
          onChange={e => updateTransient({ hsl: { ...layer.hsl, lightness: Number(e.target.value) } })}
          onPointerUp={e => update({ hsl: { ...layer.hsl, lightness: Number((e.target as HTMLInputElement).value) } })}
        />
      </div>

      {/* Opacity */}
      <div className="flex flex-col gap-1 flex-shrink-0" style={{ minWidth: 120 }}>
        <label className="text-xs text-gray-400">Opacity <span className="text-gray-500">{layer.opacity}%</span></label>
        <input
          type="range" min={0} max={100} step={1}
          value={layer.opacity}
          onChange={e => updateTransient({ opacity: Number(e.target.value) })}
          onPointerUp={e => update({ opacity: Number((e.target as HTMLInputElement).value) })}
        />
      </div>

      {/* Offset X */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">Offset X <span className="text-gray-500">{layer.offsetX}px</span></label>
        <NumericInput
          value={layer.offsetX}
          min={-512} max={512}
          onChange={v => update({ offsetX: v })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16"
        />
      </div>

      {/* Offset Y */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">Offset Y <span className="text-gray-500">{layer.offsetY}px</span></label>
        <NumericInput
          value={layer.offsetY}
          min={-512} max={512}
          onChange={v => update({ offsetY: v })}
          className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-16"
        />
      </div>

      {/* Reset offset */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">&nbsp;</label>
        <button
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
          onClick={() => update({ offsetX: 0, offsetY: 0 })}
          title="Reset position to 0,0"
        >
          Reset pos
        </button>
      </div>

      {/* Reset HSL */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">&nbsp;</label>
        <button
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
          onClick={() => update({ hsl: { hue: 0, saturation: 0, lightness: 0 } })}
        >
          Reset HSL
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-gray-700 flex-shrink-0" />

      {/* Tile to Sheet */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">Duplicate</label>
        <button
          className="text-xs bg-violet-700 hover:bg-violet-600 text-white px-2 py-1 rounded transition-colors whitespace-nowrap"
          onClick={() => setShowTileModal(true)}
          title="Stamp this image across multiple frames/directions to build a full sheet"
        >
          ⊞ Tile to Sheet
        </button>
      </div>

      {/* Frame Offset Mode toggle */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <label className="text-xs text-gray-400">
          Animate
          {layer.frameOffsets?.some(o => o.x !== 0 || o.y !== 0) && (
            <span className="ml-1 text-amber-400">●</span>
          )}
        </label>
        <div className="flex gap-1">
          <button
            className={`text-xs px-2 py-1 rounded transition-colors whitespace-nowrap ${
              frameOffsetMode
                ? 'bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            onClick={() => dispatch({ type: 'SET_FRAME_OFFSET_MODE', active: !frameOffsetMode })}
            title="Toggle frame offset drag mode — drag the canvas to nudge this layer per frame"
          >
            ↕ Frame Offsets
          </button>
          {layer.frameOffsets?.some(o => o.x !== 0 || o.y !== 0) && (
            <button
              className="text-xs px-1.5 py-1 rounded bg-gray-700 hover:bg-red-900 text-gray-400 hover:text-red-300 transition-colors"
              onClick={() => update({ frameOffsets: undefined })}
              title="Clear all frame offsets"
            >✕</button>
          )}
        </div>
      </div>

      {/* Tile to Sheet modal */}
      {showTileModal && layer.image && (
        <TileToSheetModal
          layer={layer}
          config={config}
          onApply={(newImage, newObjectUrl) => {
            // Revoke old object URL
            if (layer.objectUrl) URL.revokeObjectURL(layer.objectUrl);
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

    </div>
  );
}
