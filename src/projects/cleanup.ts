// PROJ-080 / PROJ-073: the model behind the workspace cleanup dialog and the kept-branch notice.
// What the scan lists, what comes ticked, what survives a rescan, and the branches a removal left.

/** One Kolux-made workspace as `cleanup_scan` reports it. */
export type ScanRow = {
  path: string;
  branch: string | null;
  name: string | null;
  idleDays: number | null;
  changes: number;
  merged: boolean;
  /** Its branch holds commits that are in no other branch; removing the workspace keeps the branch. */
  unmerged: boolean;
  active: boolean;
  locked: boolean;
  missing: boolean;
  quiet: boolean;
  preselect: boolean;
  keepsBranch: boolean;
  note: string | null;
};

export type Scan = { projectId: string; rows: ScanRow[]; error: string | null; timedOut: boolean; atMs: number };

/** A branch a removed workspace left behind, with the commit it pointed at then (PROJ-073). */
export type KeptBranch = { branch: string; commit: string };
/** The same, with the project it belongs to, so a batch from several projects can share one list. */
export type KeptItem = KeptBranch & { projectId: string };

export type Cleaned = { removed: string[]; left: { path: string; why: string }[]; kept: KeptBranch[] };
export type BranchResult = { branch: string; deleted: boolean; why: string | null };

const lastSegment = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

export const rowLabel = (r: ScanRow) => r.name ?? r.branch ?? lastSegment(r.path);

/** The rows the dialog shows: the ones gone quiet, or every workspace when "show all" is on. */
export const shownRows = (scan: Scan, showAll: boolean): ScanRow[] => (showAll ? scan.rows : scan.rows.filter((r) => r.quiet));

/** What the dialog ticks when it opens: clean, inactive, quiet workspaces whose commits are all in the base (or whose folder is gone). */
export const preselected = (scan: Scan): string[] => scan.rows.filter((r) => r.preselect).map((r) => r.path);

/** The facts that explain a row, in plain words. */
export function rowFacts(r: ScanRow): string {
  const out: string[] = [];
  if (r.missing) out.push("folder is gone");
  else if (r.idleDays !== null) out.push(r.idleDays === 0 ? "touched today" : `idle ${r.idleDays} day${r.idleDays === 1 ? "" : "s"}`);
  if (r.merged) out.push("merged");
  if (r.unmerged && !r.merged) out.push("unmerged commits");
  if (r.changes > 0) out.push(`${r.changes} uncommitted change${r.changes === 1 ? "" : "s"}`);
  else if (!r.missing && r.note === null) out.push("clean");
  if (r.active) out.push("a terminal is open");
  if (r.locked) out.push("locked");
  if (r.keepsBranch) out.push("its branch stays");
  if (r.note) out.push(r.note);
  return out.join(" · ");
}

/** Ticks after a scan: a workspace the user already ticked or unticked keeps that choice; a new one follows `preselect`; one that vanished is dropped. */
export function ticksAfterScan(before: Record<string, boolean> | null, scan: Scan): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of scan.rows) out[r.path] = before && r.path in before ? before[r.path] : r.preselect;
  return out;
}

const pathKey = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** T-149: the ticked paths with every child ahead of its parent (deepest first, scan order among equals), so a parent is never tried while its child still stands. */
export function childrenFirst(paths: string[], parentOf?: (path: string) => string | null | undefined): string[] {
  if (!parentOf) return paths;
  const depth = (p: string) => {
    const seen = new Set([pathKey(p)]);
    let n = 0;
    for (let up = parentOf(p); up && !seen.has(pathKey(up)); up = parentOf(up)) {
      seen.add(pathKey(up));
      n++;
    }
    return n;
  };
  return paths
    .map((path, i) => ({ path, i, d: depth(path) }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .map((x) => x.path);
}

export const tickedPaths =(ticks: Record<string, boolean>, scan: Scan, showAll: boolean): string[] => shownRows(scan, showAll).filter((r) => ticks[r.path]).map((r) => r.path);

// The previous result shows straight away while a new scan runs, and the filter stays as it was.
const lastScans = new Map<string, Scan>();
const showAllFor = new Map<string, boolean>();
const lastTicks = new Map<string, Record<string, boolean>>();

export const rememberScan = (scan: Scan) => {
  // A scan that failed or timed out never replaces a good result.
  if (scan.error === null) lastScans.set(scan.projectId, scan);
};
export const lastScan = (projectId: string): Scan | null => lastScans.get(projectId) ?? null;
export const rememberShowAll = (projectId: string, on: boolean) => void showAllFor.set(projectId, on);
export const rememberedShowAll = (projectId: string) => showAllFor.get(projectId) ?? false;
export const rememberTicks = (projectId: string, ticks: Record<string, boolean>) => void lastTicks.set(projectId, ticks);
export const rememberedTicks = (projectId: string) => lastTicks.get(projectId) ?? null;
export const forgetCleanupMemory = () => {
  lastScans.clear();
  showAllFor.clear();
  lastTicks.clear();
};

/** Adds branches to the pending list, once each (by project and branch); the newest commit wins. */
export function addKept(current: KeptItem[], more: KeptItem[]): KeptItem[] {
  const out = current.filter((c) => !more.some((m) => m.projectId === c.projectId && m.branch === c.branch));
  return [...out, ...more];
}

/** One branch is a toast with a Delete button; a batch opens a single review list. */
export const keptView = (items: KeptItem[]): "none" | "toast" | "review" => (items.length === 0 ? "none" : items.length === 1 ? "toast" : "review");

/** Only ticked branches are deleted, grouped per project so each repository gets one batch, in order. */
export function keptBatches(items: KeptItem[], ticked: Record<string, boolean>): { projectId: string; items: KeptBranch[] }[] {
  const out: { projectId: string; items: KeptBranch[] }[] = [];
  for (const k of items) {
    if (!ticked[`${k.projectId}\n${k.branch}`]) continue;
    const batch = out.find((b) => b.projectId === k.projectId);
    const one = { branch: k.branch, commit: k.commit };
    if (batch) batch.items.push(one);
    else out.push({ projectId: k.projectId, items: [one] });
  }
  return out;
}

/** What is left on the list after a delete: the refused ones stay, so the reason can be read. */
export const keptAfter = (items: KeptItem[], results: BranchResult[]): KeptItem[] => items.filter((k) => !results.some((r) => r.branch === k.branch && r.deleted));

// PROJ-081: filters, search and sorting in the cleanup list. Sizes are read only when a size
// filter or the size sort needs them (`needsSizes`); rows whose size is unknown, or that were
// never visited, drop to the bottom of a sort whichever way it runs.
export type GitFilter = "any" | "merged" | "unmerged" | "changes" | "clean" | "missing";
export type ActivityFilter = "any" | "active" | "idle" | "never";
export type SafetyFilter = "any" | "safe" | "unsafe";
export type SizeFilter = "any" | "large" | "small";
export type SortBy = "scan" | "name" | "size" | "idle";
export type CleanupView = { query: string; git: GitFilter; activity: ActivityFilter; safety: SafetyFilter; size: SizeFilter; sort: SortBy; desc: boolean };
/** A sizes map: bytes, null = unknown (missing, unreadable or too big to walk), absent = not read yet. */
export type Sizes = Record<string, number | null>;

export const DEFAULT_VIEW: CleanupView = { query: "", git: "any", activity: "any", safety: "any", size: "any", sort: "scan", desc: false };
/** The size filter's line between small and large workspaces. */
export const LARGE_BYTES = 500 * 1024 * 1024;
/** How many days without a visit make a workspace idle for the filter. */
export const IDLE_DAYS = 7;

export const needsSizes = (v: CleanupView) => v.sort === "size" || v.size !== "any";

const gitMatches = (r: ScanRow, g: GitFilter) =>
  g === "any" ||
  (g === "merged" && r.merged) ||
  (g === "unmerged" && r.unmerged && !r.merged) ||
  (g === "changes" && r.changes > 0) ||
  (g === "clean" && !r.missing && r.changes === 0) ||
  (g === "missing" && r.missing);

const activityMatches = (r: ScanRow, a: ActivityFilter) =>
  a === "any" || (a === "active" && r.active) || (a === "idle" && !r.active && r.idleDays !== null && r.idleDays >= IDLE_DAYS) || (a === "never" && r.idleDays === null && !r.missing);

const safetyMatches = (r: ScanRow, s: SafetyFilter) => s === "any" || (s === "safe" ? r.preselect : !r.preselect);

const sizeMatches = (r: ScanRow, s: SizeFilter, sizes: Sizes) => {
  if (s === "any") return true;
  const b = sizes[r.path];
  if (b === null || b === undefined) return false;
  return s === "large" ? b >= LARGE_BYTES : b < LARGE_BYTES;
};

/** Search: the label, branch, folder and facts, ignoring case. */
const searchMatches = (r: ScanRow, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [rowLabel(r), r.branch ?? "", r.path, rowFacts(r)].some((t) => t.toLowerCase().includes(s));
};

/** The rows in view: filtered, searched and sorted; unknown sizes and never-visited rows go last. */
export function arrangeRows(rows: ScanRow[], v: CleanupView, sizes: Sizes = {}): ScanRow[] {
  const kept = rows.filter((r) => gitMatches(r, v.git) && activityMatches(r, v.activity) && safetyMatches(r, v.safety) && sizeMatches(r, v.size, sizes) && searchMatches(r, v.query));
  if (v.sort === "scan") return kept;
  const key = (r: ScanRow): number | string | null =>
    v.sort === "name" ? rowLabel(r).toLowerCase() : v.sort === "size" ? (sizes[r.path] ?? null) : r.idleDays;
  const sign = v.desc ? -1 : 1;
  return kept
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      if (a.k < b.k) return -sign;
      if (a.k > b.k) return sign;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** A size in plain words for the row facts. */
export function sizeText(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) (n /= 1024), u++;
  return `${u === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[u]}`;
}

/** The sort-direction button's words, by the key being sorted: "Largest first" only makes sense for size. */
export function directionLabel(sort: SortBy, desc: boolean): string {
  if (sort === "size") return desc ? "Largest first" : "Smallest first";
  if (sort === "idle") return desc ? "Idle longest first" : "Idle shortest first";
  if (sort === "name") return desc ? "Z to A" : "A to Z";
  return desc ? "Newest scan first" : "Scan order";
}

/** Ticks every listed row on or off, leaving rows that are filtered out as they were. */
export function tickRows(ticks: Record<string, boolean>, rows: ScanRow[], on: boolean): Record<string, boolean> {
  const next = { ...ticks };
  for (const r of rows) next[r.path] = on;
  return next;
}
