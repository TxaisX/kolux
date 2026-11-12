// PROJ-083 / VIEW-014: the Space view's rules. Rust (bulk.rs) measures the folders; this decides
// what the table and the treemap show: sizes and ages formatted for reading, sorting, searching, the
// deletable-only filter, which selected rows may really be deleted, and the treemap's fixed layout
// with the small tail folded into one block.
import { relativeTime } from "../scm/review";

export type Size = { bytes: number; files: number; incomplete: boolean };
export type SpaceRow = { path: string; branch: string | null; isMain: boolean; size: Size; modified: number; reclaimable: boolean };

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 1536 -> "1.5 KB"; whole numbers lose their decimal; a floor from an unfinished scan shows "+". */
export function formatBytes(n: number, incomplete = false): string {
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const text = u === 0 || v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[u]}${incomplete ? "+" : ""}`;
}

/** 12345 -> "12,345" */
export const formatCount = (n: number, incomplete = false): string => `${Math.max(0, n).toLocaleString("en-US")}${incomplete ? "+" : ""}`;

/** The folder's age as "3d"; nothing when the time is unknown. */
export const ageOf = (row: SpaceRow, now: number): string => (row.modified > 0 ? relativeTime(new Date(row.modified * 1000).toISOString(), now) : "");

/** Only a linked worktree that nothing is using (a running agent or an open tab) can be deleted here. */
export const deletable = (row: SpaceRow, active: ReadonlySet<string>): boolean => row.reclaimable && !row.isMain && !active.has(row.path);

/** What deleting would give back: linked worktrees only, never the main checkout. */
export const reclaimableBytes = (rows: SpaceRow[]): number => rows.filter((r) => r.reclaimable && !r.isMain).reduce((a, r) => a + r.size.bytes, 0);

export type SortKey = "size" | "files" | "age" | "branch";

export function sortRows(rows: SpaceRow[], key: SortKey, now = Date.now() / 1000): SpaceRow[] {
  const by: Record<SortKey, (a: SpaceRow, b: SpaceRow) => number> = {
    size: (a, b) => b.size.bytes - a.size.bytes,
    files: (a, b) => b.size.files - a.size.files,
    // Oldest first: the ones nobody has touched are the ones to clear.
    age: (a, b) => (a.modified || now) - (b.modified || now),
    branch: (a, b) => (a.branch ?? a.path).localeCompare(b.branch ?? b.path),
  };
  return [...rows].sort(by[key]);
}

export function searchRows(rows: SpaceRow[], query: string): SpaceRow[] {
  const q = query.trim().toLowerCase();
  return q === "" ? rows : rows.filter((r) => (r.branch ?? "").toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
}

export function visibleRows(rows: SpaceRow[], o: { query: string; sort: SortKey; deletableOnly: boolean; active: ReadonlySet<string> }): SpaceRow[] {
  const found = searchRows(rows, o.query).filter((r) => !o.deletableOnly || deletable(r, o.active));
  return sortRows(found, o.sort);
}

/** The selected rows that may go, and the ones that are skipped with the reason. */
export function selectedForDelete(selected: string[], rows: SpaceRow[], active: ReadonlySet<string>): { go: SpaceRow[]; skipped: { path: string; why: string }[] } {
  const go: SpaceRow[] = [];
  const skipped: { path: string; why: string }[] = [];
  for (const path of [...new Set(selected)]) {
    const row = rows.find((r) => r.path === path);
    if (!row) skipped.push({ path, why: "It is no longer listed" });
    else if (row.isMain) skipped.push({ path, why: "The main checkout cannot be deleted" });
    else if (active.has(path)) skipped.push({ path, why: "It is in use: a tab is open or an agent is running" });
    else go.push(row);
  }
  return { go, skipped };
}

export type Block = { label: string; bytes: number; x: number; y: number; w: number; h: number };

/**
 * A square treemap of the biggest `max` items; the rest become one "omitted" block. Slice and dice,
 * alternating direction, so the layout is the same for the same sizes.
 */
export function treemap(items: { label: string; bytes: number }[], max = 24, side = 100): { blocks: Block[]; omitted: number } {
  const sorted = [...items].filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const top = sorted.slice(0, max);
  const rest = sorted.slice(max);
  const list = rest.length > 0 ? [...top, { label: `${rest.length} more`, bytes: rest.reduce((a, r) => a + r.bytes, 0) }] : top;
  const blocks: Block[] = [];
  const place = (xs: { label: string; bytes: number }[], x: number, y: number, w: number, h: number, wide: boolean) => {
    if (xs.length === 0) return;
    if (xs.length === 1) return void blocks.push({ ...xs[0], x, y, w, h });
    const total = xs.reduce((a, b) => a + b.bytes, 0);
    const [first, ...others] = xs;
    const share = first.bytes / total;
    if (wide) {
      blocks.push({ ...first, x, y, w: w * share, h });
      place(others, x + w * share, y, w * (1 - share), h, !wide);
    } else {
      blocks.push({ ...first, x, y, w, h: h * share });
      place(others, x, y + h * share, w, h * (1 - share), !wide);
    }
  };
  place(list, 0, 0, side, side, true);
  return { blocks, omitted: rest.length };
}
