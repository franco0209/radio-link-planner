import { useEffect, useId, useRef, useState } from 'react';

interface FieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
}

/**
 * Numeric input that lets people type freely (empty, "-", "2.") and only commits valid numbers,
 * so the field never fights the keyboard.
 */
export function Field({ label, value, onChange, unit, hint, min, max, step = 'any' }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = (text: string) => {
    setDraft(text);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      if ((min !== undefined && n < min) || (max !== undefined && n > max)) return;
      onChange(n);
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={draft}
          min={min}
          max={max}
          step={step}
          aria-describedby={hint ? hintId : undefined}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setDraft(String(value));
          }}
          onChange={(e) => commit(e.target.value)}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}
