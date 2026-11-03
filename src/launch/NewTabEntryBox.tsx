// TERM-042: the new tab entry box in the plus menu. Typed text becomes rows (open the address, open
// the file, jump to an open tab, a remembered entry); arrow keys move, Enter runs the highlighted one.
import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { entryRows, looksLikePath, moveHighlight, runRow, webAddress } from "../terminal/newTabEntry";
import { entryTarget, loadEntries, remember, type EntryTarget } from "./newTabEntryRun";
import "./plusMenuExtras.css";

type Props = { tabs: { key: number; name: string }[]; onRun: (target: EntryTarget) => void };

export default function NewTabEntryBox({ tabs, onRun }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const [recents, setRecents] = useState(loadEntries);
  const [files, setFiles] = useState<Record<string, boolean>>({}); // path -> a real file, from path_kind

  useEffect(() => {
    const t = text.trim();
    if (!looksLikePath(t) || webAddress(t) || t in files) return;
    let live = true;
    const timer = setTimeout(() => {
      const set = (ok: boolean) => live && setFiles((f) => ({ ...f, [t]: ok }));
      invoke<string>("path_kind", { path: t }).then((k) => set(k === "file"), () => set(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, files]);

  const rows = entryRows(text, { tabs, history: recents, recents, fileExists: (p) => files[p.trim()] === true });
  const run = (i: number) => {
    const row = runRow(rows, i);
    const target = row && entryTarget(row);
    if (!row || !target) return;
    setRecents(remember(recents, row));
    onRun(target);
  };
  const active = rows.length > 0 ? Math.min(at, rows.length - 1) : -1;

  return (
    <div className="menu-entry">
      <input
        className="field menu-search"
        placeholder="Type a URL or path"
        aria-label="Open a URL, a file or an open tab"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls={`${id}-rows`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          // The menu closes on Escape itself (PlusMenu); a box holding text is only cleared first.
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            setText("");
            setAt(0);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setAt(moveHighlight(active, rows.length, e.key === "ArrowDown" ? 1 : -1));
          } else if (e.key === "Enter") run(active);
        }}
      />
      {rows.length > 0 && (
        <div className="menu-entry-rows" role="listbox" id={`${id}-rows`} aria-label={text.trim() ? "Results" : "Recent entries"}>
          {rows.map((r, i) => (
            <button key={`${r.kind}-${i}`} id={`${id}-${i}`} role="option" aria-selected={i === active} className="menu-item" onMouseEnter={() => setAt(i)} onClick={() => run(i)} title={r.detail ? `${r.label}  ${r.detail}` : r.label}>
              <span className="name">{r.label}</span>
              {r.detail && <span className="menu-entry-detail">{r.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
