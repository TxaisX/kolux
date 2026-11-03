// TERM-077: the find bar over a pane. Enter goes to the next match, Shift+Enter to the previous, Escape
// closes; Aa toggles Match case, .* toggles Regex. The pane does the searching and the drawing; the bar
// only holds the query and the toggles and shows the count. Inline styles on the chrome's tokens, so the
// stylesheet (another lane's file) is untouched.
import { useEffect, useRef, useState } from "react";
import { Close } from "../chrome/icons";
import { compile, countLabel, type FindOptions } from "./find";

type Props = {
  /** Changes each time Find is asked for again while the bar is open; the field takes focus. */
  focusTick?: number;
  count: number;
  current: number;
  /** The regex search was stopped for running too long. */
  slow?: boolean;
  onSearch: (query: string, opts: FindOptions) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
};

const bar: React.CSSProperties = { position: "absolute", top: 4, right: 12, zIndex: 3, display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,.25)", font: "12px system-ui, sans-serif", color: "var(--fg)" };
const field: React.CSSProperties = { width: 180, padding: "2px 6px", background: "var(--input-bg)", color: "var(--fg)", border: "1px solid var(--line)", borderRadius: 4, font: "inherit" };
const toggle = (on: boolean): React.CSSProperties => ({ padding: "2px 5px", border: `1px solid ${on ? "var(--line-focus)" : "var(--line)"}`, borderRadius: 4, background: on ? "var(--row-selected)" : "transparent", color: "var(--fg)", font: "inherit", cursor: "pointer" });
const plain: React.CSSProperties = { padding: "2px 5px", border: "1px solid transparent", borderRadius: 4, background: "transparent", color: "var(--fg)", font: "inherit", cursor: "pointer" };
// T-696: Previous / Next are greyed out while there is nothing to step to (no query, or "No matches").
const step = (off: boolean): React.CSSProperties => (off ? { ...plain, opacity: 0.4, cursor: "default" } : plain);

export default function FindBar({ focusTick = 0, count, current, slow = false, onSearch, onStep, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [opts, setOpts] = useState<FindOptions>({ caseSensitive: false, regex: false });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);
  const update = (q: string, o: FindOptions) => {
    setQuery(q);
    setOpts(o);
    onSearch(q, o);
  };
  const invalid = query !== "" && opts.regex && compile(query, opts) === null;
  const label = invalid ? "Invalid pattern" : slow ? "Pattern took too long" : countLabel(count, current, query);
  return (
    <div
      role="search"
      aria-label="Find in terminal"
      style={bar}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onStep(e.shiftKey ? -1 : 1);
        } else if (e.key === "F3") {
          e.preventDefault();
          onStep(e.shiftKey ? -1 : 1);
        }
      }}
    >
      <input ref={input} style={field} value={query} placeholder="Find" aria-label="Find" spellCheck={false} onChange={(e) => update(e.target.value, opts)} />
      <span role="status" aria-live="polite" style={{ minWidth: 64, textAlign: "center", color: count === 0 && query ? "var(--fg)" : "var(--fg-muted)" }}>
        {label}
      </span>
      <button type="button" style={toggle(opts.caseSensitive)} aria-pressed={opts.caseSensitive} title="Match case" onClick={() => update(query, { ...opts, caseSensitive: !opts.caseSensitive })}>
        Aa
      </button>
      <button type="button" style={toggle(opts.regex)} aria-pressed={opts.regex} title="Regular expression" onClick={() => update(query, { ...opts, regex: !opts.regex })}>
        .*
      </button>
      <button type="button" style={step(!count)} disabled={!count} title="Previous match (Shift+Enter)" aria-label="Previous match" onClick={() => onStep(-1)}>
        ↑
      </button>
      <button type="button" style={step(!count)} disabled={!count} title="Next match (Enter)" aria-label="Next match" onClick={() => onStep(1)}>
        ↓
      </button>
      <button type="button" className="ib" title="Close (Escape)" aria-label="Close find" onClick={onClose}>
        <Close size={11} />
      </button>
    </div>
  );
}
