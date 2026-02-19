import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { initialState } from './state';
import { loadPersistedState, savePersistedState } from './persist';
import { saveProject, loadProject } from './project';
import { undoRedoReducer, buildUndoRedoState } from './undoRedo';
import type { UndoRedoAction } from './undoRedo';
import type { AppState } from './types';
import { ColorShiftCache } from './colorShift';
import { LayersPanel, LayerProperties } from './components/LayersPanel';
import { MainCanvas } from './components/MainCanvas';
import { AssetSplitter } from './components/AssetSplitter';
import { AnimatedPreview } from './components/AnimatedPreview';
import { ProjectConfigModal } from './components/ProjectConfig';
import { ExportBar } from './components/ExportBar';
import { LibraryTab } from './components/LibraryTab';

// Global color shift cache — persists across renders
const globalCache = new ColorShiftCache();

// Merge persisted prefs over the hardcoded initialState so the user's
// last config survives a page refresh or Vite HMR full-reload.
function buildInitialState(): AppState {
  const saved = loadPersistedState();
  return {
    ...initialState,
    ...(saved.config       && { config:       saved.config }),
    ...(saved.previewMode  && { previewMode:  saved.previewMode }),
    ...(saved.previewFps   && { previewFps:   saved.previewFps }),
    ...(saved.previewZoom  && { previewZoom:  saved.previewZoom }),
    ...(saved.canvasZoom   && { canvasZoom:   saved.canvasZoom }),
    ...(saved.sheetZoom    && { sheetZoom:    saved.sheetZoom }),
    ...(saved.activeTab    && { activeTab:    saved.activeTab }),
  };
}

function App() {
  const [undoState, dispatch] = useReducer(
    undoRedoReducer,
    undefined,
    () => buildUndoRedoState(buildInitialState())
  );

  // Convenient alias — the rest of the component works against AppState as before
  const state = undoState.present;
  const canUndo = undoState.past.length > 0;
  const canRedo = undoState.future.length > 0;

  // Typed dispatch so callers can still pass plain AppActions
  const typedDispatch = dispatch as React.Dispatch<UndoRedoAction>;

  // Persist config + UI prefs whenever they change
  useEffect(() => {
    savePersistedState({
      config:      state.config,
      previewMode: state.previewMode,
      previewFps:  state.previewFps,
      previewZoom: state.previewZoom,
      canvasZoom:  state.canvasZoom,
      sheetZoom:   state.sheetZoom,
      activeTab:   state.activeTab,
    });
  }, [
    state.config,
    state.previewMode,
    state.previewFps,
    state.previewZoom,
    state.canvasZoom,
    state.sheetZoom,
    state.activeTab,
  ]);

  const selectedLayer = state.layers.find(l => l.id === state.selectedLayerId);

  // ── Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z ───────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      typedDispatch({ type: 'UNDO' });
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      typedDispatch({ type: 'REDO' });
    }
  }, [typedDispatch]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── About dialog ───────────────────────────────────────────────────────────
  const [showAbout, setShowAbout] = useState(false);

  // ── Project save / load ────────────────────────────────────────────────────
  const [projectBusy, setProjectBusy] = useState<'saving' | 'loading' | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    setProjectBusy('saving');
    setProjectError(null);
    try {
      await saveProject(state);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setProjectBusy(null);
    }
  }

  function handleClose() {
    if (state.layers.length === 0) {
      // Nothing to lose — close immediately
      typedDispatch({ type: 'CLOSE_PROJECT' });
      globalCache.clear();
      return;
    }
    if (window.confirm('Close project? Any unsaved changes will be lost.')) {
      typedDispatch({ type: 'CLOSE_PROJECT' });
      globalCache.clear();
    }
  }

  async function handleLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-opened if needed
    e.target.value = '';
    setProjectBusy('loading');
    setProjectError(null);
    try {
      const project = await loadProject(file);
      typedDispatch({
        type:             'LOAD_PROJECT',
        config:           project.config,
        layers:           project.layers,
        selectedLayerId:  project.ui.selectedLayerId,
        previewDirection: project.ui.previewDirection,
        previewFrame:     project.ui.previewFrame,
        previewMode:      project.ui.previewMode,
        previewFps:       project.ui.previewFps,
        previewZoom:      project.ui.previewZoom,
        canvasZoom:       project.ui.canvasZoom,
        sheetZoom:        project.ui.sheetZoom,
        activeTab:        project.ui.activeTab,
        library:          project.library,
      });
      // Invalidate cached colour-shifted images from the old session
      globalCache.clear();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setProjectBusy(null);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden select-none">
      {/* ── Top header bar ── */}
      <header className="relative flex items-center px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-indigo-400 text-sm tracking-wide flex items-center gap-1"><img src="/bat-emoji.png" alt="🦇" className="w-5 h-5" style={{ imageRendering: 'auto' }} /> SpriteBat</span>
          <span className="text-gray-600 text-xs">v1.0</span>
          <a href="https://eidolware.com/about/" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-400 text-xs transition-colors">by FATBAT Studio</a>
          <button
            onClick={() => setShowAbout(true)}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
            title="About SpriteBat"
          >
            ? About
          </button>
        </div>

        {/* Tab switcher — absolutely centred so it's always in the middle of the bar */}
        <div className="absolute left-1/2 -translate-x-1/2 flex gap-1 bg-gray-800 p-0.5 rounded">
          <button
            onClick={() => typedDispatch({ type: 'SET_TAB', tab: 'composer' })}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              state.activeTab === 'composer'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Composer
          </button>
          <button
            onClick={() => typedDispatch({ type: 'SET_TAB', tab: 'splitter' })}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              state.activeTab === 'splitter'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Asset Splitter
          </button>
          <button
            onClick={() => typedDispatch({ type: 'SET_TAB', tab: 'library' })}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              state.activeTab === 'library'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Library
            {state.library.length > 0 && (
              <span className="ml-1 text-indigo-300 tabular-nums">{state.library.length}</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Undo / Redo */}
          <button
            onClick={() => typedDispatch({ type: 'UNDO' })}
            disabled={!canUndo}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 px-2.5 py-1.5 rounded flex items-center gap-1"
            title={`Undo (Ctrl+Z) — ${undoState.past.length} step${undoState.past.length !== 1 ? 's' : ''} available`}
          >
            ↩ Undo
          </button>
          <button
            onClick={() => typedDispatch({ type: 'REDO' })}
            disabled={!canRedo}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 px-2.5 py-1.5 rounded flex items-center gap-1"
            title={`Redo (Ctrl+Y) — ${undoState.future.length} step${undoState.future.length !== 1 ? 's' : ''} available`}
          >
            ↪ Redo
          </button>

          <div className="w-px h-4 bg-gray-700" />

          {/* Save / Load project */}
          {projectError && (
            <span className="text-xs text-red-400">{projectError}</span>
          )}

          {/* Hidden file input for loading */}
          <input
            ref={loadInputRef}
            type="file"
            accept=".spritebat"
            className="hidden"
            onChange={handleLoad}
          />

          <button
            onClick={() => loadInputRef.current?.click()}
            disabled={!!projectBusy}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1"
            title="Open a .spritebat project file"
          >
            {projectBusy === 'loading' ? '⏳' : '📂'} Open
          </button>

          <button
            onClick={handleSave}
            disabled={!!projectBusy || (state.layers.length === 0 && state.library.length === 0)}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1"
            title="Save project as .spritebat"
          >
            {projectBusy === 'saving' ? '⏳' : '💾'} Save
          </button>

          <button
            onClick={handleClose}
            disabled={!!projectBusy}
            className="text-xs bg-gray-700 hover:bg-red-900 hover:text-red-300 disabled:opacity-50 text-gray-400 px-3 py-1.5 rounded flex items-center gap-1"
            title="Close project — clears all layers and library"
          >
            ✕ Close
          </button>

          <div className="w-px h-4 bg-gray-700" />

          {/* Project config button */}
          <button
            onClick={() => typedDispatch({ type: 'TOGGLE_CONFIG' })}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1"
          >
            ⚙ Config
            <span className="text-gray-500 ml-1">
              {state.config.frameWidth}×{state.config.frameHeight} · {state.config.framesPerDirection}f · {state.config.directions}d · in {state.config.defaultInputLayout.cols}×{state.config.defaultInputLayout.rows}
            </span>
          </button>
        </div>
      </header>

      {/* ── Main content area ── */}
      <div className="flex flex-1 overflow-hidden">
        {state.activeTab === 'composer' ? (
          <>
            {/* Left: Layers panel */}
            <LayersPanel
              layers={state.layers}
              selectedLayerId={state.selectedLayerId}
              config={state.config}
              dispatch={typedDispatch}
              cache={globalCache}
            />

            {/* Center: Main canvas */}
            <div className="flex-1 overflow-hidden">
              <MainCanvas state={state} dispatch={typedDispatch} cache={globalCache} />
            </div>

            {/* Right: Animated preview */}
            <AnimatedPreview state={state} dispatch={typedDispatch} cache={globalCache} />
          </>
        ) : state.activeTab === 'splitter' ? (
          <div className="flex-1 overflow-hidden">
            <AssetSplitter state={state} dispatch={typedDispatch} />
          </div>
        ) : (
          /* Library tab */
          <div className="flex-1 overflow-hidden">
            <LibraryTab state={state} dispatch={typedDispatch} />
          </div>
        )}
      </div>

      {/* ── Layer properties bar (only in composer tab) ── */}
      {state.activeTab === 'composer' && (
        <div className="h-16 flex-shrink-0 bg-gray-900 border-t border-gray-700 overflow-hidden">
          <LayerProperties layer={selectedLayer} config={state.config} dispatch={typedDispatch} cache={globalCache} frameOffsetMode={state.frameOffsetMode} />
        </div>
      )}

      {/* ── Export bar ── */}
      <ExportBar state={state} cache={globalCache} />

      {/* ── Project Config Modal ── */}
      {state.showConfig && (
        <ProjectConfigModal
          config={state.config}
          dispatch={typedDispatch}
          onClose={() => typedDispatch({ type: 'TOGGLE_CONFIG' })}
        />
      )}

      {/* ── About Modal ── */}
      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => e.target === e.currentTarget && setShowAbout(false)}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-6" style={{ maxWidth: 520, width: '90vw' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/bat-emoji.png" alt="🦇" className="w-6 h-6" style={{ imageRendering: 'auto' }} />
                <span className="font-bold text-indigo-400 text-base tracking-wide">SpriteBat</span>
                <span className="text-gray-500 text-xs">v1.0</span>
              </div>
              <button onClick={() => setShowAbout(false)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            <p className="text-sm text-gray-300 leading-relaxed">
              SpriteBat is a browser-based sprite sheet compositor built for 2D game artists. It lets you
              layer, position, tint and combine multiple sprite sheets into a single unified output — perfect for
              building modular character animations from separate body-part assets.
            </p>

            <div className="flex flex-col gap-2 text-xs text-gray-400">
              <span className="text-gray-500 font-bold uppercase tracking-wider text-xs">Features</span>
              <ul className="list-disc list-inside space-y-1">
                <li><span className="text-gray-300">Composer</span> — Stack layers with per-layer HSL shift, opacity, offsets, and per-frame nudge. Drag to reposition, merge layers down, undo/redo everything.</li>
                <li><span className="text-gray-300">Asset Splitter</span> — Load a reference image, box/lasso select a region (Shift to add, Alt to subtract), then extract it as a trimmed PNG for the library or directly as a layer.</li>
                <li><span className="text-gray-300">Library</span> — Store extracted assets for reuse. Duplicate, flip H/V, import into specific frame cells, or add as a full layer.</li>
                <li><span className="text-gray-300">Tile to Sheet</span> — Stamp a single-frame asset across chosen directions and frames to build a full sprite sheet in one click.</li>
                <li><span className="text-gray-300">Clear Frames</span> — Erase specific cells from a layer so you can replace them with new content.</li>
                <li><span className="text-gray-300">Configurable layouts</span> — Set frame size, direction count (4 or 8), frames per direction, and separate input/export grid layouts.</li>
                <li><span className="text-gray-300">Export</span> — Download the composited sheet as PNG, export individual frames as ZIP, or export animated GIFs per direction (uses the preview FPS). Scale 1–4× for all formats.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-800">
              <div className="flex items-center gap-3">
                <a href="https://eidolware.com/about/" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  by FATBAT Studio
                </a>
                <a
                  href="https://bsky.app/profile/fatbat.studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-[#0085ff] transition-colors"
                  title="Follow FATBAT Studio on Bluesky"
                >
                  <svg width="16" height="16" viewBox="0 0 600 530" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49c26.262-54.316 97.782-155.54 164.28-205.46C512.26 8.009 590-19.862 590 68.825c0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.38-3.69-10.832-3.708-7.896-.017-2.935-1.193.516-3.707 7.896-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.256 82.697-152.22-67.108 11.421-142.55-7.449-163.25-81.433C20.15 217.613 10 86.536 10 68.824c0-88.687 77.742-60.816 125.72-24.795z" />
                  </svg>
                </a>
              </div>
              <button
                onClick={() => setShowAbout(false)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
