// EDIT-048 (T-317): a text box for a repository or base branch that narrows its suggestions as you type
// (pickList: every typed word, prefix matches first, at most 50 shown and the rest counted). The box stays
// free text, so a name that is not in the list can still be typed. Used by the automation dialog; the
// pull request composer's base field can take it once it has a branch list.
import { useRef, useState } from "react";
import { pickList } from "./pickerSearch";

/** Where focus goes on an arrow key between the box (-1) and its suggestions (0..count-1); null when the key does nothing. */
export function pickStep(count: number, at: number, key: string): number | null {
  if (key === "ArrowDown") return count === 0 ? null : at < 0 ? 0 : Math.min(count - 1, at + 1);
  if (key === "ArrowUp") return at < 0 ? null : at - 1;
  if (at >= 0 && key === "Home") return 0;
  if (at >= 0 && key === "End") return count - 1;
  return null;
}

type Props = { items: readonly string[]; value: string; onChange: (v: string) => void; label: string; placeholder?: string };

export default function SearchPick({ items, value, onChange, label, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const { shown, more } = pickList(items, value);
  const exact = items.includes(value);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const options = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  // Arrow keys walk from the box into the suggestions and back (a suggestion is a button, so Tab reaches them too).
  const walk = (e: React.KeyboardEvent) => {
    const rows = options();
    const to = pickStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    (to < 0 ? box.current : rows[to])?.focus();
  };
  return (
    <div className="search-pick" onBlur={(e) => e.currentTarget.contains(e.relatedTarget as Node | null) || setOpen(false)}>
      <input
        ref={box}
        className="field"
        aria-label={label}
        aria-expanded={open}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => (onChange(e.target.value), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) return (e.stopPropagation(), setOpen(false));
          if (open && !exact) walk(e);
        }}
      />
      {open && !exact && (shown.length > 0 || more > 0) && (
        <div
          ref={list}
          className="search-pick-list"
          role="listbox"
          aria-label={`${label} suggestions`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              box.current?.focus(); // its focus handler opens the list, so close it after
              setOpen(false);
            } else walk(e);
          }}
        >
          {shown.map((s) => (
            <button key={s} type="button" role="option" aria-selected={false} className="menu-item" onClick={() => (onChange(s), box.current?.focus(), setOpen(false))}>
              {s}
            </button>
          ))}
          {more > 0 && <div className="search-pick-more">{more} more, type to narrow</div>}
        </div>
      )}
    </div>
  );
}
