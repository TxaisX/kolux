// Row 837: the All Changes file tree as flat fixed-height rows (a folder line, then its files), so
// only the rows in view are in the page. The up and down arrows move between files, because Tab can
// no longer walk through rows that are not mounted. A row subscribes to its own "drawn" stamp, so a
// section finishing never re-renders the tree.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { baseName } from "./buffers";
import { clashWord } from "../scm/model";
import { windowRange } from "../scm/rules";
import { useReadyStamp } from "./useSectionWindow";
import type { ReadyStore } from "./sectionWindow";
import type { Entry } from "./AllChangesPane";

export const TREE_ROW = 24; // px, every row alike
const TREE_SPARE = 8;

export const relTo = (root: string, p: string) => p.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");

export type TreeRow = { kind: "dir"; key: string; dir: string } | { kind: "file"; key: string; e: Entry; i: number };

/** The rows for the files whose path matches `filter`: a folder line whenever the folder changes. `i` is the file's index in `entries`. */
export function treeRows(entries: readonly Entry[], root: string, filter: string, keyOf: (e: Entry) => string): TreeRow[] {
  const q = filter.toLowerCase();
  const rows: TreeRow[] = [];
  let prev: string | null = null;
  entries.forEach((e, i) => {
    const rel = relTo(root, e.path);
    if (!rel.toLowerCase().includes(q)) return;
    const dir = rel.split("/").slice(0, -1).join("/");
    if (dir && dir !== prev) rows.push({ kind: "dir", key: `d|${rows.length}|${dir}`, dir });
    prev = dir;
    rows.push({ kind: "file", key: keyOf(e), e, i });
  });
  return rows;
}

/** Why the Viewed box is greyed out: a file can only be marked once its diff has been drawn. */
export const WAIT_VIEWED = "Available once this file’s diff has loaded";
type RowProps = { row: number; e: Entry; i: number; rel: string; tag: string; ready: ReadyStore; viewedStamp: string | undefined; keyOf: string; onJump: (i: number) => void; onToggleViewed: (e: Entry) => void };

const FileRow = memo(function FileRow({ row, e, i, rel, tag, ready, viewedStamp, keyOf, onJump, onToggleViewed }: RowProps) {
  const drawn = useReadyStamp(ready, keyOf);
  return (
    <div className="ac-row" data-row={row}>
      <input type="checkbox" checked={drawn === e.stamp && viewedStamp === e.stamp} disabled={drawn !== e.stamp} title={drawn !== e.stamp ? WAIT_VIEWED : "Mark this file as viewed"} aria-description={drawn !== e.stamp ? WAIT_VIEWED : undefined} onChange={() => onToggleViewed(e)} aria-label={`Viewed ${rel}`} />
      <button className="ac-jump" onClick={() => onJump(i)} title={rel}>
        {baseName(e.path)}
      </button>
      <span className={`ac-code${e.clash ? " ac-conflict" : ""}`} title={e.clash ? `Unresolved conflict: ${clashWord(e.clash)}` : tag}>
        {tag}
      </span>
    </div>
  );
});

type Props = { entries: Entry[] | null; root: string; width: number; ready: ReadyStore; viewed: Record<string, string>; keyOf: (e: Entry) => string; tagOf: (e: Entry) => string; onJump: (i: number) => void; onToggleViewed: (e: Entry) => void };

export default function ChangeTree({ entries, root, width, ready, viewed, keyOf, tagOf, onJump, onToggleViewed }: Props) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => treeRows(entries ?? [], root, filter, keyOf), [entries, root, filter, keyOf]);
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  const pendingFocus = useRef<number | null>(null);

  // Whole rows only, so scrolling re-renders once per row and not per pixel.
  const read = () => {
    const b = box.current;
    if (!b) return;
    const top = Math.floor(b.scrollTop / TREE_ROW) * TREE_ROW;
    const height = b.clientHeight || scroll.height;
    setScroll((s) => (s.top === top && s.height === height ? s : { top, height }));
  };
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(b);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const n = pendingFocus.current;
    if (n === null) return;
    pendingFocus.current = null;
    box.current?.querySelector<HTMLElement>(`[data-row="${n}"] .ac-jump`)?.focus();
  });

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const step = ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0;
    const b = box.current;
    const from = Number((ev.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row);
    if (!step || !b || Number.isNaN(from)) return;
    let n = from + step;
    while (n >= 0 && n < rows.length && rows[n].kind !== "file") n += step;
    if (n < 0 || n >= rows.length) return;
    ev.preventDefault();
    const y = n * TREE_ROW;
    if (y < b.scrollTop) b.scrollTop = y;
    else if (y + TREE_ROW > b.scrollTop + b.clientHeight) b.scrollTop = y + TREE_ROW - b.clientHeight;
    const el = b.querySelector<HTMLElement>(`[data-row="${n}"] .ac-jump`);
    if (el) el.focus();
    else pendingFocus.current = n;
    read();
  };

  const w = windowRange(rows.length, scroll.top, scroll.height, TREE_ROW, TREE_SPARE);
  return (
    <aside className="ac-tree" style={{ width }} aria-label="Changed files">
      <input className="picker-input" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter changed files" />
      <div className="ac-rows" ref={box} onScroll={read} onKeyDown={onKeyDown}>
        {w.padTop > 0 && <div style={{ height: w.padTop }} aria-hidden />}
        {rows.slice(w.start, w.end).map((r, k) =>
          r.kind === "dir" ? (
            <div key={r.key} className="ac-dir" data-row={w.start + k} style={{ height: TREE_ROW, boxSizing: "border-box" }}>
              {r.dir}
            </div>
          ) : (
            <FileRow key={r.key} row={w.start + k} e={r.e} i={r.i} rel={relTo(root, r.e.path)} tag={tagOf(r.e)} ready={ready} viewedStamp={viewed[r.key]} keyOf={r.key} onJump={onJump} onToggleViewed={onToggleViewed} />
          ),
        )}
        {w.padBottom > 0 && <div style={{ height: w.padBottom }} aria-hidden />}
        {entries && !rows.length && <div className="menu-hint">{entries.length ? "No changed file matches." : "No changes."}</div>}
      </div>
    </aside>
  );
}
