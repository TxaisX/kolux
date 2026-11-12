// SET-036: a typed number, corrected on Enter or on leaving the field, and kept when the page closes;
// `buttons` adds minus and plus, greyed at the ends. Audit N-48: the terminal page's line-height and
// scroll-speed boxes and the full-screen scroll speed were two copies of this.
import { useEffect, useState } from "react";
import { useLeaveSave } from "./leave";
import { clampNumber } from "../terminal/text";

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  buttons = false,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  buttons?: boolean;
  onSave: (n: number) => void;
}) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const commit = (raw: unknown) => {
    const n = clampNumber(raw, min, max, value, step);
    setTyped(String(n));
    if (n !== value) onSave(n);
  };
  useLeaveSave(() => typed !== String(value) && commit(typed)); // SET-036: changing page or closing keeps what was typed
  return (
    <label className="num-field">
      <span>{label}</span>
      {buttons && (
        <button type="button" className="btn" aria-label={`Smaller ${label.toLowerCase()}`} disabled={value <= min} onClick={() => commit(value - step)}>
          −
        </button>
      )}
      <input type="number" min={min} max={max} step={step} value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => commit(typed)} onKeyDown={(e) => e.key === "Enter" && commit(typed)} />
      {buttons && (
        <button type="button" className="btn" aria-label={`Larger ${label.toLowerCase()}`} disabled={value >= max} onClick={() => commit(value + step)}>
          +
        </button>
      )}
    </label>
  );
}
