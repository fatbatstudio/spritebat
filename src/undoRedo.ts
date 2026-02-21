/**
 * Undo/Redo — higher-order reducer (Option A)
 *
 * Wraps AppState in a { past, present, future } envelope.
 * The inner appReducer is completely untouched; this file only
 * decides *which* actions push a snapshot onto the undo stack.
 *
 * Stack entries contain only the undoable slice of AppState
 * (config + layers + selectedLayerId + library), keeping memory use low.
 * Non-undoable state (zoom, playback, splitter, etc.) is never
 * snapshotted and is unaffected by undo/redo.
 */

import type { AppState, AppAction } from './types';
import { appReducer } from './state';

// ─── Undoable snapshot ────────────────────────────────────────────────────────

/**
 * The subset of AppState we snapshot for undo/redo.
 * Images are HTMLImageElement references — shared, not copied.
 */
interface Snapshot {
  config:          AppState['config'];
  layers:          AppState['layers'];
  selectedLayerId: AppState['selectedLayerId'];
  library:         AppState['library'];
}

function snapshot(s: AppState): Snapshot {
  return {
    config:          s.config,
    layers:          s.layers,
    selectedLayerId: s.selectedLayerId,
    library:         s.library,
  };
}

function applySnapshot(present: AppState, snap: Snapshot): AppState {
  return {
    ...present,
    config:          snap.config,
    layers:          snap.layers,
    selectedLayerId: snap.selectedLayerId,
    library:         snap.library,
  };
}

// ─── Which actions push to the undo stack ────────────────────────────────────

/**
 * Actions that mutate project data and should be undoable.
 * Everything else (navigation, zoom, playback, UI toggles) is
 * not snapshotted.
 */
const UNDOABLE: ReadonlySet<AppAction['type']> = new Set([
  'SET_CONFIG',
  'ADD_LAYER',
  'REMOVE_LAYER',
  'UPDATE_LAYER',        // committed changes (pointer up, blur, button clicks)
  'REORDER_LAYERS',
  'MERGE_LAYERS_DOWN',
  // UPDATE_LAYER_TRANSIENT is intentionally excluded — slider drag feedback only
  'ADD_LIBRARY_ASSET',
  'REMOVE_LIBRARY_ASSET',
  'UPDATE_LIBRARY_ASSET',
  'REORDER_LIBRARY',
]);

// Maximum number of undo steps kept in memory.
const MAX_HISTORY = 100;

// ─── Wrapper state ───────────────────────────────────────────────────────────

export interface UndoRedoState {
  past:    Snapshot[];   // oldest → newest (past[past.length-1] is "one step back")
  present: AppState;
  future:  Snapshot[];   // newest → oldest (future[0] is "one step forward")
}

export type UndoRedoAction =
  | AppAction
  | { type: 'UNDO' }
  | { type: 'REDO' };

// ─── Higher-order reducer ────────────────────────────────────────────────────

export function undoRedoReducer(
  state: UndoRedoState,
  action: UndoRedoAction
): UndoRedoState {

  // ── UNDO ──────────────────────────────────────────────────────────────────
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;               // nothing to undo
    const previous = state.past[state.past.length - 1];
    const newPast  = state.past.slice(0, -1);
    return {
      past:    newPast,
      present: applySnapshot(state.present, previous),
      future:  [snapshot(state.present), ...state.future],
    };
  }

  // ── REDO ──────────────────────────────────────────────────────────────────
  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;             // nothing to redo
    const next      = state.future[0];
    const newFuture = state.future.slice(1);
    return {
      past:    [...state.past, snapshot(state.present)],
      present: applySnapshot(state.present, next),
      future:  newFuture,
    };
  }

  // ── SNAPSHOT — push current state to undo stack without changing anything ──
  // Used at the start of a drag so that transient updates can be undone as a group.
  if (action.type === 'SNAPSHOT') {
    const past = [...state.past, snapshot(state.present)];
    return {
      past:    past.length > MAX_HISTORY ? past.slice(-MAX_HISTORY) : past,
      present: state.present,
      future:  [],
    };
  }

  // ── LOAD_PROJECT / CLOSE_PROJECT — replace everything, clear history ─────
  if (action.type === 'LOAD_PROJECT' || action.type === 'CLOSE_PROJECT') {
    const nextPresent = appReducer(state.present, action);
    return { past: [], present: nextPresent, future: [] };
  }

  // ── All other actions — run the inner reducer ────────────────────────────
  const nextPresent = appReducer(state.present, action);

  if (UNDOABLE.has(action.type)) {
    // Snapshot BEFORE the change, push to past, clear future
    const past = [...state.past, snapshot(state.present)];
    return {
      past:    past.length > MAX_HISTORY ? past.slice(-MAX_HISTORY) : past,
      present: nextPresent,
      future:  [],
    };
  }

  // Non-undoable: just update present, leave history intact
  return { ...state, present: nextPresent };
}

// ─── Initial wrapper state ───────────────────────────────────────────────────

export function buildUndoRedoState(present: AppState): UndoRedoState {
  return { past: [], present, future: [] };
}
