// A picker over files of the worktree: Mod+P's Quick Open (EDIT-036), Mod+Shift+O's markdown
// files (EDIT-012) and the New tab menu's changed files (EDIT-027). All three rank the same way.
// The list is asked for afresh each time the picker opens, so a failed listing is tried again
// rather than remembered.
import { useEffect, useMemo, useRef, useState } from "react";

export type Pick = { path: string; tag?: string; staged?: boolean };
export type Listing = { items: Pick[]; capped: boolean; note?: string };
type Props = { root: string; what: string; load: () => Promise<Listing>; onPick: (item: Pick) => void; onClose: () => void };

const SHOWN = 50;

const within = (s: string, q: string) => {
  let i = 0;
  for (const c of s) if (c === q[i] && ++i === q.length) return true;
  return false;
};

/** Where a query hits a lowercased worktree-relative path: in the file name (at its start is best),
 *  as letters in order in the name, in the folder path, as letters in order across the path; -1 for none. */
export function score(path: string, q: string): number {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const at = name.indexOf(q);
  if (at >= 0) return at === 0 ? 0 : 1;
  if (within(name, q)) return 2;
  if (path.includes(q)) return 3;
  return within(path, q) ? 4 : -1;
}

/** The indexes of the best `limit` paths for the query: name hits before folder-only hits, then
 *  shorter paths, then list order. An empty query keeps the list order. */
export function rank(paths: string[], query: string, limit = SHOWN): number[] {
  const q = query.toLowerCase().replace(/\s+/g, "").replace(/\\/g, "/");
  if (!q) return paths.slice(0, limit).map((_, i) => i);
  const hits: [number, number, number][] = [];
  paths.forEach((p, i) => {
    const s = score(p, q);
    if (s >= 0) hits.push([s, p.length, i]);
  });
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return hits.slice(0, limit).map((h) => h[2]);
}

const RG_HELP = "Install ripgrep to list every file here (winget install BurntSushi.ripgrep.MSVC on Windows, brew install ripgrep on macOS, or your package manager's ripgrep), then Retry.";

/** Quick Open's listing (EDIT-036) from file_list: full native paths, and what to say when
 *  ripgrep is missing (git's list stands in for it where the folder is a repository). */
export function quickOpenList(root: string, l: { files: string[]; capped: boolean; source: string; rgMissing: boolean }): Listing {
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "") + sep;
  const note = !l.rgMissing ? undefined : l.source === "git" ? `ripgrep is not installed, so these are git's files only. ${RG_HELP}` : `ripgrep is not installed and this folder is not a git repository, so there is no list. ${RG_HELP}`;
  return { items: l.files.map((r) => ({ path: base + (sep === "/" ? r : r.split("/").join(sep)) })), capped: l.capped, note };
}

/** Scrolls the active option of a listbox just into view (nothing moves when it already shows). */
export function scrollActive(box: { querySelector: (selector: string) => unknown } | null) {
  (box?.querySelector('[aria-selected="true"]') as Partial<HTMLElement> | null | undefined)?.scrollIntoView?.({ block: "nearest" });
}

export default function FilePicker({ root, what, load, onPick, onClose }: Props) {
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [filter, setFilter] = useState("");
  const [at, setAt] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; path: string } | null>(null);
  // An arrow key moves the active option; it is scrolled into view (a hover moves it too, but never scrolls).
  const listBox = useRef<HTMLDivElement>(null);
  const arrowed = useRef(false);
  useEffect(() => {
    if (!arrowed.current) return;
    arrowed.current = false;
    scrollActive(listBox.current);
  }, [at]);

  useEffect(() => {
    load().then(setList, (err) => setError(String(err)));
  }, [root, tries]);

  const rel = (f: string) => f.slice(root.length).replace(/^[\\/]+/, "");
  const lows = useMemo(() => (list?.items ?? []).map((f) => rel(f.path).toLowerCase().replace(/\\/g, "/")), [list]);
  const hits = useMemo(() => rank(lows, filter).map((i) => list!.items[i]), [lows, filter]);
  const pick = (f: Pick | undefined) => {
    if (!f) return;
    onClose();
    onPick(f);
  };
  const retry = () => {
    setList(null);
    setError(null);
    setTries((n) => n + 1);
  };
  const split = (f: Pick) => {
    const r = rel(f.path);
    const cut = Math.max(r.lastIndexOf("/"), r.lastIndexOf("\\"));
    return { name: r.slice(cut + 1), folder: cut < 0 ? "" : r.slice(0, cut + 1) };
  };
  const tipParts = tip && split({ path: tip.path });

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker" role="dialog" aria-label={`Open a ${what}`}>
        <input
          autoFocus
          className="picker-input"
          placeholder={`Open a ${what}`}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "Enter") pick(hits[at]);
            else if (e.key === "ArrowDown") (arrowed.current = true, setAt((i) => Math.min(i + 1, hits.length - 1)));
            else if (e.key === "ArrowUp") (arrowed.current = true, setAt((i) => Math.max(i - 1, 0)));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div ref={listBox} className="picker-list" role="listbox" onMouseLeave={() => setTip(null)}>
          {error && (
            <div className="menu-hint">
              Could not list them: {error}.{" "}
              <button className="btn" onClick={retry}>
                Retry
              </button>
            </div>
          )}
          {list?.note && (
            <div className="menu-hint">
              {list.note}{" "}
              <button className="btn" onClick={retry}>
                Retry
              </button>
            </div>
          )}
          {!error && !list && <div className="menu-hint">Listing…</div>}
          {list && hits.length === 0 && <div className="menu-hint">{list.items.length ? "Nothing matches." : `This workspace has no ${what}s.`}</div>}
          {hits.map((f, i) => {
            const { name, folder } = split(f);
            return (
              <button
                key={`${f.path}|${f.tag ?? ""}`}
                role="option"
                aria-selected={i === at}
                aria-label={rel(f.path)}
                className={`menu-item${i === at ? " at" : ""}`}
                onMouseEnter={() => setAt(i)}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, path: f.path })}
                onClick={() => pick(f)}
              >
                <span className="name">{name}</span>
                {folder && <span className="picker-folder">{folder.slice(0, -1)}</span>}
                {f.tag && <span className="preview-tag">{f.tag}</span>}
              </button>
            );
          })}
          {list && hits.length === SHOWN && <div className="menu-hint">Showing the {filter.trim() ? "best" : "first"} {SHOWN}; type more to narrow them down.</div>}
          {list?.capped && <div className="menu-hint">The list is incomplete: only the first {list.items.length} are listed, and this workspace has more.</div>}
        </div>
      </div>
      {tip && tipParts && (
        <div className="picker-tip" role="tooltip" style={tip.x < innerWidth * 0.6 ? { left: tip.x + 14, top: tip.y + 18 } : { right: innerWidth - tip.x + 6, top: tip.y + 18 }}>
          <span className="picker-tip-folder">{root.replace(/[\\/]+$/, "") + (root.includes("\\") ? "\\" : "/") + tipParts.folder}</span>
          <strong>{tipParts.name}</strong>
        </div>
      )}
    </>
  );
}
