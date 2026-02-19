import type { AppState, AppAction } from './types';
import { DIRECTIONS_4 } from './types';


export const initialState: AppState = {
  config: {
    frameWidth: 48,
    frameHeight: 48,
    framesPerDirection: 10,
    directions: 4,
    defaultInputLayout: { cols: 10, rows: 4 },
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
    selectionMask: null,
    selectionBounds: null,
    extractedCanvas: null,
    posX: 0,
    posY: 0,
    scale: 1,
  },
  showConfig: false,
  frameOffsetMode: false,
  library: [],
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
        layers = layers.map(l => ({ ...l, inputLayout: { ...newDefault } }));
      } else if (defaultChanged) {
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
        library:          action.library,
        previewPlaying:   false,
        frameOffsetMode:  false,
        showConfig:       false,
      };

    case 'ADD_LIBRARY_ASSET':
      return { ...state, library: [...state.library, action.asset] };

    case 'REMOVE_LIBRARY_ASSET':
      return { ...state, library: state.library.filter(a => a.id !== action.id) };

    case 'UPDATE_LIBRARY_ASSET':
      return {
        ...state,
        library: state.library.map(a =>
          a.id === action.id ? { ...a, ...action.updates } : a
        ),
      };

    case 'MERGE_LAYERS_DOWN': {
      // Replace layers[index] and layers[index-1] with mergedLayer at index-1
      const layers = [...state.layers];
      layers.splice(action.index - 1, 2, action.mergedLayer);
      const selectedLayerId =
        state.selectedLayerId === state.layers[action.index]?.id ||
        state.selectedLayerId === state.layers[action.index - 1]?.id
          ? action.mergedLayer.id
          : state.selectedLayerId;
      return { ...state, layers, selectedLayerId };
    }

    case 'CLOSE_PROJECT':
      // Clear project data; preserve config and zoom/UI prefs.
      return {
        ...initialState,
        config:       state.config,
        canvasZoom:   state.canvasZoom,
        sheetZoom:    state.sheetZoom,
        previewZoom:  state.previewZoom,
        previewFps:   state.previewFps,
        previewMode:  state.previewMode,
        activeTab:    state.activeTab,
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
