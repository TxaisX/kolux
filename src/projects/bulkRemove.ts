// PROJ-082: removing the ticked workspaces from cleanup runs in the background. This is the model
// behind the confirmation and the progress: what the question names, when removal may start, the
// order (children before parents), and how a slow, failed or late removal is counted. Rust's
// `cleanup_remove` still decides what is safe to remove and never forces; this side calls it one
// workspace at a time so progress can show and a slow one does not hold the rest.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { childrenFirst, rowLabel, type Cleaned, type KeptBranch, type ScanRow } from "./cleanup";

/** The parent of each workspace by path (PROJ-047); a missing or null entry is a top-level one. */
export type ParentOf = (path: string) => string | null | undefined;

/** A long selection is listed by name only up to this many; the rest is a count. */
export const LIST_MAX = 8;
/** A removal that takes longer than this is shown as slow and the next one starts. */
export const SLOW_MS = 15_000;

const key = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Nothing starts for an empty selection. */
export const hasCandidates = (rows: ScanRow[]) => rows.length > 0;

/** Rows whose safety could not be checked (Git could not be read there): they need explicit agreement. */
export const unchecked = (rows: ScanRow[]): ScanRow[] => rows.filter((r) => r.note !== null && !r.missing);

/** Removal may start with at least one workspace, and, when any row could not be checked, only after the user agreed. */
export const canStart = (rows: ScanRow[], agreed: boolean) => hasCandidates(rows) && (unchecked(rows).length === 0 || agreed);

/** The names the question lists: at most LIST_MAX, then how many more. */
export function namedList(rows: ScanRow[], max = LIST_MAX): { names: string[]; more: number } {
  return { names: rows.slice(0, max).map(rowLabel), more: Math.max(0, rows.length - max) };
}

/** Each kind of local context the removal will lose, in plain words, for the confirmation. Only
 *  kinds present in the selection are named; the folder's own untracked and ignored files always are. */
export function lossKinds(rows: ScanRow[]): string[] {
  if (!hasCandidates(rows)) return [];
  const some = (f: (r: ScanRow) => boolean) => rows.filter(f).length;
  const out: string[] = [];
  const present = rows.filter((r) => !r.missing);
  if (present.length > 0) out.push("files in the folders that Git does not track or ignores (installed packages, local settings, build output)");
  const changed = some((r) => r.changes > 0);
  if (changed > 0) out.push(`uncommitted changes (${changed} ${changed === 1 ? "workspace" : "workspaces"})`);
  const unmerged = some((r) => r.unmerged && !r.merged);
  if (unmerged > 0) out.push(`commits no other branch has (${unmerged} ${unmerged === 1 ? "workspace" : "workspaces"}; the branch is kept)`);
  const open = some((r) => r.active);
  if (open > 0) out.push(`an open terminal (${open} ${open === 1 ? "workspace" : "workspaces"})`);
  return out;
}

export type ItemState = "waiting" | "removing" | "slow" | "removed" | "left" | "skipped";
export type Item = { path: string; state: ItemState; why: string | null };
/** One workspace's removal as the dialog's adapter reports it. */
export type RemoveResult = { ok: boolean; why: string | null };
export type RemoveOne = (path: string) => Promise<RemoveResult>;

/** How many have finished (removed, left or skipped) of how many were chosen. */
export const finished = (items: Item[]) => items.filter((i) => i.state === "removed" || i.state === "left" || i.state === "skipped").length;

/** The line under the progress: counts only, the reasons are listed per workspace. */
export function summary(items: Item[]): string {
  const count = (s: ItemState) => items.filter((i) => i.state === s).length;
  const removed = count("removed");
  const rest = count("left") + count("skipped");
  const slow = count("slow");
  return `Removed ${removed} of ${items.length}` + (slow > 0 ? ` · ${slow} still finishing` : "") + (rest > 0 ? ` · ${rest} left in place` : "");
}

type Options = { slowMs?: number; onProgress?: (items: Item[]) => void };

/** Removes `paths` children first, one at a time. A removal slower than `slowMs` shows as slow and the
 *  next sibling starts, but a parent waits for every child to settle: a child that finishes late counts
 *  as removed, one that fails late leaves its parent in place (skipped). Resolves once everything settled. */
export async function runBulk(paths: string[], parentOf: ParentOf, remove: RemoveOne, opts: Options = {}): Promise<Item[]> {
  const order = childrenFirst(paths, parentOf);
  const items = new Map<string, Item>(order.map((p) => [key(p), { path: p, state: "waiting", why: null }]));
  const chosen = new Set(items.keys());
  const kidsOf = (p: string) => order.filter((c) => {
    const up = parentOf(c);
    return up && chosen.has(key(up)) && key(up) === key(p);
  });
  const snapshot = () => order.map((p) => ({ ...items.get(key(p))! }));
  const set = (p: string, state: ItemState, why: string | null = null) => {
    items.set(key(p), { path: p, state, why });
    opts.onProgress?.(snapshot());
  };
  const slowMs = opts.slowMs ?? SLOW_MS;
  const running = new Map<string, Promise<void>>();
  opts.onProgress?.(snapshot());
  for (const p of order) {
    const kids = kidsOf(p);
    await Promise.all(kids.map((k) => running.get(key(k))));
    if (kids.some((k) => items.get(key(k))?.state !== "removed")) {
      set(p, "skipped", "a workspace inside it was not removed, so it stays");
      continue;
    }
    set(p, "removing");
    const run = remove(p).then(
      (r) => set(p, r.ok ? "removed" : "left", r.ok ? null : r.why ?? "it could not be removed"),
      (e) => set(p, "left", String(e)),
    );
    running.set(key(p), run);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = await Promise.race([run.then(() => false), new Promise<boolean>((done) => (timer = setTimeout(() => done(true), slowMs)))]);
    clearTimeout(timer);
    if (slow && items.get(key(p))?.state === "removing") set(p, "slow");
  }
  await Promise.all(running.values());
  return snapshot();
}

type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** The adapter the dialog uses: one workspace through `cleanup_remove`; branches it kept go to `onKept`. */
export function removeOne(projectId: string, onKept: (kept: KeptBranch[]) => void = () => {}, invoke: Invoke = tauriInvoke): RemoveOne {
  return async (path) => {
    const out = await invoke<Cleaned>("cleanup_remove", { projectId, paths: [path] });
    if (out.kept.length > 0) onKept(out.kept);
    const ok = out.removed.some((r) => key(r) === key(path));
    return { ok, why: ok ? null : out.left.find((l) => key(l.path) === key(path))?.why ?? "it could not be removed" };
  };
}
