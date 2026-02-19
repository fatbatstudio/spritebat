import { useRef, useEffect, useState } from 'react';
import type { Layer, ProjectConfig } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { tileToSheet } from '../compositing';

interface Props {
  layer: Layer;
  config: ProjectConfig;
  onApply: (newImage: HTMLImageElement, newObjectUrl: string) => void;
  onClose: () => void;
}

type DirScope = 'all' | 'pick';
type FrameScope = 'all' | 'pick';

export function TileToSheetModal({ layer, config, onApply, onClose }: Props) {
  const { directions, framesPerDirection, frameWidth, frameHeight, defaultInputLayout } = config;
  const dirLabels = directions === 4 ? DIRECTIONS_4 : DIRECTIONS_8;

  // Which direction rows to fill
  const [dirScope, setDirScope] = useState<DirScope>('all');
  const [selectedDirs, setSelectedDirs] = useState<number[]>([0]);

  // Which frame indices to fill
  const [frameScope, setFrameScope] = useState<FrameScope>('all');
  const [selectedFrames, setSelectedFrames] = useState<number[]>([0]);

  // Preview canvas
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Compute the tiled sheet and draw it into the preview canvas
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !layer.image) return;

    // Build a temporary source canvas from the layer image
    const src = document.createElement('canvas');
    src.width  = layer.image.naturalWidth;
    src.height = layer.image.naturalHeight;
    src.getContext('2d')!.drawImage(layer.image, 0, 0);

    const dirMask   = dirScope   === 'all' ? null : selectedDirs;
    const frameMask = frameScope === 'all' ? null : selectedFrames;
    // Bake the layer's current offset + per-frame offsets into the sheet so they can be reset to 0 after
    const result = tileToSheet(src, config, dirMask, frameMask, layer.offsetX, layer.offsetY, layer.frameOffsets);

    // Size preview proportionally, max 480px wide
    const maxW = 480;
    const scale = Math.min(4, maxW / result.width);
    canvas.width  = result.width;
    canvas.height = result.height;
    canvas.style.width  = result.width  * scale + 'px';
    canvas.style.height = result.height * scale + 'px';
    canvas.getContext('2d')!.drawImage(result, 0, 0);
  }, [layer, config, dirScope, selectedDirs, frameScope, selectedFrames]);

  function toggleDir(idx: number) {
    setSelectedDirs(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx]
    );
  }

  function toggleFrame(idx: number) {
    setSelectedFrames(prev =>
      prev.includes(idx) ? prev.filter(f => f !== idx) : [...prev, idx]
    );
  }

  function handleApply() {
    if (!layer.image) return;

    const src = document.createElement('canvas');
    src.width  = layer.image.naturalWidth;
    src.height = layer.image.naturalHeight;
    src.getContext('2d')!.drawImage(layer.image, 0, 0);

    const dirMask   = dirScope   === 'all' ? null : selectedDirs;
    const frameMask = frameScope === 'all' ? null : selectedFrames;
    const result = tileToSheet(src, config, dirMask, frameMask, layer.offsetX, layer.offsetY, layer.frameOffsets);

    result.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => onApply(img, objectUrl);
      img.src = objectUrl;
    }, 'image/png');
  }

  const sheetW = defaultInputLayout.cols * frameWidth;
  const sheetH = defaultInputLayout.rows * frameHeight;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onMouseDown={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 flex flex-col gap-5 overflow-y-auto"
        style={{ width: 560, maxHeight: '90vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Tile to Sheet</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Stamp "<span className="text-gray-300">{layer.name}</span>" into a full{' '}
              {defaultInputLayout.cols}×{defaultInputLayout.rows} sheet ({sheetW}×{sheetH}px)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Direction scope */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Directions to fill</span>
          <div className="flex gap-2">
            <button
              onClick={() => setDirScope('all')}
              className={`text-xs px-3 py-1.5 rounded ${dirScope === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              All directions
            </button>
            <button
              onClick={() => setDirScope('pick')}
              className={`text-xs px-3 py-1.5 rounded ${dirScope === 'pick' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              Pick directions…
            </button>
          </div>
          {dirScope === 'pick' && (
            <div className={`grid gap-1 ${directions === 4 ? 'grid-cols-4' : 'grid-cols-4'}`}>
              {dirLabels.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDir(i)}
                  className={`text-xs py-1 rounded capitalize ${
                    selectedDirs.includes(i)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Frame scope */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Frames to fill</span>
          <div className="flex gap-2">
            <button
              onClick={() => setFrameScope('all')}
              className={`text-xs px-3 py-1.5 rounded ${frameScope === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              All frames
            </button>
            <button
              onClick={() => setFrameScope('pick')}
              className={`text-xs px-3 py-1.5 rounded ${frameScope === 'pick' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              Pick frames…
            </button>
          </div>
          {frameScope === 'pick' && (
            <div className="flex gap-1 flex-wrap">
              {Array.from({ length: framesPerDirection }, (_, i) => (
                <button
                  key={i}
                  onClick={() => toggleFrame(i)}
                  className={`w-7 h-7 text-xs rounded ${
                    selectedFrames.includes(i)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Preview <span className="text-gray-600 normal-case font-normal">(output sheet at {defaultInputLayout.cols}×{defaultInputLayout.rows} layout)</span>
          </span>
          <div
            className="border border-gray-700 rounded overflow-auto"
            style={{
              background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
              maxHeight: 280,
            }}
          >
            <canvas
              ref={previewRef}
              style={{ display: 'block', imageRendering: 'pixelated' }}
            />
          </div>
          <p className="text-xs text-gray-600">
            Your image ({layer.image?.naturalWidth}×{layer.image?.naturalHeight}px) will be placed at its natural size with the current offset ({layer.offsetX},{layer.offsetY}) baked in. The layer offset will be reset to 0,0 after. Empty cells stay transparent.
            Output layout: {defaultInputLayout.cols}×{defaultInputLayout.rows}.
          </p>
        </div>

        {/* Validation */}
        {dirScope === 'pick' && selectedDirs.length === 0 && (
          <p className="text-xs text-amber-400">⚠ Select at least one direction.</p>
        )}
        {frameScope === 'pick' && selectedFrames.length === 0 && (
          <p className="text-xs text-amber-400">⚠ Select at least one frame.</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 text-sm py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={
              (dirScope === 'pick' && selectedDirs.length === 0) ||
              (frameScope === 'pick' && selectedFrames.length === 0)
            }
            className="flex-1 text-sm py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-bold"
          >
            Apply to Layer
          </button>
        </div>
      </div>
    </div>
  );
}
