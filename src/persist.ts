/**
 * Lightweight localStorage persistence for SpriteBat.
 * We persist the project config and UI preferences (zoom, fps, etc.)
 * but NOT layers — they contain HTMLImageElement objects that can't be
 * serialised to JSON, and images need to come from the file system anyway.
 */

import type { ProjectConfig, PlaybackMode, AppTab } from './types';

const KEY = 'spritebat_v1';

export interface PersistedState {
  config: ProjectConfig;
  previewMode: PlaybackMode;
  previewFps: number;
  previewZoom: number;
  canvasZoom: number;
  sheetZoom: number;
  activeTab: AppTab;
}

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export function savePersistedState(s: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
}
