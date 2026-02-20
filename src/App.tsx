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
          <a
            href="https://ko-fi.com/fatbatstudio"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-[#FF5E5B] hover:bg-[#e04e4b] text-white px-2 py-1 rounded transition-colors"
            title="Support on Ko-fi"
          >
            ☕ Ko-fi
          </a>
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
            <AssetSplitter state={state} dispatch={typedDispatch} cache={globalCache} />
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
        <div className="flex-shrink-0 bg-gray-900 border-t border-gray-700">
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

            <p className="text-sm text-gray-400 leading-relaxed">
              SpriteBat is free and open-source under the{' '}
              <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 transition-colors">GNU GPLv3</a> license.
              If you find it helpful, consider{' '}
              <a href="https://ko-fi.com/fatbatstudio" target="_blank" rel="noopener noreferrer" className="text-[#FF5E5B] hover:text-[#ff7e7b] transition-colors">buying me a coffee on Ko-fi</a> to
              support continued development.
            </p>

            <div className="flex flex-col gap-2 text-xs text-gray-400">
              <span className="text-gray-500 font-bold uppercase tracking-wider text-xs">Features</span>
              <ul className="list-disc list-inside space-y-1">
                <li><span className="text-gray-300">Composer</span> — Stack layers with per-layer HSL color shift, opacity, offsets, and per-frame position nudge. Drag to reposition on the canvas, merge layers down, undo/redo all actions. Each layer can have its own input grid layout.</li>
                <li><span className="text-gray-300">Asset Splitter</span> — Load a reference image or import directly from a composer layer (full sheet or a specific frame). Box/lasso select regions (Shift to add, Alt to subtract), resize handles for fine-tuning, then extract as a trimmed PNG to the library or as a new layer.</li>
                <li><span className="text-gray-300">Library</span> — Store extracted assets for reuse. Duplicate, flip H/V, import into specific frame cells, or add as a full layer. Save/load library assets as standalone .spritebat files, or import assets from another project.</li>
                <li><span className="text-gray-300">Tile to Sheet</span> — Stamp a single-frame asset across chosen directions and frames to build a full sprite sheet in one click.</li>
                <li><span className="text-gray-300">Clear Frames</span> — Erase specific cells from a layer so you can replace them with new content.</li>
                <li><span className="text-gray-300">Animated Preview</span> — Preview animations per direction with forward, reverse, and ping-pong playback modes. Click frame indicators to jump to any frame.</li>
                <li><span className="text-gray-300">Configurable layouts</span> — Set frame size, direction count (4 or 8), frames per direction, and separate input/export grid layouts. Click the sheet preview to jump to any frame.</li>
                <li><span className="text-gray-300">Export</span> — Download the composited sheet as PNG, individual frames as ZIP, or animated GIFs per direction with forward/reverse/ping-pong support. Export the selected layer only as a sheet or single frame. Scale 1–4× for all formats.</li>
                <li><span className="text-gray-300">Projects</span> — Save and load .spritebat project files that preserve all layers, library assets, and UI state. Keyboard shortcuts for undo (Ctrl+Z) and redo (Ctrl+Y).</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-800">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">© 2025 <a href="https://eidolware.com/about/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition-colors">FATBAT Studio</a></span>
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
                <a
                  href="https://ko-fi.com/fatbatstudio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-[#FF5E5B] transition-colors"
                  title="Support on Ko-fi"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z" />
                  </svg>
                </a>
                <a
                  href="https://github.com/fatbatstudio/spritebat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-white transition-colors"
                  title="Source on GitHub"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
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
