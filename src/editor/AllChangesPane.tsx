// All Changes (EDIT-029): every changed file of a worktree in one scroll, one section per file and
// side (a file with staged and unstaged changes has two). A section keeps an estimated height until
// it scrolls near, then fetches its two sides and draws them inline; one over WAIT_OVER changed
// lines waits for a click, images load as pictures, other binaries are only named. Fetched sides
// are reused only while the change's stamp (git's blob ids, plus size and time for the working
// file) is the same. The side tree starts hidden; it can be resized, filtered and used to jump and
// to tick files off as viewed. Changes are read again whenever git state moves (the git status
// watcher, scm/watch.ts) while the tab is in front, or when it comes back to the front after one.
// GIT-038 (T-033-c): the tab also measures the branch against its base (the merge-base snapshot,
// so the base moving on changes nothing), with a commit box while it does; inline or side by
// side, wrapped lines, whitespace-only changes and the tree each start from a setting and toggle
// per tab; every section folds, and all at once. GIT-037: a section's "open as tab" button opens
// the file's diff tab in the split chosen in Source Control. T-033-g: the tab reads the status once
// when it opens (so Commit is ready at once), passes the base it already knows so a refresh runs no
// second status, and labels a base with no shared history instead of comparing silently.
// Row 837: only the sections near the viewport (and the tree rows in view) are in the page; the rest
// are spacers sized from an estimate, then from the measured height (sectionWindow.ts).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { languageFor } from "./languages";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { ChevronDown, Close, FileCode, List } from "../chrome/icons";
import { baseName } from "./buffers";
import { copiers, look } from "./EditorPane";
import { allChangesContext, type LastFocus } from "./allChangesCopy";
import { clashesOf, withClashes } from "./changeConflicts";
import { withoutWhitespace } from "./DiffPane";
import { watchStatus } from "../scm/watch";
import ChangeTree, { relTo } from "./ChangeTree";
import { readyStore, SECTION_CHROME, SECTION_GAP, type ReadyStore } from "./sectionWindow";
import { useReadyStamp, useReadyVersion, useSectionWindow, type Meter } from "./useSectionWindow";
import { useSettings } from "../settings/useSettings";
import { allChangesStart } from "../settings/editorPrefs";
import Ask from "../chrome/Ask";
import { AC_SPLIT_KEY, AC_TREE_KEY, AC_WHITESPACE_KEY, AC_WRAP_KEY, abortLabel, canCommit, clashWord, isCommitShortcut, type AcLayout, type CommitOutcome, type Status } from "../scm/model";
import { bulkPaths, unstagePaths, oneAtATime, remoteButtons, runRemote, stagePaths, treeWidthForKey, TREE_MAX, TREE_MIN, type Say } from "../scm/changesActions";

export type Entry = { path: string; staged: boolean; code: string; lines: number | null; binary: boolean; stamp: string; /** git's two-letter code of an unresolved conflict; such a file is listed first and drawn without a diff (T-227-d). */ clash?: string };
/** The base a branch is measured against and the snapshot commit the sides are read from. */
export type Base = { against: string; since: string; note?: string };
type BaseChanges = Base & { entries: Entry[] };
type Sides = { original: string; modified: string };
type Cache = Map<string, { stamp: string; sides: Sides }>;
type Draw = Pick<AcLayout, "split" | "wrap" | "spaces">;

/** A section with more changed lines than this waits for a click before it draws. */
export const WAIT_OVER = 2000;
const LINE = 19.5; // px, the editor's 13 px text at line height 1.5
const CEILING = 560; // px, the most a text section may take before it scrolls inside itself
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

export const entryKey = (e: Entry) => `${e.staged ? "s" : "u"}|${e.path}`;
/** The height a section reserves before it draws, so the scroll does not jump. */
export const estimate = (e: Entry) => {
  const n = e.lines ?? 0;
  if (e.clash || IMAGE.test(e.path) || e.binary) return 48;
  if (n > WAIT_OVER) return 64;
  // An untracked file shows whole (plus the empty last line); a change shows some context around it.
  return Math.min(CEILING, e.code === "?" ? (n + 1) * LINE + 8 : (n + 8) * LINE);
};
/** The word on a section: which side of the index a working-tree change is on, or against the
 * base what became of the file. */
export const tagOf = (e: Entry, base: boolean) => (e.clash ? "Conflict" : base ? (e.code === "A" ? "Added" : e.code === "D" ? "Deleted" : e.code === "?" ? "Untracked" : "Changed") : e.code === "?" ? "Untracked" : e.staged ? "Staged" : "Unstaged");
/** The call that reads the branch against its base; `known` is the base the last status named. */
export const baseCall = (root: string, pinned: string | null, status: Status | null): [string, Record<string, unknown>] => ["scm_base_changes", { worktree: root, pinned, known: status?.base ?? null }];
/** FIX-2: the status read as the tab opens is used only until the watcher's first status lands, so a late answer never replaces a newer one. */
export function statusGate(take: (s: Status) => void): { first: (s: Status) => void; watched: (s: Status) => void; reread: () => (s: Status) => void } {
  let fresh = false;
  let seq = 0;
  return {
    first: (s) => {
      if (!fresh) take(s);
    },
    watched: (s) => {
      fresh = true;
      seq++;
      take(s);
    },
    // A read started now (after an action): its answer is used unless the watcher gave a newer status while it ran.
    reread: () => {
      const at = seq;
      return (s) => {
        if (seq === at) take(s);
      };
    },
  };
}
/** FIX-3 (review AFTER 7): how the tab gets its status as it opens. `read` is the one-off status
 * read (`first` settles once it has been used or has failed), `watch` starts the watcher and returns
 * its stop; both feed `take` through statusGate, so the read never replaces a watcher status that
 * arrived first. `onWatched` runs after each watcher status has been taken. */
export function openStatus(read: () => Promise<Status>, watch: (on: (s: Status) => void) => () => void, take: (s: Status) => void, onWatched: (s: Status) => void): { first: Promise<void>; stop: () => void; reread: () => (s: Status) => void } {
  const gate = statusGate(take);
  const first = read().then(gate.first, () => undefined);
  const stop = watch((s) => {
    gate.watched(s);
    onWatched(s);
  });
  return { first, stop, reread: gate.reread };
}
/** T-709 (DT-C145): what the abort Ask says is lost; `op` is git's operation in progress (Status.operation). */
export const abortLoss = (op: string): string =>
  `git ${op} --abort puts the branch and its files back where they were before the ${op} began. ` +
  (op === "merge"
    ? "The conflicts you resolved (staged or not) are lost. Changes that were not committed when it began may not all come back."
    : op === "rebase"
      ? "Commits already replayed onto the new base are thrown away (the branch keeps the commits it had), and the conflicts you resolved (staged or not) are lost."
      : `Commits the ${op} already made are removed from the branch, and the conflicts you resolved (staged or not) are lost.`);
/** The command and arguments a section reads its two texts with. */
export const sidesCall = (base: Base | null, root: string, e: Entry): [string, Record<string, unknown>] => (base ? ["scm_base_sides", { worktree: root, path: e.path, since: base.since }] : ["diff_sides", { path: e.path, staged: e.staged }]);

type Props = { id: number; root: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onOpenDiff?: (path: string, staged: boolean) => void; pinnedBase?: string | null };

export default function AllChangesPane({ id, root, hidden = false, focused = false, onFocus, onClose, onOpenDiff, pinnedBase = null }: Props) {
  const [raw, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"tree" | "base">("tree");
  const [base, setBase] = useState<Base | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  // T-227-d: unresolved conflicts come first, one section each, marked and drawn without a diff.
  const entries = useMemo(() => (raw ? withClashes(raw, clashesOf(status), root) : null), [raw, status, root]);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<Say | null>(null);
  // One git action at a time (commit, stage, push, pull, sync): a second click or Ctrl+Enter while one runs does nothing.
  const [turn] = useState(oneAtATime);
  const [pending, setPending] = useState<string | null>(null);
  const [aborting, setAborting] = useState<string | null>(null); // the operation the abort Ask is open for
  const reload = useRef<() => void>(() => undefined); // reads the changes again; set by the effect that owns the read
  const { settings, save } = useSettings();
  const [over, setOver] = useState<Partial<AcLayout>>({}); // this tab's toggles over the saved defaults
  const layout: AcLayout = { ...allChangesStart(settings, { split: AC_SPLIT_KEY, wrap: AC_WRAP_KEY, spaces: AC_WHITESPACE_KEY, tree: AC_TREE_KEY }), ...over };
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(260);
  const [viewed, setViewed] = useState<Record<string, string>>({}); // key: the stamp it was viewed at
  const [ready] = useState(readyStore); // key: the stamp it has drawn; read by the sections that need it, not by this component
  const cache = useRef<Cache>(new Map());
  const loaded = useRef(new Set<string>()); // big diffs the user asked for, kept while their section is out of the window
  const jumpRef = useRef<((index: number) => void) | null>(null);
  const front = useRef(!hidden);
  const latest = useRef<Status | null>(null); // the last status, read by refreshes without re-running the effect
  const rereadRef = useRef<(() => (s: Status) => void) | null>(null); // starts a status read whose answer yields to a newer watcher status
  const last = useRef<LastFocus | null>(null); // the diff view the cursor was last in, for Copy Context
  const [said, setSaid] = useState<string | null>(null);
  const saidTimer = useRef(0);
  front.current = !hidden;

  const missed = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!hidden && missed.current) {
      const f = missed.current;
      missed.current = null;
      f();
    }
  }, [hidden]);
  useEffect(() => {
    let alive = true;
    // The read hands back its base with the entries, so nothing lands after the tab moved on (FIX-2).
    const read = (): Promise<{ base: Base | null; es: Entry[] }> =>
      mode === "base" ? invoke<BaseChanges>(...baseCall(root, pinnedBase, latest.current)).then((b) => ({ base: { against: b.against, since: b.since, note: b.note }, es: b.entries })) : invoke<Entry[]>("change_entries", { root }).then((es) => ({ base: null, es }));
    const fetch = () =>
      read().then(
        ({ base, es }) => {
          if (!alive) return;
          setBase(base);
          setError(null);
          setEntries((old) => (old && JSON.stringify(old) === JSON.stringify(es) ? old : es));
        },
        (err) => alive && setError(String(err)),
      );
    reload.current = () => void fetch();
    // One status as the tab opens: Commit is ready at once instead of after the watcher's first
    // tick, and in base mode the first read already knows the base. A watcher status that came in
    // first wins over it (openStatus wires the two through statusGate).
    const { first, stop, reread } = openStatus(
      () => invoke<Status>("scm_status", { worktree: root }),
      (on) => watchStatus(root, on),
      (s) => {
        if (!alive) return;
        latest.current = s;
        setStatus(s);
      },
      () => {
        if (front.current) void fetch();
        else missed.current = () => void fetch();
      },
    );
    rereadRef.current = reread;
    if (mode === "base") void first.then(fetch);
    else void fetch();
    return () => {
      alive = false;
      missed.current = null;
      rereadRef.current = null;
      stop();
    };
  }, [root, mode, pinnedBase]);

  const toggleViewed = useCallback(
    (e: Entry) => {
      const k = entryKey(e);
      if (ready.get(k) !== e.stamp) return; // still loading or waiting for a click: not viewable yet
      setViewed((v) => {
        const next = { ...v };
        if (next[k] === e.stamp) delete next[k];
        else next[k] = e.stamp;
        return next;
      });
    },
    [ready],
  );
  const toggleFold = useCallback((k: string) => setFold((f) => ({ ...f, [k]: !f[k] })), []);
  const jump = useCallback((index: number) => jumpRef.current?.(index), []);
  const openRef = useRef(onOpenDiff);
  openRef.current = onOpenDiff;
  const openDiff = useCallback((path: string, staged: boolean) => openRef.current?.(path, staged), []);
  // The drag's listeners end on release, on a cancelled pointer (the system took it) and when the tab closes mid-drag.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);
  const resize = (down: React.PointerEvent) => {
    endDrag.current?.();
    const x0 = down.clientX;
    const w0 = width;
    const move = (m: PointerEvent) => setWidth(Math.max(TREE_MIN, Math.min(TREE_MAX, w0 + m.clientX - x0)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      endDrag.current = null;
    };
    endDrag.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // Runs one git action under the one-at-a-time guard, showing what it is doing and what came of it.
  const act = (what: string, work: () => Promise<Say | null>) =>
    void turn.run(async () => {
      setPending(what);
      setOutcome(null);
      try {
        const say = await work();
        if (say) setOutcome(say);
      } finally {
        setPending(null);
        // Read again at once, so the lists and the Commit button match git without waiting for the watcher.
        // The answer yields to a watcher status that landed while it ran (statusGate.reread).
        const use = rereadRef.current?.();
        invoke<Status>("scm_status", { worktree: root }).then(
          (s) => {
            if (!use) return;
            use(s);
          },
          () => undefined,
        );
        reload.current();
      }
    });
  const commit = () => {
    if (turn.busy() || !canCommit(status, message)) return;
    act("Committing", () =>
      invoke<CommitOutcome>("scm_commit", { worktree: root, message }).then(
        (out): Say => {
          if (out.id) {
            setMessage("");
            return { text: `Committed ${out.id}`, bad: false };
          }
          return { text: `${out.blocked ? "Commit blocked by a hook" : "Commit failed"}: ${out.output}`, bad: true };
        },
        (e): Say => ({ text: String(e), bad: true }),
      ),
    );
  };
  const call = invoke as <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
  const stage = useCallback(
    (paths: string[], on: boolean) => {
      if (paths.length) act(on ? "Staging" : "Unstaging", () => stagePaths(call, root, paths, on));
    },
    [root],
  );
  // Unstaging a renamed file names its old path too; the entry's own path alone would leave the delete staged.
  const stageEntry = useCallback(
    (e: Entry) => {
      const rel = relTo(root, e.path);
      const from = e.staged ? latest.current?.staged.find((c) => c.path === rel)?.from : null;
      stage(from ? unstagePaths({ path: rel, from }) : [rel], !e.staged);
    },
    [stage, root],
  );
  const remote = (id: "push" | "pull" | "sync", label: string) => act(`${id === "sync" ? "Syncing" : id === "push" ? "Pushing" : "Pulling"}`, () => runRemote(call, root, id, label));
  // T-709: runs only from the Ask's confirm; act re-reads the status and the list, so the conflicts clear when it succeeds.
  const abortOp = (op: string) => {
    setAborting(null);
    act(`Aborting the ${op}`, () =>
      invoke("scm_abort", { worktree: root }).then(
        (): Say => ({ text: `${abortLabel(op)}: the workspace is back where it was`, bad: false }),
        (e): Say => ({ text: `${abortLabel(op)} failed: ${String(e)}`, bad: true }),
      ),
    );
  };
  const say = (text: string) => {
    setSaid(text);
    window.clearTimeout(saidTimer.current);
    saidTimer.current = window.setTimeout(() => setSaid(null), 4000);
  };
  // EDIT-007: the chord (through App's copiers) and the header button copy the last-focused view's selection.
  const copyContext = (): boolean => {
    const text = allChangesContext(last.current, root);
    if (text === null) return false;
    navigator.clipboard.writeText(text).then(
      () => say("Copied with path and lines"),
      (err) => say(`Nothing was copied: ${String(err)}`),
    );
    return true;
  };
  useEffect(() => {
    copiers.set(id, copyContext);
    return () => {
      copiers.delete(id);
      window.clearTimeout(saidTimer.current);
    };
  }, [id, root]);
  const focusedView = useCallback((f: LastFocus) => void (last.current = f), []);
  const goneView = useCallback((v: object) => {
    if (last.current?.view === v) last.current = null;
  }, []);
  const foldAll = (on: boolean) => setFold(Object.fromEntries((entries ?? []).map((e) => [entryKey(e), on])));
  const allFolded = (entries?.length ?? 0) > 0 && (entries ?? []).every((e) => fold[entryKey(e)]);
  const toggle = (k: keyof Draw | "tree") => setOver((o) => ({ ...o, [k]: !layout[k] }));
  const draw = useMemo<Draw>(() => ({ split: layout.split, wrap: layout.wrap, spaces: layout.spaces }), [layout.split, layout.wrap, layout.spaces]);
  const tagFor = useCallback((e: Entry) => tagOf(e, base !== null), [base]);

  const count = entries?.length ?? 0;
  return (
    <section className={`pane editor all-changes${focused ? " focused" : ""}`} hidden={hidden} aria-label="All Changes" onMouseDown={onFocus} data-kind="changes" data-key={id} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="All Changes">
          <FileCode size={13} />
        </span>
        <span className="title">All Changes</span>
        <span className="preview-tag">
          <ViewedTag entries={entries ?? []} viewed={viewed} ready={ready} />
        </span>
        <span className="path" title={root}>
          {root}
        </span>
        <span className="right ac-opts">
          <select className="ac-mode" aria-label="Compare" title="What the changes are measured against" value={mode} onChange={(e) => setMode(e.target.value as "tree" | "base")}>
            <option value="tree">Working tree</option>
            <option value="base">{base ? `Branch vs ${base.against}` : "Branch vs base"}</option>
          </select>
          <span className="view-switch" role="group" aria-label="Layout">
            <button aria-pressed={!layout.split} onClick={() => setOver((o) => ({ ...o, split: false }))} title="Inline">
              Inline
            </button>
            <button aria-pressed={layout.split} onClick={() => setOver((o) => ({ ...o, split: true }))} title="Side by side">
              Side by side
            </button>
          </span>
          <label className="ac-opt" title="Wrap long lines">
            <input type="checkbox" checked={layout.wrap} onChange={() => toggle("wrap")} aria-label="Wrap lines" /> Wrap
          </label>
          <label className="ac-opt" title="Show changes that only move whitespace">
            <input type="checkbox" checked={layout.spaces} onChange={() => toggle("spaces")} aria-label="Show whitespace changes" /> Whitespace
          </label>
          <button
            className="link"
            onClick={() =>
              void save({ [AC_SPLIT_KEY]: layout.split, [AC_WRAP_KEY]: layout.wrap, [AC_WHITESPACE_KEY]: layout.spaces, [AC_TREE_KEY]: layout.tree }).then(
                (ok) => say(ok ? "Saved as the default layout" : "The default layout was not saved; try again"),
                () => say("The default layout was not saved; try again"),
              )
            }
            title="New All Changes tabs start with this layout"
          >
            Make default
          </button>
          {said && (
            <span className="note" role="status">
              {said}
            </span>
          )}
          <button className="btn" onClick={() => copyContext() || say("Click in a file's diff and select some lines first")} title="Copy the selection with its path and line numbers">
            Copy context
          </button>
          <button className="link" onClick={() => foldAll(!allFolded)} disabled={!count} aria-label={allFolded ? "Expand all" : "Collapse all"}>
            {allFolded ? "Expand all" : "Collapse all"}
          </button>
          <button className="ib" aria-pressed={layout.tree} onClick={() => toggle("tree")} title={layout.tree ? "Hide the file tree" : "Show the file tree"} aria-label="File tree">
            <List size={12} />
          </button>
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          The changes did not load: {error}. They are read again when git state moves.{" "}
          <button className="btn" onClick={() => reload.current()}>
            Retry
          </button>
        </div>
      )}
      <div className="scm-commit ac-commit ac-actions" role="group" aria-label="Stage, push and pull">
        <div className="ac-commit-row">
          <button className="btn" disabled={pending !== null || bulkPaths(status, true).length === 0} onClick={() => stage(bulkPaths(status, true), true)} title={pending !== null ? `Waiting for ${pending.toLowerCase()}` : bulkPaths(status, true).length === 0 ? "Nothing to stage" : "Stage every changed and new file"}>
            Stage all
          </button>
          <button className="btn" disabled={pending !== null || bulkPaths(status, false).length === 0} onClick={() => stage(bulkPaths(status, false), false)} title={pending !== null ? `Waiting for ${pending.toLowerCase()}` : bulkPaths(status, false).length === 0 ? "Nothing to unstage" : "Unstage every staged file"}>
            Unstage all
          </button>
          {remoteButtons(status).map((b) => (
            <button key={b.id} className="btn" disabled={pending !== null || b.reason !== null} onClick={() => remote(b.id, b.label)} title={b.reason ?? b.label}>
              {b.label}
            </button>
          ))}
          {pending && (
            <span className="note" role="status">
              {pending}…
            </span>
          )}
        </div>
      </div>
      {status?.operation && (
        <div className="notice ac-op" role="status" aria-label="Operation in progress">
          A {status.operation} is in progress{status.conflicts.length ? `, with ${status.conflicts.length} ${status.conflicts.length === 1 ? "file" : "files"} in conflict` : ""}.{" "}
          <button className="btn" data-abort={status.operation} disabled={pending !== null} onClick={() => setAborting(status.operation)} title={pending !== null ? `Waiting for ${pending.toLowerCase()}` : `Stop the ${status.operation} and go back to where it began`}>
            {abortLabel(status.operation)}
          </button>
        </div>
      )}
      {aborting && status?.operation === aborting && <Ask title={`${abortLabel(aborting)}?`} body={abortLoss(aborting)} confirm={abortLabel(aborting)} onConfirm={() => abortOp(aborting)} onCancel={() => setAborting(null)} />}
      <div className="scm-commit ac-commit" aria-label="Commit">
          <textarea className="field multi" aria-label="Commit message" placeholder={status?.branch ? `Message (Ctrl+Enter to commit on ${status.branch})` : "Message (Ctrl+Enter to commit)"} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => isCommitShortcut(e) && (e.preventDefault(), commit())} />
          <div className="ac-commit-row">
            <button className="btn" disabled={pending !== null || !canCommit(status, message)} onClick={commit} title={status && status.staged.length === 0 ? "Nothing is staged: use Stage all above, or Stage on a file in the Working tree view" : status && status.conflicts.length ? "Conflicts remain" : undefined}>
              Commit{status?.staged.length ? ` ${status.staged.length} staged` : ""}
            </button>
            {status && status.staged.length === 0 && message.trim() !== "" && !outcome && <span className="note">Nothing is staged yet: use Stage all, or Stage on a file in the Working tree view.</span>}
            {outcome && (
              <span className={`note${outcome.bad ? " warn" : ""}`} role={outcome.bad ? "alert" : "status"}>
                {outcome.text}
              </span>
            )}
          </div>
      </div>
      <div className="pane-body ac-body">
        {layout.tree && <ChangeTree entries={entries} root={root} width={width} ready={ready} viewed={viewed} keyOf={entryKey} tagOf={tagFor} onJump={jump} onToggleViewed={toggleViewed} />}
        {layout.tree && (
          <div
            className="ac-handle"
            onPointerDown={resize}
            onKeyDown={(ev) => {
              const w = treeWidthForKey(width, ev.key);
              if (w === null) return;
              ev.preventDefault();
              setWidth(w);
            }}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize the file tree"
            aria-valuemin={TREE_MIN}
            aria-valuemax={TREE_MAX}
            aria-valuenow={width}
            title="Drag, or press the left and right arrow keys, to resize the file tree"
          />
        )}
        <AllChangesList entries={entries} root={root} base={base} draw={draw} cache={cache.current} ready={ready} fold={fold} viewed={viewed} hidden={hidden} idPrefix={`ac-${id}`} jumpRef={jumpRef} loaded={loaded.current} onFocusView={focusedView} onGoneView={goneView} onToggleViewed={toggleViewed} onToggleFold={toggleFold} onOpenDiff={onOpenDiff && base === null ? openDiff : undefined} onStage={base === null ? stageEntry : undefined} stageBusy={pending !== null}>
          {entries === null && !error && <div className="menu-hint">Reading the changes…</div>}
          {base?.note && <div className="menu-hint ac-note">{base.note}</div>}
          {entries && !entries.length && <div className="menu-hint">{base ? `This branch has no changes against ${base.against}.` : "This worktree has no changes."}</div>}
        </AllChangesList>
      </div>
    </section>
  );
}

type SectionProps = { anchor: string; e: Entry; name: string; root: string; base: Base | null; draw: Draw; cache: Cache; ready: ReadyStore; meter: Meter; loaded: Set<string>; onFocusView: (f: LastFocus) => void; onGoneView: (v: object) => void; viewedStamp: string | undefined; onToggleViewed: (e: Entry) => void; folded: boolean; onToggleFold: (key: string) => void; onOpenDiff?: (path: string, staged: boolean) => void; /** Stages (or, for a staged section, unstages) the file; absent against a base, where there is no index side. */ onStage?: (e: Entry) => void; stageBusy?: boolean };

/** Exported for the render-cost test. */
export const Section = memo(function Section({ anchor, e, name, root, base, draw, cache, ready, meter, loaded, onFocusView, onGoneView, viewedStamp, onToggleViewed, folded, onToggleFold, onOpenDiff, onStage, stageBusy }: SectionProps) {
  const key = entryKey(e);
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState(() => loaded.has(key));
  const drew = useReadyStamp(ready, key);
  const canView = drew === e.stamp;
  const viewed = canView && viewedStamp === e.stamp;
  const [sides, setSides] = useState<Sides | null>(null);
  const [pics, setPics] = useState<{ old: string | null; now: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Against the base an image has no "before" to show: it is named like a binary.
  const kind = e.clash ? "conflict" : IMAGE.test(e.path) && !base ? "image" : e.binary || (IMAGE.test(e.path) && base) ? "binary" : "text";
  const waits = kind === "text" && (e.lines ?? 0) > WAIT_OVER && !go;

  // A section is only mounted near the viewport, so it loads at once; its height is reported to the window.
  useEffect(() => (box.current ? meter.watch(box.current, key) : undefined), [meter, key]);

  useEffect(() => {
    if (waits || kind === "conflict") return;
    let alive = true;
    setError(null);
    if (kind === "binary") {
      ready.set(key, e.stamp);
      return;
    }
    if (ready.get(key) !== e.stamp) ready.set(key, null);
    if (kind === "image") {
      const url = (bytes: ArrayBuffer) => (bytes.byteLength ? URL.createObjectURL(new Blob([bytes], { type: /\.svg$/i.test(e.path) ? "image/svg+xml" : "" })) : null);
      const made: string[] = [];
      Promise.all([invoke<ArrayBuffer>("diff_image", { path: e.path, staged: e.staged, new: false }), invoke<ArrayBuffer>("diff_image", { path: e.path, staged: e.staged, new: true })]).then(
        ([a, b]) => {
          if (!alive) return;
          const p = { old: url(a), now: url(b) };
          made.push(...[p.old, p.now].filter((u): u is string => !!u));
          setPics(p);
          ready.set(key, e.stamp);
        },
        (err) => alive && setError(String(err)),
      );
      return () => {
        alive = false;
        made.forEach((u) => URL.revokeObjectURL(u));
      };
    }
    const hit = cache.get(key);
    if (hit && hit.stamp === e.stamp) setSides(hit.sides);
    else {
      const [cmd, args] = sidesCall(base, root, e);
      invoke<Sides>(cmd, args).then(
        (s) => {
          if (!alive) return;
          cache.set(key, { stamp: e.stamp, sides: s });
          setSides(s);
        },
        (err) => alive && setError(String(err)),
      );
    }
    return () => {
      alive = false;
    };
  }, [waits, e.stamp, kind, base?.since]);

  // The diff, drawn again whenever new sides arrive, the layout changes or the section unfolds.
  useEffect(() => {
    if (!sides || !host.current || folded) return;
    const lang = new Compartment();
    const common = (old: boolean): Extension[] => [
      basicSetup,
      look,
      syntaxHighlighting(oneDarkHighlightStyle),
      lang.of([]),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      draw.wrap ? EditorView.lineWrapping : [],
      EditorView.domEventHandlers({
        focus: (_e, view) => {
          onFocusView({ path: e.path, old, view });
          return false;
        },
      }),
    ];
    const diffConfig = draw.spaces ? undefined : { override: withoutWhitespace };
    const collapseUnchanged = { margin: 3, minSize: 6 };
    let views: EditorView[];
    let merge: MergeView | null = null;
    if (draw.split) {
      merge = new MergeView({ a: { doc: sides.original, extensions: common(true) }, b: { doc: sides.modified, extensions: common(false) }, parent: host.current, gutter: true, collapseUnchanged, diffConfig });
      views = [merge.a, merge.b];
    } else {
      views = [new EditorView({ doc: sides.modified, parent: host.current, extensions: [...common(false), unifiedMergeView({ original: sides.original, mergeControls: false, gutter: true, collapseUnchanged, diffConfig })] })];
    }
    languageFor(baseName(e.path))
      ?.load()
      .then((support) => views.forEach((v) => v.dispatch({ effects: lang.reconfigure(support) })))
      .catch(() => undefined);
    ready.set(key, e.stamp);
    return () => {
      views.forEach(onGoneView);
      if (merge) merge.destroy();
      else views.forEach((v) => v.destroy());
    };
  }, [sides, draw.split, draw.wrap, draw.spaces, folded]);

  const drawn = (kind === "text" && sides) || (kind === "image" && pics) || (kind === "binary");
  return (
    <div className="ac-section" id={anchor} ref={box} data-key={key} data-folded={folded || undefined}>
      <div className="ac-head">
        <button className="ib" onClick={() => onToggleFold(key)} aria-expanded={!folded} aria-label={folded ? `Expand ${name}` : `Collapse ${name}`} title={folded ? "Expand" : "Collapse"} style={folded ? { transform: "rotate(-90deg)" } : undefined}>
          <ChevronDown size={12} />
        </button>
        <label className="hit-box"><input type="checkbox" checked={viewed} disabled={!canView} onChange={() => onToggleViewed(e)} title={canView ? "Mark as viewed" : "Not loaded yet"} aria-label={`Viewed ${name}`} /></label>
        <span className="ac-name" title={e.path}>
          {name}
        </span>
        <span className={`preview-tag${e.clash ? " ac-conflict" : ""}`} title={e.clash ? `Unresolved conflict: ${clashWord(e.clash)}` : undefined}>{tagOf(e, base !== null)}</span>
        {e.lines !== null && <span className="ac-lines">{e.lines} changed {e.lines === 1 ? "line" : "lines"}</span>}
        {onStage && !e.clash && (
          <button className="link" onClick={() => onStage(e)} disabled={stageBusy} title={e.staged ? "Unstage this file" : "Stage this file"} aria-label={`${e.staged ? "Unstage" : "Stage"} ${name}`}>
            {e.staged ? "Unstage" : "Stage"}
          </button>
        )}
        {onOpenDiff && (
          <button className="ib" onClick={() => onOpenDiff(e.path, e.staged)} title="Open as a diff tab, in the split chosen in Source Control" aria-label={`Open ${name} as a tab`}>
            <FileCode size={12} />
          </button>
        )}
      </div>
      {error && (
        <div className="notice load-failed" role="alert">
          This file's diff did not load: {error}
        </div>
      )}
      {folded ? null : kind === "conflict" ? (
        <div className="ac-wait ac-clash">Unresolved conflict ({clashWord(e.clash ?? "")}). Resolve it in the file; it is left out of the diff, as it is when a commit message is written.</div>
      ) : waits ? (
        <div className="ac-wait">
          {e.lines} changed lines.
          <button
            className="btn"
            onClick={() => {
              loaded.add(key);
              setGo(true);
            }}
          >
            Load diff
          </button>
        </div>
      ) : kind === "binary" ? (
        <div className="ac-wait">{base && IMAGE.test(e.path) ? "Image; against the base only its name is shown." : "Binary file; its contents are not shown."}</div>
      ) : kind === "image" ? (
        pics ? (
          <div className="ac-images">
            <figure>
              <figcaption>Before</figcaption>
              {pics.old ? <img src={pics.old} alt={`${name} before`} /> : <span className="menu-hint">Not there</span>}
            </figure>
            <figure>
              <figcaption>After</figcaption>
              {pics.now ? <img src={pics.now} alt={`${name} after`} /> : <span className="menu-hint">Removed</span>}
            </figure>
          </div>
        ) : (
          <div style={{ height: estimate(e) }} />
        )
      ) : (
        <div className="ac-editor" ref={host} style={drawn ? undefined : { height: estimate(e) }} />
      )}
    </div>
  );
});

/** The "n files · m viewed" line; it alone re-renders as sections finish drawing. */
function ViewedTag({ entries, viewed, ready }: { entries: Entry[]; viewed: Record<string, string>; ready: ReadyStore }) {
  useReadyVersion(ready);
  const done = entries.filter((e) => viewed[entryKey(e)] === e.stamp && ready.get(entryKey(e)) === e.stamp).length;
  return (
    <>
      {entries.length} {entries.length === 1 ? "file" : "files"}
      {entries.length ? ` · ${done} viewed` : ""}
    </>
  );
}

type ListProps = {
  entries: Entry[] | null;
  root: string;
  base: Base | null;
  draw: Draw;
  cache: Cache;
  ready: ReadyStore;
  fold: Record<string, boolean>;
  viewed: Record<string, string>;
  hidden: boolean;
  idPrefix: string;
  jumpRef: MutableRefObject<((index: number) => void) | null>;
  loaded: Set<string>;
  onFocusView: (f: LastFocus) => void;
  onGoneView: (v: object) => void;
  onToggleViewed: (e: Entry) => void;
  onToggleFold: (key: string) => void;
  onOpenDiff?: (path: string, staged: boolean) => void;
  onStage?: (e: Entry) => void;
  stageBusy?: boolean;
  children?: ReactNode;
  /** The scroll offset of the first paint; a tab keeps its own scroll, so only a test sets it. */
  initialTop?: number;
};

/** The scrolling column of sections: only those near the viewport are mounted. */
export function AllChangesList({ entries, root, base, draw, cache, ready, fold, viewed, hidden, idPrefix, jumpRef, loaded, onFocusView, onGoneView, onToggleViewed, onToggleFold, onOpenDiff, onStage, stageBusy, children, initialTop }: ListProps) {
  const list = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const top = useRef(0);
  const items = useMemo(
    () =>
      (entries ?? []).map((e) => {
        const folded = !!fold[entryKey(e)];
        return { key: entryKey(e), guess: SECTION_CHROME + (folded ? 0 : estimate(e)), folded };
      }),
    [entries, fold],
  );
  const { slice, meter, onScroll, jumpTo } = useSectionWindow(list, inner, items, initialTop);
  useEffect(() => {
    jumpRef.current = jumpTo;
    return () => {
      jumpRef.current = null;
    };
  }, [jumpRef, jumpTo]);
  // Coming back to the tab puts the scroll where it was.
  useEffect(() => {
    if (!hidden && list.current) list.current.scrollTop = top.current;
  }, [hidden]);

  const spacer = (height: number) => <div style={{ height, flex: "none" }} aria-hidden />;
  return (
    <div
      className="ac-list"
      ref={list}
      style={{ position: "relative" }}
      onScroll={(ev) => {
        top.current = ev.currentTarget.scrollTop;
        onScroll();
      }}
    >
      {children}
      <div ref={inner} style={{ flex: "none", display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
        {slice.top > 0 && spacer(slice.top)}
        {(entries ?? []).slice(slice.start, slice.end).map((e, k) => (
          <Section key={entryKey(e)} anchor={`${idPrefix}-${slice.start + k}`} e={e} name={relTo(root, e.path)} root={root} base={base} draw={draw} cache={cache} ready={ready} meter={meter} loaded={loaded} onFocusView={onFocusView} onGoneView={onGoneView} viewedStamp={viewed[entryKey(e)]} onToggleViewed={onToggleViewed} folded={!!fold[entryKey(e)]} onToggleFold={onToggleFold} onOpenDiff={onOpenDiff} onStage={onStage} stageBusy={stageBusy} />
        ))}
        {slice.bottom > 0 && spacer(slice.bottom)}
      </div>
    </div>
  );
}
