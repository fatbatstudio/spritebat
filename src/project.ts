/**
 * SpriteBat project save / load
 *
 * File format: a ZIP renamed to .spritebat containing:
 *   project.json  — all non-image data (config, layer metadata, ui state)
 *   layers/       — one PNG per layer, named by layer ID
 *     <id>.png
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { AppState, Layer, ProjectConfig, PlaybackMode, AppTab, Direction } from './types';

// ─── Serialisable types ───────────────────────────────────────────────────────

export interface SavedLayer {
  id: string;
  name: string;
  type: Layer['type'];
  visible: boolean;
  opacity: number;
  hsl: Layer['hsl'];
  fileName: string;
  offsetX: number;
  offsetY: number;
  inputLayout: Layer['inputLayout'];
  frameOffsets?: Layer['frameOffsets'];
  // image lives in layers/<id>.png — not here
}

export interface SavedUi {
  selectedLayerId: string | null;
  previewDirection: Direction;
  previewFrame: number;
  previewMode: PlaybackMode;
  previewFps: number;
  previewZoom: number;
  canvasZoom: number;
  sheetZoom: number;
  activeTab: AppTab;
}

export interface ProjectFile {
  version: 1;
  config: ProjectConfig;
  layers: SavedLayer[];
  ui: SavedUi;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Serialise current app state into a .spritebat ZIP and trigger a download.
 */
export async function saveProject(state: AppState, filename = 'project.spritebat'): Promise<void> {
  const zip = new JSZip();
  const layersFolder = zip.folder('layers')!;

  const savedLayers: SavedLayer[] = [];

  for (const layer of state.layers) {
    // Serialise metadata (no image)
    savedLayers.push({
      id:           layer.id,
      name:         layer.name,
      type:         layer.type,
      visible:      layer.visible,
      opacity:      layer.opacity,
      hsl:          layer.hsl,
      fileName:     layer.fileName,
      offsetX:      layer.offsetX,
      offsetY:      layer.offsetY,
      inputLayout:  layer.inputLayout,
      ...(layer.frameOffsets && { frameOffsets: layer.frameOffsets }),
    });

    // Add the PNG from the objectUrl if available
    if (layer.objectUrl) {
      const response = await fetch(layer.objectUrl);
      const blob = await response.blob();
      layersFolder.file(`${layer.id}.png`, blob);
    }
  }

  const projectFile: ProjectFile = {
    version: 1,
    config:  state.config,
    layers:  savedLayers,
    ui: {
      selectedLayerId:  state.selectedLayerId,
      previewDirection: state.previewDirection,
      previewFrame:     state.previewFrame,
      previewMode:      state.previewMode,
      previewFps:       state.previewFps,
      previewZoom:      state.previewZoom,
      canvasZoom:       state.canvasZoom,
      sheetZoom:        state.sheetZoom,
      activeTab:        state.activeTab,
    },
  };

  zip.file('project.json', JSON.stringify(projectFile, null, 2));

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, filename);
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export interface LoadedProject {
  config: ProjectConfig;
  layers: Layer[];
  ui: SavedUi;
}

/**
 * Read a .spritebat file (ZIP) and reconstruct fully hydrated Layer objects
 * with live HTMLImageElement references.
 */
export async function loadProject(file: File): Promise<LoadedProject> {
  const zip = await JSZip.loadAsync(file);

  // 1. Parse project.json
  const jsonFile = zip.file('project.json');
  if (!jsonFile) throw new Error('Invalid .spritebat file: missing project.json');
  const projectFile: ProjectFile = JSON.parse(await jsonFile.async('text'));

  if (projectFile.version !== 1) {
    throw new Error(`Unsupported project version: ${projectFile.version}`);
  }

  // 2. Hydrate layers
  const layers: Layer[] = [];

  for (const saved of projectFile.layers) {
    const pngFile = zip.file(`layers/${saved.id}.png`);

    let image: HTMLImageElement | null = null;
    let objectUrl: string | null = null;

    if (pngFile) {
      const blob = await pngFile.async('blob');
      objectUrl = URL.createObjectURL(blob);
      image = await loadImage(objectUrl);
    }

    layers.push({
      id:          saved.id,
      name:        saved.name,
      type:        saved.type,
      visible:     saved.visible,
      opacity:     saved.opacity,
      hsl:         saved.hsl,
      fileName:    saved.fileName,
      offsetX:     saved.offsetX,
      offsetY:     saved.offsetY,
      inputLayout: saved.inputLayout,
      frameOffsets: saved.frameOffsets,
      image,
      objectUrl,
    });
  }

  return {
    config: projectFile.config,
    layers,
    ui:     projectFile.ui,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
