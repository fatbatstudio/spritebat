import type { AppState, AppAction } from './types';
import { DIRECTIONS_4 } from './types';


export const initialState: AppState = {
  config: {
    frameWidth: 48,
    frameHeight: 48,
    framesPerDirection: 10,
    directions: 4,
    defaultInputLayout: { cols: 10, rows: 4 },  // 10 frames × 4 directions
    exportLayout: { cols: 10, rows: 4 },
  },
  layers: [],
  selectedLayerId: null,
  activeTab: 'composer',
  previewDirection: 'down',
  previewFrame: 0,
  previewPlaying: false,
  previewMode: 'forward' as const,
  previewFps: 8,
  previewZoom: 4,
  canvasZoom: 2,
  sheetZoom: 1,
  splitter: {
    image: null,
    objectUrl: null,
    selection: null,
    extractedCanvas: null,
    posX: 0,
    posY: 0,
    scale: 1,
  },
  showConfig: false,
  frameOffsetMode: false,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONFIG': {
      const oldDefault = state.config.defaultInputLayout;
      const newDefault = action.config.defaultInputLayout;
      const defaultChanged =
        oldDefault.cols !== newDefault.cols || oldDefault.rows !== newDefault.rows;

      let layers = state.layers;
      if (action.resetLayerLayouts) {
        // Force all layers to adopt the new default input layout
        layers = layers.map(l => ({ ...l, inputLayout: { ...newDefault } }));
      } else if (defaultChanged) {
        // Auto-update only layers that still match the old default
        layers = layers.map(l =>
          l.inputLayout.cols === oldDefault.cols && l.inputLayout.rows === oldDefault.rows
            ? { ...l, inputLayout: { ...newDefault } }
            : l
        );
      }
      return { ...state, config: action.config, layers, showConfig: false };
    }

    case 'ADD_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.layer],
        selectedLayerId: action.layer.id,
      };

    case 'REMOVE_LAYER': {
      const layers = state.layers.filter(l => l.id !== action.id);
      const selectedLayerId =
        state.selectedLayerId === action.id
          ? (layers.length > 0 ? layers[layers.length - 1].id : null)
          : state.selectedLayerId;
      return { ...state, layers, selectedLayerId };
    }

    case 'UPDATE_LAYER':
    case 'UPDATE_LAYER_TRANSIENT':
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.id ? { ...l, ...action.updates } : l
        ),
      };

    case 'REORDER_LAYERS': {
      const layers = [...state.layers];
      const [moved] = layers.splice(action.fromIndex, 1);
      layers.splice(action.toIndex, 0, moved);
      return { ...state, layers };
    }

    case 'SELECT_LAYER':
      // Exit frame offset mode when switching layers to avoid accidental edits
      return { ...state, selectedLayerId: action.id, frameOffsetMode: false };

    case 'SET_TAB':
      return { ...state, activeTab: action.tab };

    case 'SET_PREVIEW_DIRECTION':
      return { ...state, previewDirection: action.direction, previewFrame: 0 };

    case 'SET_PREVIEW_FRAME':
      return { ...state, previewFrame: action.frame };

    case 'SET_PREVIEW_PLAYING':
      return { ...state, previewPlaying: action.playing };

    case 'SET_PREVIEW_MODE':
      return { ...state, previewMode: action.mode };

    case 'SET_PREVIEW_FPS':
      return { ...state, previewFps: action.fps };

    case 'SET_PREVIEW_ZOOM':
      return { ...state, previewZoom: action.zoom };

    case 'SET_CANVAS_ZOOM':
      return { ...state, canvasZoom: action.zoom };

    case 'SET_SHEET_ZOOM':
      return { ...state, sheetZoom: action.zoom };

    case 'SET_SPLITTER':
      return { ...state, splitter: { ...state.splitter, ...action.updates } };

    case 'TOGGLE_CONFIG':
      return { ...state, showConfig: !state.showConfig };

    case 'SET_FRAME_OFFSET_MODE':
      // Pause playback when entering the mode so user can step through frames cleanly
      return {
        ...state,
        frameOffsetMode: action.active,
        previewPlaying: action.active ? false : state.previewPlaying,
      };

    case 'LOAD_PROJECT':
      return {
        ...state,
        config:           action.config,
        layers:           action.layers,
        selectedLayerId:  action.selectedLayerId,
        previewDirection: action.previewDirection,
        previewFrame:     action.previewFrame,
        previewMode:      action.previewMode,
        previewFps:       action.previewFps,
        previewZoom:      action.previewZoom,
        canvasZoom:       action.canvasZoom,
        sheetZoom:        action.sheetZoom,
        activeTab:        action.activeTab,
        // Reset transient state
        previewPlaying:   false,
        frameOffsetMode:  false,
        showConfig:       false,
      };

    default:
      return state;
  }
}

export function getDirectionRow(
  direction: string,
  directions: 4 | 8
): number {
  const dirs = directions === 4 ? DIRECTIONS_4 : ['down', 'down-left', 'left', 'up-left', 'up', 'up-right', 'right', 'down-right'];
  return dirs.indexOf(direction as never);
}
