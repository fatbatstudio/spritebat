import React, { useState, useRef } from 'react';
import type { AppAction, AppState, LibraryAsset } from '../types';
import { ImportFrameModal } from './ImportFrameModal';
import { loadProject, saveLibrary } from '../project';

interface LibraryTabProps {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export function LibraryTab({ state, dispatch }: LibraryTabProps) {
  const { library, config } = state;
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

  // Filter by name or tag
  const query = search.trim().toLowerCase();
  const filtered = query
    ? library.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.tags.some(t => t.toLowerCase().includes(query))
      )
    : library;

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
    URL.revokeObjectURL(asset.objectUrl);
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
      for (const asset of project.library) {
        dispatch({ type: 'ADD_LIBRARY_ASSET', asset });
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

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) importFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
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
          className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1 rounded w-48"
        />
      </div>

      {/* Grid — also a drop target */}
      <div
        className={`relative flex-1 overflow-y-auto p-4 transition-colors ${dragOver ? 'bg-indigo-950/40' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
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
            No assets match "{search}"
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
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
              />
            ))}
          </div>
        )}
        {/* Drop hint overlay when dragging over a populated library */}
        {dragOver && library.length > 0 && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="bg-indigo-900/80 text-indigo-200 text-sm px-4 py-2 rounded-lg border border-indigo-500">
              Drop to add to library
            </div>
          </div>
        )}
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
}

function AssetCard({
  asset, isEditing, editName, editTags,
  onEditName, onEditTags, onStartEdit, onCommitEdit, onCancelEdit,
  onImport, onDownload, onRemove, onDuplicate, onFlipH, onFlipV,
}: AssetCardProps) {
  // Scale preview to fit 140px wide, max 4×
  const previewScale = Math.min(4, 140 / asset.width);
  const previewW = Math.round(asset.width  * previewScale);
  const previewH = Math.round(asset.height * previewScale);

  return (
    <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-lg overflow-hidden hover:border-gray-500 transition-colors">
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
