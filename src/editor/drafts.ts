// EDIT-004 (T-177): unsaved text survives a quit or a crash. While a tab holds unsaved text a draft
// of it is kept (editor_drafts.rs) a moment after typing stops; the draft is never written into the
// real file. Reopening the file brings the draft back, still marked unsaved. A draft typed over a
// disk copy that has since changed comes back with the changed-on-disk banner up (EDIT-003), so it
// is never laid over the newer disk copy unseen. Read-only tabs never carry a draft.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { diskOf, hashOf, isDirty, keyOf, sameText, textOf } from "./buffers";

export type Draft = { path: string; text: string; base: string };

/** What to open a file with, given its disk copy and the draft kept for it (if any). `stale` is a
 *  draft that adds nothing (it equals the disk copy) and can be dropped. */
export function restoreFrom(disk: string, diskHash: string, draft: Draft | null): { text: string; moved: boolean; stale: boolean } {
  if (!draft || sameText(draft.text, disk)) return { text: disk, moved: false, stale: !!draft };
  return { text: draft.text, moved: draft.base !== "" && draft.base !== diskHash, stale: false };
}

/** The backing store; the window's own is the Rust commands. */
export type DraftIo = {
  set: (worktree: string, path: string, text: string, base: string) => Promise<unknown>;
  clear: (worktree: string, path: string) => Promise<unknown>;
  list: (worktree: string) => Promise<Draft[]>;
};
export const tauriIo: DraftIo = {
  set: (worktree, path, text, base) => invoke("editor_draft_set", { worktree, path, text, base }),
  clear: (worktree, path) => invoke("editor_draft_clear", { worktree, path }),
  list: (worktree) => invoke<Draft[]>("editor_drafts_get", { worktree }),
};

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const real: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function createDrafts(io: DraftIo, ms = 600, timers: Timers = real) {
  const loaded = new Map<string, Promise<Map<string, Draft>>>();
  const timersOf = new Map<string, { t: unknown; worktree: string; path: string }>();
  // Row 199: every tab edited since it was last clean, so a flush covers tabs whose timer already fired.
  const open = new Map<string, { worktree: string; path: string }>();
  const mirror = (worktree: string) => {
    const k = keyOf(worktree);
    let p = loaded.get(k);
    if (!p) loaded.set(k, (p = io.list(worktree).then((l) => new Map(l.map((d) => [keyOf(d.path), d] as const)), () => new Map<string, Draft>())));
    return p;
  };
  const pk = (worktree: string, path: string) => keyOf(worktree) + "\n" + keyOf(path);
  const stop = (k: string) => {
    const t = timersOf.get(k);
    if (t !== undefined) timers.clear(t.t);
    timersOf.delete(k);
  };
  /** Writes the draft for the file as it is now (or clears it when the tab is clean).
   *  False only when the draft of a dirty tab could not be written. */
  // Bumped by discard: a write already on its way (waiting on the mirror or the hash) then stands down, so a draft
  // the user threw away is not written back after the clear.
  const gens = new Map<string, number>();
  const flushOne = async (worktree: string, path: string): Promise<boolean> => {
    const k = pk(worktree, path);
    const gen = gens.get(k) ?? 0;
    const gone = () => (gens.get(k) ?? 0) !== gen;
    stop(k);
    const m = await mirror(worktree);
    if (gone()) return true;
    const text = textOf(path);
    if (text === null) {
      open.delete(pk(worktree, path));
      return true;
    }
    if (!isDirty(path)) {
      open.delete(pk(worktree, path));
      if (m.delete(keyOf(path))) await io.clear(worktree, path).catch(() => undefined);
      return true;
    }
    const base = await hashOf(diskOf(path) ?? "");
    if (gone()) return true;
    m.set(keyOf(path), { path, text, base });
    return io.set(worktree, path, text, base).then(() => true, () => false);
  };
  return {
    /** The draft kept for a file (null when none). */
    async take(worktree: string, path: string): Promise<Draft | null> {
      return (await mirror(worktree)).get(keyOf(path)) ?? null;
    },
    /** The tab's text changed: write the draft a moment after typing stops. Never for a read-only tab. */
    edited(worktree: string, path: string, readOnly = false) {
      if (readOnly) return;
      const k = pk(worktree, path);
      stop(k);
      open.set(k, { worktree, path });
      timersOf.set(k, { t: timers.set(() => void flushOne(worktree, path), ms), worktree, path });
    },
    /** Writes a waiting draft at once (the window is closing, the tab is leaving). */
    flush: (worktree: string, path: string) => flushOne(worktree, path),
    /** Rows 135, 199: writes the draft of every tab holding unsaved text at once (the window lost focus,
     *  was hidden, is closing or is about to reload), so the last moment of typing is not missing and
     *  a write that failed earlier is made again. Resolves true only when every dirty tab was written. */
    flushAll: async (): Promise<boolean> =>
      (await Promise.all([...new Map([...timersOf, ...open]).values()].map(({ worktree, path }) => flushOne(worktree, path)))).every(Boolean),
    /** The user closed the tab or chose to drop the edits: the draft goes. */
    async discard(worktree: string, path: string) {
      gens.set(pk(worktree, path), (gens.get(pk(worktree, path)) ?? 0) + 1);
      stop(pk(worktree, path));
      open.delete(pk(worktree, path));
      (await mirror(worktree)).delete(keyOf(path));
      await io.clear(worktree, path).catch(() => undefined);
    },
    pending: (worktree: string, path: string) => timersOf.has(pk(worktree, path)),
  };
}

/** The window's drafts. */
export const drafts = createDrafts(tauriIo);

/** Row 135: the waiting drafts are written when the window loses focus (a tray Quit takes the focus
 *  first), is hidden, or unloads; a close from the window itself asks first while a tab is unsaved. */
export function flushOnLeave(target: Pick<Window, "addEventListener" | "removeEventListener">, flushAll: () => unknown): () => void {
  const go = () => void flushAll();
  const hidden = () => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") go();
  };
  target.addEventListener("blur", go);
  target.addEventListener("pagehide", go);
  target.addEventListener("visibilitychange", hidden);
  return () => {
    target.removeEventListener("blur", go);
    target.removeEventListener("pagehide", go);
    target.removeEventListener("visibilitychange", hidden);
  };
}
if (typeof window !== "undefined") flushOnLeave(window, drafts.flushAll);

/** Row 199: the window's side of "write every unsaved tab's draft before the interface reloads":
 *  the host (recovery watch, editor_drafts.rs) asks with a token and holds the reload until the
 *  token comes back or its wait runs out. */
export type FlushRequests = { on: (handler: (token: number) => void) => unknown; ack: (token: number) => Promise<unknown> };
export function answerFlushRequests(req: FlushRequests, flushAll: () => Promise<boolean>): void {
  // No ack after a failed write: the host's wait runs out and it logs "flush not acked" (row 199 review).
  req.on((token) => void flushAll().then((ok) => (ok ? req.ack(token) : undefined)).catch(() => undefined));
}
export const FLUSH_EVENT = "editor-flush-request";
export const tauriFlush: FlushRequests = {
  on: (handler) => listen<number>(FLUSH_EVENT, (e) => handler(e.payload)).catch(() => undefined),
  ack: (token) => invoke("editor_flush_ack", { token }),
};
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) answerFlushRequests(tauriFlush, drafts.flushAll);

/** The worktree a draft is kept under: the tab's worktree root, else the file's own folder. */
export const worktreeOf = (root: string | null | undefined, path: string): string => root ?? path.replace(/[\\/][^\\/]*$/, "");
