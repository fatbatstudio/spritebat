import React, { useState, useRef, useMemo, useEffect } from 'react';
import type { AppAction, AppState, LibraryAsset } from '../types';
import { ImportFrameModal } from './ImportFrameModal';
import { loadProject, saveLibrary } from '../project';
import { useIsMobile } from '../hooks/useIsMobile';

interface LibraryTabProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export function LibraryTab({ state, dispatch }: LibraryTabProps) {
  const { library, config } = state;
  const isMobile = useIsMobile();
  const [showMobileTags, setShowMobileTags] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [importingProject, setImportingProject] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  // Asset pending import — shows the frame picker modal
  const [importingAsset, setImportingAsset] = useState<LibraryAsset | null>(null);
  // Drag-to-reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Tag sidebar filter: null = All, "" = Untagged, "string" = specific tag
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // ── Derive tag list with counts ────────────────────────────────────────────
  const { tagCounts, untaggedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let untagged = 0;
    for (const a of library) {
      if (a.tags.length === 0) {
        untagged++;
      } else {
        for (const t of a.tags) {
          counts.set(t, (counts.get(t) || 0) + 1);
        }
      }
    }
    return { tagCounts: counts, untaggedCount: untagged };
  }, [library]);

  // Sorted tag names for sidebar display
  const sortedTags = useMemo(
    () => [...tagCounts.keys()].sort((a, b) => a.localeCompare(b)),
    [tagCounts],
  );

  // Auto-reset selectedTag if the tag no longer exists in library
  useEffect(() => {
    if (selectedTag === null || selectedTag === '') return;
    if (!tagCounts.has(selectedTag)) setSelectedTag(null);
  }, [selectedTag, tagCounts]);

  // ── Two-stage filtering (tag → search) ─────────────────────────────────────
  const tagFiltered = useMemo(() => {
    if (selectedTag === null) return library;                       // All
    if (selectedTag === '') return library.filter(a => a.tags.length === 0); // Untagged
    return library.filter(a => a.tags.includes(selectedTag));       // Specific tag
  }, [library, selectedTag]);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? tagFiltered.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.tags.some(t => t.toLowerCase().includes(query))
      )
    : tagFiltered;

  function startEdit(asset: LibraryAsset) {
    setEditingId(asset.id);
    setEditName(asset.name);
    setEditTags(asset.tags.join(', '));
  }

  function commitEdit(id: string) {
    const tags = editTags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    dispatch({ type: 'UPDATE_LIBRARY_ASSET', id, updates: { name: editName, tags } });
    setEditingId(null);
  }

  function handleImportAsLayer(asset: LibraryAsset) {
    setImportingAsset(asset);
  }

  function handleDownload(asset: LibraryAsset) {
    const a = document.createElement('a');
    a.href = asset.objectUrl;
    a.download = asset.name + '.png';
    a.click();
  }

  function handleRemove(asset: LibraryAsset) {
    // Don't revoke objectUrl here — the asset may be restored via undo.
    // URLs are cleaned up when the project is closed (CLOSE_PROJECT clears history).
    dispatch({ type: 'REMOVE_LIBRARY_ASSET', id: asset.id });
  }

  function addDerivedAsset(source: LibraryAsset, nameSuffix: string, transform: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const cv = document.createElement('canvas');
    cv.width = source.width;
    cv.height = source.height;
    const ctx = cv.getContext('2d')!;
    transform(ctx, source.width, source.height);
    ctx.drawImage(source.image, 0, 0);
    cv.toBlob(blob => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        dispatch({
          type: 'ADD_LIBRARY_ASSET',
          asset: {
            id: crypto.randomUUID(),
            name: source.name + nameSuffix,
            tags: [...source.tags],
            objectUrl,
            image: img,
            width: source.width,
            height: source.height,
            createdAt: Date.now(),
          },
        });
      };
      img.src = objectUrl;
    }, 'image/png');
  }

  function handleDuplicate(asset: LibraryAsset) {
    addDerivedAsset(asset, ' copy', () => { /* no transform — just draw as-is */ });
  }

  function handleFlipH(asset: LibraryAsset) {
    addDerivedAsset(asset, ' ↔', (ctx, w) => {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    });
  }

  function handleFlipV(asset: LibraryAsset) {
    addDerivedAsset(asset, ' ↕', (ctx, _w, h) => {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    });
  }

  function importFiles(files: FileList | File[]) {
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    for (const file of images) {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Strip extension for default name
        const name = file.name.replace(/\.[^.]+$/, '');
        const asset: LibraryAsset = {
          id: crypto.randomUUID(),
          name,
          tags: [],
          objectUrl,
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          createdAt: Date.now(),
        };
        dispatch({ type: 'ADD_LIBRARY_ASSET', asset });
      };
      img.src = objectUrl;
    }
  }

  async function importFromProject(file: File) {
    setImportingProject(true);
    try {
      const project = await loadProject(file);
      if (project.library.length === 0) {
        alert('This .spritebat file does not contain any library assets.');
        return;
      }
      const usedIds = new Set(library.map(a => a.id));
      for (const asset of project.library) {
        let id = asset.id;
        while (usedIds.has(id)) id = crypto.randomUUID();
        usedIds.add(id);
        dispatch({ type: 'ADD_LIBRARY_ASSET', asset: { ...asset, id } });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to import library from project file.');
    } finally {
      setImportingProject(false);
    }
  }

  async function handleSaveLibrary() {
    setSavingLibrary(true);
    try {
      await saveLibrary(library, config);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save library.');
    } finally {
      setSavingLibrary(false);
    }
  }

  // ── Card reorder drag handlers ──────────────────────────────────────────────
  function onCardDragStart(id: string) {
    setDraggingId(id);
  }

  function onCardDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    // Only treat as card reorder if we're dragging a card (no files)
    if (draggingId && draggingId !== id) {
      setDragOverId(id);
    }
  }

  function onCardDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const fromIndex = library.findIndex(a => a.id === draggingId);
    const toIndex = library.findIndex(a => a.id === targetId);
    if (fromIndex !== -1 && toIndex !== -1) {
      dispatch({ type: 'REORDER_LIBRARY', fromIndex, toIndex });
    }
    setDraggingId(null);
    setDragOverId(null);
  }

  function onCardDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    // Only import files from external drops — not internal card reorder drags
    if (!draggingId && e.dataTransfer.files.length > 0) {
      importFiles(e.dataTransfer.files);
    }
    setDraggingId(null);
    setDragOverId(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0 flex-wrap">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Asset Library</span>
        <span className="text-xs text-gray-500">{library.length} asset{library.length !== 1 ? 's' : ''}</span>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded flex items-center gap-1"
          title="Import image files into the library"
        >
          + Import Images
        </button>

        <button
          onClick={() => projectInputRef.current?.click()}
          disabled={importingProject}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-2.5 py-1 rounded flex items-center gap-1"
          title="Import library assets from a .spritebat project file"
        >
          {importingProject ? '⏳' : '📦'} Import from .spritebat
        </button>

        <button
          onClick={handleSaveLibrary}
          disabled={savingLibrary || library.length === 0}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-2.5 py-1 rounded flex items-center gap-1"
          title="Save only the asset library as a .spritebat file"
        >
          {savingLibrary ? '⏳' : '💾'} Save Library .spritebat
        </button>

        {/* Mobile: Tags filter button */}
        {isMobile && library.length > 0 && (
          <button
            onClick={() => setShowMobileTags(true)}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2.5 py-1 rounded flex items-center gap-1"
          >
            🏷 Tags
            {selectedTag !== null && <span className="text-indigo-300">*</span>}
          </button>
        )}

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) { importFiles(e.target.files); e.target.value = ''; } }}
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".spritebat"
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) { importFromProject(e.target.files[0]); e.target.value = ''; } }}
        />

        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or tag…"
          className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1 rounded w-full md:w-48"
        />
      </div>

      {/* Body: sidebar + grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Tag sidebar (desktop) ──────────────────────────────────────────── */}
        {!isMobile && library.length > 0 && (
          <div className="w-[180px] flex-shrink-0 border-r border-gray-700 bg-gray-900 overflow-y-auto">
            <div className="px-3 pt-3 pb-1 text-xs font-bold text-gray-500 uppercase tracking-wider">Tags</div>

            {/* All */}
            <button
              onClick={() => setSelectedTag(null)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                selectedTag === null
                  ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                  : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
              }`}
            >
              <span>All</span>
              <span className="text-gray-600">{library.length}</span>
            </button>

            {/* Untagged (only shown when untagged assets exist) */}
            {untaggedCount > 0 && (
              <button
                onClick={() => setSelectedTag('')}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                  selectedTag === ''
                    ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                    : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
                }`}
              >
                <span className="italic">Untagged</span>
                <span className="text-gray-600">{untaggedCount}</span>
              </button>
            )}

            {/* Divider */}
            {sortedTags.length > 0 && <div className="mx-3 my-1.5 border-t border-gray-700" />}

            {/* Tag list */}
            {sortedTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-1 transition-colors ${
                  selectedTag === tag
                    ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                    : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
                }`}
              >
                <span className="truncate">{tag}</span>
                <span className="text-gray-600 flex-shrink-0">{tagCounts.get(tag)}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Tag sidebar slide-over (mobile) ──────────────────────────────── */}
        {isMobile && showMobileTags && (
          <div className="fixed inset-0 z-40 flex">
            <div className="h-full w-[220px] bg-gray-900 border-r border-gray-700 overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="px-3 pt-3 pb-1 text-xs font-bold text-gray-500 uppercase tracking-wider">Tags</div>
              <button
                onClick={() => { setSelectedTag(null); setShowMobileTags(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                  selectedTag === null
                    ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                    : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
                }`}
              >
                <span>All</span>
                <span className="text-gray-600">{library.length}</span>
              </button>
              {untaggedCount > 0 && (
                <button
                  onClick={() => { setSelectedTag(''); setShowMobileTags(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                    selectedTag === ''
                      ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                      : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
                  }`}
                >
                  <span className="italic">Untagged</span>
                  <span className="text-gray-600">{untaggedCount}</span>
                </button>
              )}
              {sortedTags.length > 0 && <div className="mx-3 my-1.5 border-t border-gray-700" />}
              {sortedTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => { setSelectedTag(tag); setShowMobileTags(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-1 transition-colors ${
                    selectedTag === tag
                      ? 'bg-indigo-950/60 text-indigo-300 border-l-2 border-indigo-500'
                      : 'text-gray-400 hover:bg-gray-800 border-l-2 border-transparent'
                  }`}
                >
                  <span className="truncate">{tag}</span>
                  <span className="text-gray-600 flex-shrink-0">{tagCounts.get(tag)}</span>
                </button>
              ))}
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setShowMobileTags(false)} />
          </div>
        )}

        {/* ── Grid — also a drop target for external files ───────────────────── */}
        <div
          className={`relative flex-1 overflow-y-auto p-4 transition-colors ${dragOver && !draggingId ? 'bg-indigo-950/40' : ''}`}
          onDragOver={e => { e.preventDefault(); if (!draggingId) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {library.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600 text-sm text-center border-2 border-dashed border-gray-800 rounded-lg">
              <span className="text-3xl mb-2">📚</span>
              <span>No assets yet</span>
              <span className="text-xs mt-1 text-gray-700">
                Import images, extract from the Asset Splitter, or import from a .spritebat file
              </span>
              <span className="text-xs mt-2 text-gray-800">Drop images here</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-gray-600 text-center mt-8">
              No assets match
              {selectedTag !== null && (
                <> tag "<span className="text-gray-500">{selectedTag || 'Untagged'}</span>"</>
              )}
              {selectedTag !== null && query && ' and'}
              {query && <> search "<span className="text-gray-500">{search}</span>"</>}
              {selectedTag === null && !query && ' your filters'}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 160}px, 1fr))` }}>
              {filtered.map(asset => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isEditing={editingId === asset.id}
                  editName={editName}
                  editTags={editTags}
                  onEditName={setEditName}
                  onEditTags={setEditTags}
                  onStartEdit={() => startEdit(asset)}
                  onCommitEdit={() => commitEdit(asset.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onImport={() => handleImportAsLayer(asset)}
                  onDownload={() => handleDownload(asset)}
                  onRemove={() => handleRemove(asset)}
                  onDuplicate={() => handleDuplicate(asset)}
                  onFlipH={() => handleFlipH(asset)}
                  onFlipV={() => handleFlipV(asset)}
                  isDragging={draggingId === asset.id}
                  isDragOver={dragOverId === asset.id}
                  canReorder={!query && selectedTag === null}
                  onDragStart={() => onCardDragStart(asset.id)}
                  onDragOver={e => onCardDragOver(e, asset.id)}
                  onDrop={e => onCardDrop(e, asset.id)}
                  onDragEnd={onCardDragEnd}
                />
              ))}
            </div>
          )}
          {/* Drop hint overlay when dragging external files over a populated library */}
          {dragOver && !draggingId && library.length > 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="bg-indigo-900/80 text-indigo-200 text-sm px-4 py-2 rounded-lg border border-indigo-500">
                Drop to add to library
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Frame picker modal */}
      {importingAsset && (() => {
        const cv = document.createElement('canvas');
        cv.width = importingAsset.width;
        cv.height = importingAsset.height;
        cv.getContext('2d')!.drawImage(importingAsset.image, 0, 0);
        return (
          <ImportFrameModal
            assetCanvas={cv}
            assetName={importingAsset.name}
            config={config}
            onImport={layer => {
              dispatch({ type: 'ADD_LAYER', layer });
              dispatch({ type: 'SET_TAB', tab: 'composer' });
              setImportingAsset(null);
            }}
            onClose={() => setImportingAsset(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

interface AssetCardProps {
  asset: LibraryAsset;
  isEditing: boolean;
  editName: string;
  editTags: string;
  onEditName: (v: string) => void;
  onEditTags: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onImport: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  canReorder: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function AssetCard({
  asset, isEditing, editName, editTags,
  onEditName, onEditTags, onStartEdit, onCommitEdit, onCancelEdit,
  onImport, onDownload, onRemove, onDuplicate, onFlipH, onFlipV,
  isDragging, isDragOver, canReorder, onDragStart, onDragOver, onDrop, onDragEnd,
}: AssetCardProps) {
  // Scale preview to fit 140px wide, max 4×
  const previewScale = Math.min(4, 140 / asset.width);
  const previewW = Math.round(asset.width  * previewScale);
  const previewH = Math.round(asset.height * previewScale);

  return (
    <div
      className={`flex flex-col bg-gray-900 border rounded-lg overflow-hidden transition-colors ${
        isDragOver ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-gray-700 hover:border-gray-500'
      } ${isDragging ? 'opacity-40' : ''}`}
      draggable={canReorder && !isEditing}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Thumbnail */}
      <div
        className="flex items-center justify-center p-2"
        style={{
          background: 'repeating-conic-gradient(#1a1a2e 0% 25%, #16213e 0% 50%) 0 0 / 8px 8px',
          minHeight: Math.max(60, previewH + 16),
        }}
      >
        <img
          src={asset.objectUrl}
          alt={asset.name}
          style={{
            width: previewW,
            height: previewH,
            imageRendering: 'pixelated',
          }}
        />
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-2 flex-1">
        {isEditing ? (
          <>
            <input
              autoFocus
              type="text"
              value={editName}
              onChange={e => onEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
              className="bg-gray-800 border border-indigo-500 text-white text-xs px-1.5 py-0.5 rounded w-full"
            />
            <input
              type="text"
              value={editTags}
              onChange={e => onEditTags(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
              placeholder="tags, comma, separated"
              className="bg-gray-800 border border-gray-600 text-white text-xs px-1.5 py-0.5 rounded w-full"
            />
            <div className="flex gap-1">
              <button onClick={onCommitEdit} className="flex-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-1.5 py-0.5 rounded">Save</button>
              <button onClick={onCancelEdit} className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-1">
              <span className="text-xs text-gray-200 font-medium truncate" title={asset.name}>{asset.name}</span>
              <button
                onClick={onStartEdit}
                className="text-gray-600 hover:text-gray-300 text-xs flex-shrink-0"
                title="Edit name / tags"
              >✎</button>
            </div>

            <span className="text-xs text-gray-600">{asset.width}×{asset.height}px</span>

            {asset.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {asset.tags.map(tag => (
                  <span key={tag} className="text-xs bg-gray-800 text-gray-400 px-1 rounded">{tag}</span>
                ))}
              </div>
            )}
          </>
        )}

        {!isEditing && (
          <div className="flex flex-col gap-1 mt-auto pt-1">
            {/* Primary row */}
            <div className="flex gap-1">
              <button
                onClick={onImport}
                className="flex-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-1.5 py-1 rounded"
                title="Import as layer in Composer"
              >
                + Layer
              </button>
              <button
                onClick={onDownload}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1.5 py-1 rounded"
                title="Download PNG"
              >↓</button>
              <button
                onClick={onRemove}
                className="text-xs bg-gray-700 hover:bg-red-900 text-gray-500 hover:text-red-300 px-1.5 py-1 rounded"
                title="Remove from library"
              >✕</button>
            </div>
            {/* Secondary row — transform / duplicate */}
            <div className="flex gap-1">
              <button
                onClick={onDuplicate}
                className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1.5 py-1 rounded"
                title="Duplicate asset"
              >⧉ Dup</button>
              <button
                onClick={onFlipH}
                className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1.5 py-1 rounded"
                title="Flip horizontally"
              >↔ H</button>
              <button
                onClick={onFlipV}
                className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-1.5 py-1 rounded"
                title="Flip vertically"
              >↕ V</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
