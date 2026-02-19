import { useState, useEffect } from 'react';

interface NumericInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * A number input that keeps a local string while the user is typing,
 * only committing the parsed value on blur or Enter. This lets you
 * freely backspace, type "-", clear the field, etc. without the input
 * snapping back to 0 mid-edit.
 */
export function NumericInput({ value, min, max, step, onChange, className }: NumericInputProps) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // When the committed value changes externally (e.g. drag), sync the
  // display — but only if we're not in the middle of editing it ourselves.
  useEffect(() => {
    if (!focused) {
      setRaw(String(value)); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [value, focused]);

  function commit(str: string) {
    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      // Revert to last good value
      setRaw(String(value));
      return;
    }
    let clamped = parsed;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    const rounded = step === undefined || step >= 1 ? Math.round(clamped) : clamped;
    setRaw(String(rounded));
    onChange(rounded);
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step ?? 1}
      value={raw}
      className={className}
      onFocus={() => setFocused(true)}
      onChange={e => setRaw(e.target.value)}
      onBlur={e => {
        setFocused(false);
        commit(e.target.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
