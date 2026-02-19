import { useState } from 'react';
import type { Layer, ProjectConfig } from '../types';
import { NumericInput } from './NumericInput';

interface Props {
  layer: Layer;
  config: ProjectConfig;
  onApply: (frameOffsets: Array<{ x: number; y: number }>) => void;
  onClose: () => void;
}

export function FrameOffsetsModal({ layer, config, onApply, onClose }: Props) {
  const { framesPerDirection } = config;

  // Initialise local state from existing frameOffsets, defaulting to 0,0 for each frame
  const [offsets, setOffsets] = useState<Array<{ x: number; y: number }>>(() =>
    Array.from({ length: framesPerDirection }, (_, i) => ({
      x: layer.frameOffsets?.[i]?.x ?? 0,
      y: layer.frameOffsets?.[i]?.y ?? 0,
    }))
  );

  function setFrame(index: number, axis: 'x' | 'y', value: number) {
    setOffsets(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [axis]: value };
      return next;
    });
  }

  function handleClearAll() {
    setOffsets(Array.from({ length: framesPerDirection }, () => ({ x: 0, y: 0 })));
  }

  function handleApply() {
    onApply(offsets);
  }

  const hasAny = offsets.some(o => o.x !== 0 || o.y !== 0);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onMouseDown={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 flex flex-col gap-5 overflow-y-auto"
        style={{ width: 420, maxHeight: '85vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Per-Frame Offsets</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Nudge "<span className="text-gray-300">{layer.name}</span>" per frame — useful for bobbing animations.
              <br />
              Added on top of the layer's global offset ({layer.offsetX},{layer.offsetY}).
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Frame offset table */}
        <div className="flex flex-col gap-0.5">
          <div className="grid grid-cols-3 gap-x-2 px-1 mb-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Frame</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">X</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Y</span>
          </div>

          <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 320 }}>
            {offsets.map((off, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 gap-x-2 items-center px-1 py-0.5 rounded ${
                  off.x !== 0 || off.y !== 0 ? 'bg-indigo-950/40' : 'hover:bg-gray-800/40'
                }`}
              >
                <span className="text-xs text-gray-400">
                  Frame {i + 1}
                  {(off.x !== 0 || off.y !== 0) && (
                    <span className="ml-1 text-indigo-400 text-xs">●</span>
                  )}
                </span>
                <NumericInput
                  value={off.x}
                  min={-512}
                  max={512}
                  onChange={v => setFrame(i, 'x', v)}
                  className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-full text-center"
                />
                <NumericInput
                  value={off.y}
                  min={-512}
                  max={512}
                  onChange={v => setFrame(i, 'y', v)}
                  className="bg-gray-800 border border-gray-600 text-white text-xs px-2 py-1 rounded w-full text-center"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Hint */}
        <p className="text-xs text-gray-600">
          X+ = right, Y+ = down. These are applied at render time; no image data is changed until you use "Tile to Sheet".
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleClearAll}
            disabled={!hasAny}
            className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded transition-colors"
          >
            Clear All
          </button>
          <button
            onClick={onClose}
            className="flex-1 text-sm py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 text-sm py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
