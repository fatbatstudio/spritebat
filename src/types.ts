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
 * cols × rows must equal directions × framesPerDirection.
 * e.g. 4 dirs × 3 frames = 12 total frames:
 *   - Classic:    cols=3, rows=4  (3 frames across, 1 row per direction)
 *   - Single row: cols=12, rows=1 (all frames in one row)
 *   - Any split:  cols=6, rows=2  etc.
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
  /** How this layer's source PNG is laid out. Defaults to match project config. */
  inputLayout: SheetLayout;
  /**
   * Optional per-frame position adjustments (indexed by frame index within a direction).
   * Added on top of offsetX/offsetY. Useful for animating a hat bobbing with the character.
   */
  frameOffsets?: Array<{ x: number; y: number }>;
}

export interface ProjectConfig {
  frameWidth: number;
  frameHeight: number;
  framesPerDirection: number;
  directions: 4 | 8;
  /** Default input layout assumed when adding new layers */
  defaultInputLayout: SheetLayout;
  /** Layout used when exporting the full composite sheet */
  exportLayout: SheetLayout;
}

export type AppTab = 'composer' | 'splitter';

export type PlaybackMode = 'forward' | 'reverse' | 'pingpong';

export interface SplitterState {
  image: HTMLImageElement | null;
  objectUrl: string | null;
  selection: { x: number; y: number; w: number; h: number } | null;
  extractedCanvas: HTMLCanvasElement | null;
  posX: number;
  posY: number;
  scale: number;
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
  /** When true, dragging the main canvas current-frame view sets per-frame offsets on the selected layer */
  frameOffsetMode: boolean;
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
      previewZoom: number; canvasZoom: number; sheetZoom: number; activeTab: AppTab };

/** Total logical frames in a project */
export function totalFrames(config: ProjectConfig): number {
  return config.directions * config.framesPerDirection;
}

/**
 * Given a flat frame index n (0-based), return the source pixel rect
 * within a sheet that uses the given layout and frame dimensions.
 */
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

/**
 * Flat frame index from direction row + frame-within-direction.
 */
export function flatIndex(directionRow: number, frameIndex: number, framesPerDirection: number): number {
  return directionRow * framesPerDirection + frameIndex;
}
