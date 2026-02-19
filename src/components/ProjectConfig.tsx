import { useState } from 'react';
import type { ProjectConfig as ProjectConfigType, AppAction, SheetLayout } from '../types';
import { NumericInput } from './NumericInput';

// ── helpers ──────────────────────────────────────────────────────────────────

function describeLayout(layout: SheetLayout, total: number) {
  const cells = layout.cols * layout.rows;
  const extra = cells - total;
  if (extra < 0) return { ok: false, msg: `Too few cells — need ${total}, have ${cells}` };
  if (extra > 0) return { ok: true, msg: `${cells} cells (${extra} empty at end)` };
  return { ok: true, msg: `${cells} cells — perfect fit` };
}

// ── sub-components ────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  className?: string;
}

function Field({ label, value, min, max, onChange, className }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400">{label}</label>
      <NumericInput
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        className={className ?? 'bg-gray-800 border border-gray-600 text-white text-sm px-3 py-1.5 rounded w-24'}
      />
    </div>
  );
}

interface LayoutEditorProps {
  label: string;
  layout: SheetLayout;
  total: number;
  onChange: (l: SheetLayout) => void;
}

function LayoutEditor({ label, layout, total, onChange }: LayoutEditorProps) {
  const { ok, msg } = describeLayout(layout, total);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-gray-400 font-semibold">{label}</label>
      <div className="flex items-end gap-3">
        <Field
          label="Columns"
          value={layout.cols}
          min={1}
          max={total * 2}
          onChange={cols => onChange({ cols, rows: layout.rows })}
        />
        <Field
          label="Rows"
          value={layout.rows}
          min={1}
          max={total * 2}
          onChange={rows => onChange({ cols: layout.cols, rows })}
        />
        <div className="flex flex-col gap-1 pb-0.5">
          <label className="text-xs text-gray-400 invisible">.</label>
          <div className={`text-xs px-2 py-1.5 rounded ${ok ? 'text-green-400 bg-green-950' : 'text-red-400 bg-red-950'}`}>
            {msg}
          </div>
        </div>
      </div>
      {/* Quick layout presets */}
      <div className="flex flex-wrap gap-1">
        {[
          { label: `${total}×1 (single row)`, cols: total, rows: 1 },
          { label: `1×${total} (single col)`, cols: 1, rows: total },
          ...(total > 1 ? [{ label: `classic`, cols: Math.ceil(total / 4), rows: 4 }] : []),
        ].map(p => (
          <button
            key={p.label}
            onClick={() => onChange({ cols: p.cols, rows: p.rows })}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Mini sheet diagram ────────────────────────────────────────────────────────

function SheetDiagram({ layout, total, frameW, frameH }: {
  layout: SheetLayout; total: number; frameW: number; frameH: number;
}) {
  const MAX_W = 320, MAX_H = 120;
  const cellW = Math.min(Math.floor(MAX_W / layout.cols), Math.floor(MAX_H / layout.rows), 40);
  const cellH = Math.round(cellW * (frameH / frameW));
  const w = cellW * layout.cols;
  const h = cellH * layout.rows;

  return (
    <svg width={w} height={h} style={{ display: 'block', maxWidth: '100%' }}>
      {Array.from({ length: layout.rows * layout.cols }).map((_, i) => {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const filled = i < total;
        return (
          <rect
            key={i}
            x={col * cellW + 0.5}
            y={row * cellH + 0.5}
            width={cellW - 1}
            height={cellH - 1}
            fill={filled ? '#4338ca33' : '#1f293780'}
            stroke={filled ? '#6366f1' : '#374151'}
            strokeWidth={0.5}
          />
        );
      })}
    </svg>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface ProjectConfigProps {
  config: ProjectConfigType;
  dispatch: React.Dispatch<AppAction>;
  onClose: () => void;
}

export function ProjectConfigModal({ config, dispatch, onClose }: ProjectConfigProps) {
  const [local, setLocal] = useState({ ...config });
  const [resetAllLayers, setResetAllLayers] = useState(false);

  const total = local.directions * local.framesPerDirection;

  // Detect if the default input layout has changed from the saved config
  const inputLayoutChanged =
    local.defaultInputLayout.cols !== config.defaultInputLayout.cols ||
    local.defaultInputLayout.rows !== config.defaultInputLayout.rows;

  function setTotal(dirs: 4 | 8, fpd: number) {
    setLocal(prev => ({
      ...prev,
      directions: dirs,
      framesPerDirection: fpd,
      // Leave cols/rows as-is; the validation badge will flag if they're now too small
    }));
  }

  function handleSave() {
    dispatch({ type: 'SET_CONFIG', config: local, resetLayerLayouts: resetAllLayers });
  }

  const inputDesc = describeLayout(local.defaultInputLayout, total);
  const exportDesc = describeLayout(local.exportLayout, total);
  const canSave = inputDesc.ok && exportDesc.ok;

  return (
    // Use onMouseDown on backdrop + onMouseDown stopPropagation on dialog.
    // This prevents closing when the user drags from inside the dialog and
    // releases the mouse over the backdrop (e.g. after selecting text in an input).
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onMouseDown={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 flex flex-col gap-5 overflow-y-auto"
        style={{ width: 520, maxHeight: '90vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Project Configuration</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* ── Frame size ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Frame Size</span>
          <div className="flex gap-4">
            <Field label="Width (px)" value={local.frameWidth} min={1} max={512}
              onChange={v => setLocal(p => ({ ...p, frameWidth: v }))} />
            <Field label="Height (px)" value={local.frameHeight} min={1} max={512}
              onChange={v => setLocal(p => ({ ...p, frameHeight: v }))} />
          </div>
        </div>

        {/* ── Animation ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Animation</span>
          <div className="flex gap-4 items-end">
            <Field label="Frames / Direction" value={local.framesPerDirection} min={1} max={128}
              onChange={v => setTotal(local.directions, v)} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Directions</label>
              <div className="flex gap-2">
                {([4, 8] as const).map(d => (
                  <button key={d} onClick={() => setTotal(d, local.framesPerDirection)}
                    className={`text-sm px-3 py-1.5 rounded ${local.directions === d ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    {d}dir {d === 4 ? '(↑↓←→)' : '(+diag)'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Total frames: <span className="text-gray-300">{total}</span>
          </div>
        </div>

        {/* ── Input layout ── */}
        <div className="flex flex-col gap-2 border border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Default Input Layout</span>
            <span className="text-xs text-gray-500">— how imported PNGs are arranged</span>
          </div>
          <LayoutEditor
            label=""
            layout={local.defaultInputLayout}
            total={total}
            onChange={l => setLocal(p => ({ ...p, defaultInputLayout: l }))}
          />
          <div className="mt-1">
            <SheetDiagram layout={local.defaultInputLayout} total={total} frameW={local.frameWidth} frameH={local.frameHeight} />
          </div>
        </div>

        {/* ── Export layout ── */}
        <div className="flex flex-col gap-2 border border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Export Layout</span>
            <span className="text-xs text-gray-500">— how the exported PNG sheet is arranged</span>
          </div>
          <LayoutEditor
            label=""
            layout={local.exportLayout}
            total={total}
            onChange={l => setLocal(p => ({ ...p, exportLayout: l }))}
          />
          <div className="mt-1">
            <SheetDiagram layout={local.exportLayout} total={total} frameW={local.frameWidth} frameH={local.frameHeight} />
          </div>
          <div className="text-xs text-gray-500">
            Output sheet: <span className="text-gray-300">{local.frameWidth * local.exportLayout.cols} × {local.frameHeight * local.exportLayout.rows} px</span>
          </div>
        </div>

        {/* ── Quick presets ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Quick Presets</span>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '16×16 · 4dir · 8f · single-row', fw: 16, fh: 16, f: 8, d: 4, ic: 32, ec: 32 },
              { label: '32×32 · 4dir · 8f · single-row', fw: 32, fh: 32, f: 8, d: 4, ic: 32, ec: 32 },
              { label: '48×48 · 4dir · 10f · classic',   fw: 48, fh: 48, f: 10, d: 4, ic: 10, ec: 10 },
              { label: '48×48 · 4dir · 3f · single-row', fw: 48, fh: 48, f: 3, d: 4, ic: 12, ec: 12 },
              { label: '64×64 · 8dir · 8f · classic',    fw: 64, fh: 64, f: 8, d: 8, ic: 8,  ec: 8  },
            ].map(p => {
              const t = p.d * p.f;
              const layout = { cols: p.ic, rows: Math.ceil(t / p.ic) };
              return (
                <button key={p.label} onClick={() => setLocal({
                  frameWidth: p.fw, frameHeight: p.fh,
                  framesPerDirection: p.f, directions: p.d as 4 | 8,
                  defaultInputLayout: layout,
                  exportLayout: { cols: p.ec, rows: Math.ceil(t / p.ec) },
                })}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded">
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Reset layers option — only shown when input layout changed */}
        {inputLayoutChanged && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={resetAllLayers}
              onChange={e => setResetAllLayers(e.target.checked)}
              className="accent-indigo-500 w-3.5 h-3.5"
            />
            <span className="text-xs text-gray-400">
              Reset <span className="text-white">all</span> layer input layouts to the new default
              <span className="text-gray-600 ml-1">(layers matching old default update automatically)</span>
            </span>
          </label>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 text-sm py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!canSave}
            className="flex-1 text-sm py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-bold">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
