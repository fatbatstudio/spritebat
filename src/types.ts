export type Direction = 'down' | 'left' | 'right' | 'up' | 'down-left' | 'down-right' | 'up-left' | 'up-right';

export const DIRECTIONS_4: Direction[] = ['down', 'left', 'right', 'up'];
export const DIRECTIONS_8: Direction[] = ['down', 'down-left', 'left', 'up-left', 'up', 'up-right', 'right', 'down-right'];

export type LayerType = 'Base' | 'Hair' | 'Top' | 'Bottom' | 'Accessory' | 'Hat' | 'Weapon' | 'Custom';

export interface HSLAdjustment {
  hue: number;       // -180 to 180
  saturation: number; // -100 to 100
  lightness: number;  // -100 to 100
}

/**
 * Describes how frames are physically arranged in a sprite sheet PNG.
 */
export interface SheetLayout {
  cols: number;
  rows: number;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;    // 0-100
  hsl: HSLAdjustment;
  image: HTMLImageElement | null;
  objectUrl: string | null;
  fileName: string;
  offsetX: number;
  offsetY: number;
  inputLayout: SheetLayout;
  frameOffsets?: Array<{ x: number; y: number }>;
}

export interface ProjectConfig {
  frameWidth: number;
  frameHeight: number;
  framesPerDirection: number;
  directions: 4 | 8;
  defaultInputLayout: SheetLayout;
  exportLayout: SheetLayout;
}

export type AppTab = 'composer' | 'splitter' | 'library';

export type PlaybackMode = 'forward' | 'reverse' | 'pingpong';

export type SplitterTool = 'box' | 'lasso';
export type SelectionMode = 'replace' | 'add' | 'subtract';

export interface SplitterState {
  image: HTMLImageElement | null;
  objectUrl: string | null;
  /**
   * The selection mask canvas — same pixel dimensions as `image`.
   * White pixels = selected, transparent/black = not selected.
   * null means no selection exists.
   */
  selectionMask: HTMLCanvasElement | null;
  /**
   * Bounding box of the current selection mask (in image-pixel space).
   * Derived from selectionMask for display and crop purposes.
   */
  selectionBounds: { x: number; y: number; w: number; h: number } | null;
  extractedCanvas: HTMLCanvasElement | null;
  /** Current zoom level — persisted in app state so it survives tab switches. */
  zoom: number;
  posX: number;
  posY: number;
  scale: number;
}

// ─── Asset Library ────────────────────────────────────────────────────────────

export interface LibraryAsset {
  id: string;
  name: string;
  tags: string[];
  objectUrl: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  createdAt: number;
}

export interface AppState {
  config: ProjectConfig;
  layers: Layer[];
  selectedLayerId: string | null;
  activeTab: AppTab;
  previewDirection: Direction;
  previewFrame: number;
  previewPlaying: boolean;
  previewMode: PlaybackMode;
  previewFps: number;
  previewZoom: number;
  canvasZoom: number;
  sheetZoom: number;
  splitter: SplitterState;
  showConfig: boolean;
  frameOffsetMode: boolean;
  library: LibraryAsset[];
}

export type AppAction =
  | { type: 'SET_CONFIG'; config: ProjectConfig; resetLayerLayouts?: boolean }
  | { type: 'ADD_LAYER'; layer: Layer }
  | { type: 'REMOVE_LAYER'; id: string }
  | { type: 'UPDATE_LAYER'; id: string; updates: Partial<Layer> }
  | { type: 'UPDATE_LAYER_TRANSIENT'; id: string; updates: Partial<Layer> }
  | { type: 'REORDER_LAYERS'; fromIndex: number; toIndex: number }
  | { type: 'SELECT_LAYER'; id: string | null }
  | { type: 'SET_TAB'; tab: AppTab }
  | { type: 'SET_PREVIEW_DIRECTION'; direction: Direction }
  | { type: 'SET_PREVIEW_FRAME'; frame: number }
  | { type: 'SET_PREVIEW_PLAYING'; playing: boolean }
  | { type: 'SET_PREVIEW_MODE'; mode: PlaybackMode }
  | { type: 'SET_PREVIEW_FPS'; fps: number }
  | { type: 'SET_PREVIEW_ZOOM'; zoom: number }
  | { type: 'SET_CANVAS_ZOOM'; zoom: number }
  | { type: 'SET_SHEET_ZOOM'; zoom: number }
  | { type: 'SET_SPLITTER'; updates: Partial<SplitterState> }
  | { type: 'TOGGLE_CONFIG' }
  | { type: 'SET_FRAME_OFFSET_MODE'; active: boolean }
  | { type: 'LOAD_PROJECT'; config: ProjectConfig; layers: Layer[];
      selectedLayerId: string | null; previewDirection: Direction;
      previewFrame: number; previewMode: PlaybackMode; previewFps: number;
      previewZoom: number; canvasZoom: number; sheetZoom: number; activeTab: AppTab;
      library: LibraryAsset[] }
  | { type: 'ADD_LIBRARY_ASSET'; asset: LibraryAsset }
  | { type: 'REMOVE_LIBRARY_ASSET'; id: string }
  | { type: 'UPDATE_LIBRARY_ASSET'; id: string; updates: Partial<Pick<LibraryAsset, 'name' | 'tags'>> }
  | { type: 'REORDER_LIBRARY'; fromIndex: number; toIndex: number }
  /** Merge the layer at `index` down into the layer at `index - 1`, replacing both with one flattened layer. */
  | { type: 'MERGE_LAYERS_DOWN'; index: number; mergedLayer: Layer }
  /** Reset the project to a blank slate (keeps config, clears layers + library + splitter). */
  | { type: 'CLOSE_PROJECT' }
  /** Push current state to undo stack without modifying present (used before drag/slider interactions). */
  | { type: 'SNAPSHOT' };

/** Total logical frames in a project */
export function totalFrames(config: ProjectConfig): number {
  return config.directions * config.framesPerDirection;
}

export function frameRect(
  n: number,
  layout: SheetLayout,
  frameWidth: number,
  frameHeight: number
): { sx: number; sy: number } {
  const col = n % layout.cols;
  const row = Math.floor(n / layout.cols);
  return { sx: col * frameWidth, sy: row * frameHeight };
}

export function flatIndex(directionRow: number, frameIndex: number, framesPerDirection: number): number {
  return directionRow * framesPerDirection + frameIndex;
}
