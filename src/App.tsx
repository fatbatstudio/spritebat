import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { appReducer, initialState } from './state';
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
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-indigo-400 text-sm tracking-wide">🦇 SpriteBat</span>
          <span className="text-gray-600 text-xs">by FATBAT Studio</span>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-800 p-0.5 rounded">
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
        </div>

        <div className="flex items-center gap-2">
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
            disabled={!!projectBusy || state.layers.length === 0}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1"
            title="Save project as .spritebat"
          >
            {projectBusy === 'saving' ? '⏳' : '💾'} Save
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
            />

            {/* Center: Main canvas */}
            <div className="flex-1 overflow-hidden">
              <MainCanvas state={state} dispatch={typedDispatch} cache={globalCache} />
            </div>

            {/* Right: Animated preview */}
            <AnimatedPreview state={state} dispatch={typedDispatch} cache={globalCache} />
          </>
        ) : (
          /* Asset Splitter tab */
          <div className="flex-1 overflow-hidden">
            <AssetSplitter state={state} dispatch={typedDispatch} />
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
    </div>
  );
}

export default App;
