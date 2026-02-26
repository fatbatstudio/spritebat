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
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useIsMobile } from './hooks/useIsMobile';
import batEmojiUrl from '/bat-emoji.png?url';
import tutorialUrl from '/tutorial-character.spritebat?url';

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

  // ── PWA update prompt ─────────────────────────────────────────────────────
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [updateDismissed, setUpdateDismissed] = useState(false);

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

  // Track blob URL ownership across present + undo/redo history.
  // Revoke URLs only after they disappear from all tracked states.
  const trackedUrlsRef = useRef<Set<string>>(new Set());

  // ── Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z ───────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }

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

  useEffect(() => {
    const nextUrls = new Set<string>();

    const addUrl = (url: string | null | undefined) => {
      if (url) nextUrls.add(url);
    };

    for (const l of undoState.present.layers) addUrl(l.objectUrl);
    for (const a of undoState.present.library) addUrl(a.objectUrl);
    addUrl(undoState.present.splitter.objectUrl);

    for (const snap of undoState.past) {
      for (const l of snap.layers) addUrl(l.objectUrl);
      for (const a of snap.library) addUrl(a.objectUrl);
    }
    for (const snap of undoState.future) {
      for (const l of snap.layers) addUrl(l.objectUrl);
      for (const a of snap.library) addUrl(a.objectUrl);
    }

    for (const oldUrl of trackedUrlsRef.current) {
      if (!nextUrls.has(oldUrl)) URL.revokeObjectURL(oldUrl);
    }
    trackedUrlsRef.current = nextUrls;
  }, [undoState]);

  useEffect(() => {
    return () => {
      for (const url of trackedUrlsRef.current) URL.revokeObjectURL(url);
      trackedUrlsRef.current.clear();
    };
  }, []);

  // ── Mobile responsive ──────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMobileLayers, setShowMobileLayers] = useState(false);
  const [showMobilePreview, setShowMobilePreview] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [mobileExportOpen, setMobileExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  // Close mobile overlays when switching away from mobile
  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
      setShowMobileLayers(false);
      setShowMobilePreview(false);
    }
  }, [isMobile]);

  // Wrapper dispatch that auto-closes mobile layers panel on layer select
  const mobileLayerDispatch = useCallback((action: UndoRedoAction) => {
    typedDispatch(action);
    if ('type' in action && action.type === 'SELECT_LAYER') setShowMobileLayers(false);
  }, [typedDispatch]);

  // ── About dialog ───────────────────────────────────────────────────────────
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  // ── Tutorial / example project dialog ────────────────────────────────────
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialBusy, setTutorialBusy] = useState(false);

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

  async function handleLoadTutorial() {
    setTutorialBusy(true);
    try {
      const response = await fetch(tutorialUrl);
      if (!response.ok) throw new Error('Failed to fetch example project');
      const blob = await response.blob();
      const file = new File([blob], 'tutorial-character.spritebat');
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
      globalCache.clear();
      setShowTutorial(false);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Failed to load example');
    } finally {
      setTutorialBusy(false);
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
      <header className="flex flex-col bg-gray-900 border-b border-gray-700 flex-shrink-0">
        {isMobile ? (
          /* ── Mobile header: single row with menu ── */
          <div className="flex items-center px-3 py-1.5 relative" ref={menuRef}>
            {/* Left: branding */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <img src={batEmojiUrl} alt="🦇" className="w-5 h-5 flex-shrink-0" style={{ imageRendering: 'auto' }} />
            </div>

            {/* Center: tab switcher */}
            <div className="flex-1 flex justify-center mx-1">
              <div className="flex gap-0.5 bg-gray-800 p-0.5 rounded">
                <button
                  onClick={() => { typedDispatch({ type: 'SET_TAB', tab: 'composer' }); setMenuOpen(false); }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${state.activeTab === 'composer' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >Composer</button>
                <button
                  onClick={() => { typedDispatch({ type: 'SET_TAB', tab: 'splitter' }); setMenuOpen(false); }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${state.activeTab === 'splitter' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >Splitter</button>
                <button
                  onClick={() => { typedDispatch({ type: 'SET_TAB', tab: 'library' }); setMenuOpen(false); }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${state.activeTab === 'library' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Library
                  {state.library.length > 0 && <span className="ml-1 text-indigo-300 tabular-nums">{state.library.length}</span>}
                </button>
              </div>
            </div>

            {/* Right: menu button */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="text-gray-400 hover:text-white text-lg px-1.5 py-0.5 rounded transition-colors"
              title="Menu"
            >☰</button>

            {/* Hidden file input for Open */}
            <input ref={loadInputRef} type="file" accept=".spritebat" className="hidden" onChange={handleLoad} />

            {/* Menu dropdown */}
            {menuOpen && (
              <div className="absolute right-2 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-50 py-1 min-w-[200px]">
                {/* Undo / Redo */}
                <div className="flex gap-1 px-3 py-1.5">
                  <button
                    onClick={() => { typedDispatch({ type: 'UNDO' }); }}
                    disabled={!canUndo}
                    className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 px-2 py-1.5 rounded"
                  >↩ Undo</button>
                  <button
                    onClick={() => { typedDispatch({ type: 'REDO' }); }}
                    disabled={!canRedo}
                    className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 px-2 py-1.5 rounded"
                  >↪ Redo</button>
                </div>
                <div className="border-t border-gray-700 my-1" />
                {/* Project actions */}
                {projectError && <div className="px-3 py-1 text-xs text-red-400">{projectError}</div>}
                <button onClick={() => { loadInputRef.current?.click(); setMenuOpen(false); }} disabled={!!projectBusy} className="w-full text-left text-xs text-gray-300 hover:bg-gray-700 px-3 py-2 disabled:opacity-50">📂 Open Project</button>
                <button onClick={() => { handleSave(); setMenuOpen(false); }} disabled={!!projectBusy || (state.layers.length === 0 && state.library.length === 0)} className="w-full text-left text-xs text-gray-300 hover:bg-gray-700 px-3 py-2 disabled:opacity-50">💾 Save Project</button>
                <button onClick={() => { handleClose(); setMenuOpen(false); }} disabled={!!projectBusy} className="w-full text-left text-xs text-gray-400 hover:bg-gray-700 hover:text-red-300 px-3 py-2 disabled:opacity-50">✕ Close Project</button>
                <div className="border-t border-gray-700 my-1" />
                {/* Config */}
                <button onClick={() => { typedDispatch({ type: 'TOGGLE_CONFIG' }); setMenuOpen(false); }} className="w-full text-left text-xs text-gray-300 hover:bg-gray-700 px-3 py-2">
                  ⚙ Config <span className="text-gray-500">{state.config.frameWidth}×{state.config.frameHeight} · {state.config.framesPerDirection}f · {state.config.directions}d</span>
                </button>
                <div className="border-t border-gray-700 my-1" />
                {/* Secondary links */}
                <button onClick={() => { setShowAbout(true); setMenuOpen(false); }} className="w-full text-left text-xs text-gray-400 hover:bg-gray-700 hover:text-white px-3 py-2">? About</button>
                <a href="https://ko-fi.com/fatbatstudio" target="_blank" rel="noopener noreferrer" className="block text-xs text-[#FF5E5B] hover:bg-gray-700 px-3 py-2">☕ Ko-fi</a>
                <button onClick={() => { setShowTutorial(true); setMenuOpen(false); }} className="w-full text-left text-xs text-teal-400 hover:bg-gray-700 px-3 py-2">🎮 Try Example</button>
                <div className="border-t border-gray-700 my-1" />
                <a href="https://eidolware.com/about/" target="_blank" rel="noopener noreferrer" className="block text-xs text-gray-600 hover:text-gray-400 px-3 py-1.5">by FATBAT Studio</a>
              </div>
            )}
          </div>
        ) : (
          /* ── Desktop header: two rows ── */
          <>
            {/* Row 1: Logo + Tabs + Project actions */}
            <div className="flex items-center px-4 py-1.5">
              {/* Left: branding */}
              <div className="flex-1 flex items-center gap-2">
                <span className="font-bold text-indigo-400 text-sm tracking-wide flex items-center gap-1"><img src={batEmojiUrl} alt="🦇" className="w-5 h-5" style={{ imageRendering: 'auto' }} /> SpriteBat</span>
                <span className="text-gray-600 text-xs">v1.04</span>
              </div>

              {/* Center: tab switcher */}
              <div className="flex justify-center">
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
              </div>

              {/* Right: undo/redo + project actions */}
              <div className="flex-1 flex items-center gap-2 justify-end">
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

                {projectError && (
                  <span className="text-xs text-red-400">{projectError}</span>
                )}

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
              </div>
            </div>

            {/* Row 2: Secondary links + Config */}
            <div className="flex items-center justify-between px-4 py-1 border-t border-gray-800">
              <div className="flex items-center gap-3">
                <a href="https://eidolware.com/about/" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-400 text-xs transition-colors">by FATBAT Studio</a>
                <button
                  onClick={() => setShowAbout(true)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white px-2 py-0.5 rounded transition-colors"
                  title="About SpriteBat"
                >
                  ? About
                </button>
                <a
                  href="https://ko-fi.com/fatbatstudio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-[#FF5E5B] hover:bg-[#e04e4b] text-white px-2 py-0.5 rounded transition-colors"
                  title="Support on Ko-fi"
                >
                  ☕ Ko-fi
                </a>
                <button
                  onClick={() => setShowTutorial(true)}
                  className="text-xs bg-teal-700 hover:bg-teal-600 text-white px-2 py-0.5 rounded transition-colors"
                  title="Load an example project to explore SpriteBat"
                >
                  🎮 Try Example
                </button>
              </div>

              <button
                onClick={() => typedDispatch({ type: 'TOGGLE_CONFIG' })}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-0.5 rounded flex items-center gap-1"
              >
                ⚙ Config
                <span className="text-gray-500 ml-1">
                  {state.config.frameWidth}×{state.config.frameHeight} · {state.config.framesPerDirection}f · {state.config.directions}d · in {state.config.defaultInputLayout.cols}×{state.config.defaultInputLayout.rows}
                </span>
              </button>
            </div>
          </>
        )}
      </header>

      {/* ── PWA update banner ── */}
      {needRefresh && !updateDismissed && (
        <div className="flex items-center justify-center gap-3 px-4 py-1.5 bg-indigo-900/80 border-b border-indigo-700 flex-shrink-0">
          <span className="text-xs text-indigo-200">🔄 A new version of SpriteBat is available.</span>
          <button
            onClick={() => updateServiceWorker(true)}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-0.5 rounded transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => setUpdateDismissed(true)}
            className="text-gray-400 hover:text-white text-sm leading-none transition-colors"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {state.activeTab === 'composer' ? (
          <>
            {/* Mobile: toggle bar for slide-over panels */}
            {isMobile && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-900 border-b border-gray-700 flex-shrink-0">
                <button
                  onClick={() => setShowMobileLayers(true)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded flex items-center gap-1"
                >
                  ☰ Layers
                  {state.layers.length > 0 && <span className="text-indigo-300 tabular-nums">{state.layers.length}</span>}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setShowMobilePreview(true)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded"
                >
                  ▶ Preview
                </button>
              </div>
            )}

            <div className="flex flex-1 overflow-hidden">
              {/* Left: Layers panel (desktop only) */}
              {!isMobile && (
                <LayersPanel
                  layers={state.layers}
                  selectedLayerId={state.selectedLayerId}
                  config={state.config}
                  dispatch={typedDispatch}
                  cache={globalCache}
                />
              )}

              {/* Center: Main canvas */}
              <div className="flex-1 overflow-hidden">
                <MainCanvas state={state} dispatch={typedDispatch} cache={globalCache} />
              </div>

              {/* Right: Animated preview (desktop only) */}
              {!isMobile && (
                <AnimatedPreview state={state} dispatch={typedDispatch} cache={globalCache} />
              )}
            </div>

            {/* Mobile: Layers slide-over */}
            {isMobile && showMobileLayers && (
              <div className="fixed inset-0 z-40 flex">
                <div className="h-full overflow-y-auto bg-gray-900" style={{ width: Math.min(280, window.innerWidth * 0.75) }}>
                  <LayersPanel
                    layers={state.layers}
                    selectedLayerId={state.selectedLayerId}
                    config={state.config}
                    dispatch={mobileLayerDispatch}
                    cache={globalCache}
                    mobile
                    onClose={() => setShowMobileLayers(false)}
                  />
                </div>
                <div className="flex-1 bg-black/40" onClick={() => setShowMobileLayers(false)} />
              </div>
            )}

            {/* Mobile: Preview slide-over */}
            {isMobile && showMobilePreview && (
              <div className="fixed inset-0 z-40 flex justify-end">
                <div className="flex-1 bg-black/40" onClick={() => setShowMobilePreview(false)} />
                <div className="h-full overflow-y-auto bg-gray-900" style={{ width: Math.min(280, window.innerWidth * 0.75) }}>
                  <AnimatedPreview state={state} dispatch={typedDispatch} cache={globalCache} mobile onClose={() => setShowMobilePreview(false)} />
                </div>
              </div>
            )}
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
          {isMobile ? (
            <>
              <button
                onClick={() => setMobilePropsOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                <span className="uppercase tracking-wider font-bold">{selectedLayer ? `▸ ${selectedLayer.name}` : '▸ Layer'}</span>
                <span className="text-gray-600">{mobilePropsOpen ? '▾' : '▸'}</span>
              </button>
              {mobilePropsOpen && (
                <LayerProperties layer={selectedLayer} config={state.config} dispatch={typedDispatch} cache={globalCache} frameOffsetMode={state.frameOffsetMode} mobile={isMobile} />
              )}
            </>
          ) : (
            <LayerProperties layer={selectedLayer} config={state.config} dispatch={typedDispatch} cache={globalCache} frameOffsetMode={state.frameOffsetMode} mobile={isMobile} />
          )}
        </div>
      )}

      {/* ── Export bar ── */}
      {isMobile ? (
        <div className="flex-shrink-0 bg-gray-900 border-t border-gray-700">
          <button
            onClick={() => setMobileExportOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span className="uppercase tracking-wider font-bold">▸ Export</span>
            <span className="text-gray-600">{mobileExportOpen ? '▾' : '▸'}</span>
          </button>
          {mobileExportOpen && <ExportBar state={state} cache={globalCache} />}
        </div>
      ) : (
        <ExportBar state={state} cache={globalCache} />
      )}

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
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-6 max-h-[90vh] overflow-y-auto" style={{ maxWidth: 680, width: '90vw' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={batEmojiUrl} alt="🦇" className="w-6 h-6" style={{ imageRendering: 'auto' }} />
                <span className="font-bold text-indigo-400 text-base tracking-wide">SpriteBat</span>
                <span className="text-gray-500 text-xs">v1.04</span>
                <button
                  onClick={() => setShowChangelog(true)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded transition-colors"
                  title="View changelog"
                >
                  What's New
                </button>
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
                <li><span className="text-gray-300">Asset Splitter</span> — Load a reference image or import directly from a composer layer (full sheet or a specific frame). Box/lasso select regions (Shift to add, Alt to subtract), resize handles for fine-tuning, then extract as a trimmed PNG to the library or as a new layer. Name and tag assets before extracting. Hold Space to pan, middle-click to pan, scroll to zoom.</li>
                <li><span className="text-gray-300">Library</span> — Store extracted assets with tags for organization. Filter by tag sidebar, search by name or tag, drag to reorder. Duplicate, flip H/V, import into specific frame cells, or add as a full layer. Save/load library assets as standalone .spritebat files. Undo/redo all library actions.</li>
                <li><span className="text-gray-300">Tile to Sheet</span> — Stamp a single-frame asset across chosen directions and frames to build a full sprite sheet in one click.</li>
                <li><span className="text-gray-300">Clear Frames</span> — Erase specific cells from a layer so you can replace them with new content.</li>
                <li><span className="text-gray-300">Animated Preview</span> — Preview animations per direction with forward, reverse, and ping-pong playback modes. Click frame indicators to jump to any frame.</li>
                <li><span className="text-gray-300">Configurable layouts</span> — Set frame size, direction count (4 or 8), frames per direction, and separate input/export grid layouts. Click the sheet preview to jump to any frame.</li>
                <li><span className="text-gray-300">Export</span> — Download the composited sheet as PNG, individual frames as ZIP, or animated GIFs per direction with forward/reverse/ping-pong support. Export the selected layer only as a sheet or single frame. Scale 1–4× for all formats.</li>
                <li><span className="text-gray-300">Projects</span> — Save and load .spritebat project files that preserve all layers, library assets, and UI state. Keyboard shortcuts for undo (Ctrl+Z) and redo (Ctrl+Y). Try the bundled example project to explore features.</li>
                <li><span className="text-gray-300">Install & Offline</span> — Install SpriteBat as a standalone app from your browser and use it fully offline. Automatic update notifications when a new version is available.</li>
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
                <a
                  href="https://fatbatstudio.itch.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-[#fa5c5c] transition-colors"
                  title="FATBAT Studio on itch.io"
                >
                  <svg width="16" height="16" viewBox="0 0 245.371 220.736" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M31.99 1.365C21.287 7.72.2 31.945 0 38.298v10.516C0 62.144 12.46 73.86 23.773 73.86c13.584 0 24.902-11.258 24.903-24.62 0 13.362 10.93 24.62 24.515 24.62 13.586 0 24.165-11.258 24.165-24.62 0 13.362 11.622 24.62 25.207 24.62h.246c13.586 0 25.208-11.258 25.208-24.62 0 13.362 10.58 24.62 24.164 24.62 13.585 0 24.515-11.258 24.515-24.62 0 13.362 11.32 24.62 24.903 24.62 11.313 0 23.773-11.714 23.773-25.046V38.298c-.2-6.354-21.287-30.58-31.988-36.933C180.118.197 157.056-.005 122.685 0 88.316-.005 65.253.197 31.99 1.365zm65.194 66.217a28.025 28.025 0 01-4.78 6.155c-5.128 5.014-12.157 8.122-19.906 8.122a28.482 28.482 0 01-19.948-8.126c-1.858-1.82-3.27-3.766-4.563-6.032l-.006.004c-1.292 2.27-3.092 4.215-4.954 6.037a28.5 28.5 0 01-19.948 8.12c-.934 0-1.906-.258-2.692-.528-1.092 11.372-1.553 22.24-1.716 30.164l-.002.045c-.02 4.024-.04 7.333-.06 11.93.21 23.86-2.363 77.334 10.52 90.473 19.964 4.655 56.7 6.775 93.555 6.788h.006c36.854-.013 73.59-2.133 93.554-6.788 12.883-13.14 10.31-66.614 10.52-90.474-.022-4.596-.04-7.905-.06-11.93l-.003-.045c-.163-7.925-.623-18.793-1.715-30.165-.786.27-1.758.528-2.692.528a28.5 28.5 0 01-19.948-8.12c-1.862-1.822-3.662-3.766-4.955-6.037l-.006-.004c-1.294 2.266-2.705 4.213-4.563 6.032a28.48 28.48 0 01-19.947 8.126c-7.748 0-14.778-3.108-19.906-8.122a28.025 28.025 0 01-4.78-6.155 27.99 27.99 0 01-4.736 6.155 28.49 28.49 0 01-19.95 8.122c-7.71 0-14.694-3.108-19.824-8.122a27.963 27.963 0 01-4.694-6.155zm-8.979 69.09c13.15.2 27.316 5.2 33.58 17.394 6.263-12.186 20.43-17.193 33.58-17.394 17.834.593 32.112 12.874 32.112 31.06 0 20.47-14.272 33.96-32.112 52.752-6.806 7.18-20.452 17.2-33.58 25.253-13.127-8.053-26.773-18.073-33.58-25.253-17.84-18.793-32.11-32.282-32.11-52.752 0-18.186 14.277-30.467 32.11-31.06z" />
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

      {/* ── Tutorial / Example Project Modal ── */}
      {showTutorial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => e.target === e.currentTarget && setShowTutorial(false)}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-6" style={{ maxWidth: 480, width: '90vw' }}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-teal-400 text-base tracking-wide">🎮 Example Project</span>
              <button onClick={() => setShowTutorial(false)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            <p className="text-sm text-gray-300 leading-relaxed">
              Load an example character project to explore SpriteBat's features. This project includes layered sprite sheets
              for a modular character — try toggling layers, adjusting HSL colors, changing offsets, and exporting to see how
              SpriteBat brings everything together. There's also a hat asset in the Library you can add as a new layer to
              practice positioning and per-frame offsets.
            </p>

            <p className="text-sm text-gray-400 leading-relaxed">
              The character in this example is based on a template by{' '}
              <a
                href="https://malibudarby.itch.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-400 hover:text-teal-300 transition-colors"
              >
                Malibu Darby
              </a>
              . Check out their work for more amazing pixel art assets!
            </p>

            <div className="text-xs text-gray-500 bg-gray-800 rounded px-3 py-2">
              ⚠ Loading the example will replace your current project. Save first if you have unsaved work.
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowTutorial(false)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLoadTutorial}
                disabled={tutorialBusy}
                className="text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-4 py-1.5 rounded transition-colors flex items-center gap-1"
              >
                {tutorialBusy ? '⏳ Loading…' : '📂 Load Example Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Changelog Modal ── */}
      {showChangelog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => e.target === e.currentTarget && setShowChangelog(false)}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col gap-4 p-6 max-h-[90vh] overflow-y-auto" style={{ maxWidth: 560, width: '90vw' }}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-400 text-base tracking-wide">What's New</span>
              <button onClick={() => setShowChangelog(false)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            {/* v1.04 */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-200">v1.04 <span className="text-gray-500 font-normal">- Feb 26, 2026</span></h3>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1 pl-1">
                <li>Bugfixes to undo/redo actions and library asset management.</li>
              </ul>
            </div>

            <div className="border-t border-gray-800" />

            {/* v1.03 */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-200">v1.03 <span className="text-gray-500 font-normal">- Feb 22, 2026</span></h3>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1 pl-1">
                <li>What's New dialog to view version history from the About screen</li>
                <li>Layer Properties bar redesigned into 3 atomic sections that wrap gracefully on tablets</li>
                <li>itch.io deployment via GitHub Actions for automatic publishing on push</li>
              </ul>
            </div>

            <div className="border-t border-gray-800" />

            {/* v1.02 */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-200">v1.02 <span className="text-gray-500 font-normal">- Feb 21, 2026</span></h3>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1 pl-1">
                <li>Try Example button to load a bundled tutorial project</li>
                <li>Library tag sidebar with counts and filters (All / Untagged / by tag)</li>
                <li>Library drag-to-reorder and search by name + tags</li>
                <li>Asset Splitter: load from composer layer, spacebar pan, extract with tags</li>
                <li>HSL Adjust dialog with precise numeric inputs</li>
                <li>PWA support: install as standalone app, full offline use</li>
                <li>OpenGraph and Twitter Card meta tags for rich link previews</li>
                <li>Mobile responsive UI with slide-over panels, collapsible bars, and touch targets</li>
                <li>Two-row desktop header, scrollable About dialog, canvas touch support</li>
              </ul>
            </div>

            <div className="border-t border-gray-800" />

            {/* v1.01 */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-200">v1.01 <span className="text-gray-500 font-normal">- Feb 20, 2026</span></h3>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1 pl-1">
                <li>Save/load library as standalone .spritebat files</li>
                <li>Export per-layer sheet and single frame</li>
                <li>GIF export for directions (forward/reverse/ping-pong)</li>
                <li>Asset Splitter with box/lasso selection and resize handles</li>
                <li>Merge layers down, HSL color shift with caching</li>
                <li>Per-frame position offsets with dedicated editing mode</li>
                <li>Import into specific frame cells, clear specific cells</li>
                <li>Tile to Sheet: stamp asset across directions/frames</li>
                <li>Undo/redo for all layer and library actions (Ctrl+Z / Ctrl+Y)</li>
              </ul>
            </div>

            <div className="border-t border-gray-800" />

            {/* v1.0 */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-gray-200">v1.0 <span className="text-gray-500 font-normal">- Feb 19, 2026</span></h3>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1 pl-1">
                <li>Initial release with multi-layer sprite sheet compositing</li>
                <li>Layer system with types, visibility, opacity, and reordering</li>
                <li>Animated preview with forward/reverse/ping-pong playback</li>
                <li>Configurable frame size, directions, frames per direction, grid layouts</li>
                <li>Export as PNG sheet or individual frames as ZIP</li>
                <li>.spritebat project files for saving/loading full project state</li>
                <li>Asset library for storing and organizing sprites</li>
              </ul>
            </div>

            <div className="flex justify-end pt-1 border-t border-gray-800">
              <button
                onClick={() => setShowChangelog(false)}
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
