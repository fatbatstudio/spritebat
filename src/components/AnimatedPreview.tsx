import React, { useRef, useEffect, useCallback } from 'react';
import type { AppState, AppAction, Direction, PlaybackMode } from '../types';
import { DIRECTIONS_4, DIRECTIONS_8 } from '../types';
import { ColorShiftCache } from '../colorShift';
import { compositeFrame } from '../compositing';
import { getDirectionRow } from '../state';

interface AnimatedPreviewProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  cache: ColorShiftCache;
}

const MODE_LABELS: Record<PlaybackMode, string> = {
  forward:  '▶ Forward',
  reverse:  '◀ Reverse',
  pingpong: '⇄ Ping-pong',
};

export function AnimatedPreview({ state, dispatch, cache }: AnimatedPreviewProps) {
  const {
    layers, config, previewDirection, previewFrame, previewPlaying,
    previewMode, previewFps, previewZoom
  } = state;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Ping-pong needs its own step direction (+1 / -1) tracked in a ref
  // so it persists across renders without being part of shared state.
  const ppDirRef = useRef<1 | -1>(1);

  const dirRow = getDirectionRow(previewDirection, config.directions);
  const totalFrames = config.framesPerDirection;
  const directions: Direction[] = config.directions === 4 ? [...DIRECTIONS_4] : [...DIRECTIONS_8];

  // Draw current frame
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = config.frameWidth;
    canvas.height = config.frameHeight;
    compositeFrame(canvas, layers, config, dirRow, previewFrame, cache);
  }, [layers, config, dirRow, previewFrame, cache]);

  useEffect(() => { drawFrame(); }, [drawFrame]);

  // Reset ping-pong direction whenever playback starts fresh or mode changes
  useEffect(() => {
    ppDirRef.current = previewMode === 'reverse' ? -1 : 1;
  }, [previewMode, previewPlaying]);

  // Animation loop
  useEffect(() => {
    if (!previewPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const interval = 1000 / previewFps;

    function tick(time: number) {
      if (time - lastTimeRef.current >= interval) {
        lastTimeRef.current = time;

        let next: number;
        if (previewMode === 'forward') {
          next = (previewFrame + 1) % totalFrames;
        } else if (previewMode === 'reverse') {
          next = (previewFrame - 1 + totalFrames) % totalFrames;
        } else {
          // Ping-pong: bounce at ends
          next = previewFrame + ppDirRef.current;
          if (next >= totalFrames) {
            next = totalFrames - 2;
            ppDirRef.current = -1;
          } else if (next < 0) {
            next = 1;
            ppDirRef.current = 1;
          }
        }

        dispatch({ type: 'SET_PREVIEW_FRAME', frame: next });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [previewPlaying, previewFps, previewFrame, previewMode, totalFrames, dispatch]);

  const displaySize = config.frameWidth * previewZoom;
  const displayHeight = config.frameHeight * previewZoom;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700" style={{ width: 260 }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Preview</span>
      </div>

      <div className="flex flex-col items-center gap-3 p-3 overflow-y-auto flex-1">
        {/* Canvas */}
        <div
          className="border border-gray-700 rounded flex-shrink-0"
          style={{
            width: displaySize,
            height: displayHeight,
            background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
            maxWidth: '100%',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: displaySize, height: displayHeight, maxWidth: '100%' }}
          />
        </div>

        {/* Direction selector */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-gray-400">Direction</label>
          <div className={`grid gap-1 ${config.directions === 4 ? 'grid-cols-2' : 'grid-cols-4'}`}>
            {directions.map(d => (
              <button
                key={d}
                onClick={() => dispatch({ type: 'SET_PREVIEW_DIRECTION', direction: d })}
                className={`text-xs py-1 px-1 rounded capitalize ${
                  previewDirection === d
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Playback mode */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-gray-400">Playback Mode</label>
          <div className="flex flex-col gap-1">
            {(['forward', 'reverse', 'pingpong'] as PlaybackMode[]).map(m => (
              <button
                key={m}
                onClick={() => dispatch({ type: 'SET_PREVIEW_MODE', mode: m })}
                className={`text-xs py-1 rounded ${
                  previewMode === m
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-2 w-full">
          <button
            onClick={() => dispatch({ type: 'SET_PREVIEW_FRAME', frame: (previewFrame - 1 + totalFrames) % totalFrames })}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
            title="Previous frame"
          >
            ◀
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_PREVIEW_PLAYING', playing: !previewPlaying })}
            className={`flex-1 text-xs py-1 rounded font-bold ${
              previewPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-green-700 hover:bg-green-600 text-white'
            }`}
          >
            {previewPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_PREVIEW_FRAME', frame: (previewFrame + 1) % totalFrames })}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
            title="Next frame"
          >
            ▶
          </button>
        </div>

        {/* Frame indicator */}
        <div className="flex gap-1 flex-wrap justify-center">
          {Array.from({ length: totalFrames }).map((_, i) => (
            <button
              key={i}
              onClick={() => {
                dispatch({ type: 'SET_PREVIEW_PLAYING', playing: false });
                dispatch({ type: 'SET_PREVIEW_FRAME', frame: i });
              }}
              className={`w-5 h-5 text-xs rounded ${
                i === previewFrame
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* FPS */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-gray-400">Speed: {previewFps} FPS</label>
          <input
            type="range" min={1} max={30} step={1}
            value={previewFps}
            onChange={e => dispatch({ type: 'SET_PREVIEW_FPS', fps: Number(e.target.value) })}
          />
        </div>

        {/* Zoom */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-gray-400">Zoom</label>
          <div className="flex gap-1">
            {[1, 2, 4, 8].map(z => (
              <button
                key={z}
                onClick={() => dispatch({ type: 'SET_PREVIEW_ZOOM', zoom: z })}
                className={`flex-1 text-xs py-1 rounded ${
                  previewZoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
