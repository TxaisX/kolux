// The explorer (EDIT-033): the worktree's files as a tree in a panel on the right. Arrows, Home and
// End move the highlight; Right opens a folder or steps into it, Left folds it or climbs to its
// parent; Enter or a click opens a file; Mod-click and Shift-click select several rows. Only the rows
// on screen are drawn, so a huge folder scrolls smoothly. A symlink opens as a folder only once
// it is confirmed to point at one. Open folders and the scroll survive hiding the panel; App mounts
// one explorer per worktree, so they reset when the worktree changes. With no watcher yet (T-444),
// files made outside the app show up when the window gets the focus back or the panel is shown:
// the root and every open folder are read again in place, keeping open folders and the scroll.
// File operations (EDIT-034, part 1): New file and New folder in the header, F2 renames in place
// (Enter or leaving the field commits, Escape cancels), Delete moves the selection to the trash after
// one question, Mod+Z and Mod+Shift+Z (or Ctrl+Y) undo and redo those, and the path or the relative
// path can be copied. Part 2: Mod+C then Mod+V copies the selection into the highlighted folder (a taken
// name gets " copy"), dragging rows moves them into the folder under the pointer (the tree scrolls near its
// edges), and files dropped in from the desktop are copied there; each of these undoes too.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ChevronDown, Close, EyeOff, FolderPlus, Funnel, Plus, Refresh, Rocket, Search } from "../chrome/icons";
import { clampMenu, useMenuKeys } from "./menuNav";
import { DOTFILES_KEY, IGNORED_KEY, filterRows, folderGlob, hidesDotfiles, rowMenu, sameNodes, withDotfiles, withoutDotfiles, withoutIgnored } from "./explorerView";
import { MAX_DROP_BYTES, projectDrop, refuseDrop } from "./desktopDrops";
import FileIcon from "./FileIcon";
import { fileTargetsOf, loadTargets, openFileIn, openIn, type App, type Target } from "./openIn";
import ContentSearch from "./ContentSearch";
import "./explorerBar.css";
import { EXPAND_CAP, insideDir, menuLabel, nextWave, openRow, withExtraMenu, type AnyMenuId, type OpenFile } from "./explorerBar";
import { isLog } from "./logFollow";
import { currentSeed } from "./searchSeed";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import { explorerSearchKey } from "../keys/useWindowKeys";
import { announceMoves } from "./fileMoved";

export type Node = { name: string; path: string; kind: "dir" | "file" | "link" };
export type Row = { node: Node; depth: number; parent: string | null };
export type Draft = { dir: string; folder: boolean };
/** One explorer action, as the undo history keeps it. */
export type Op =
  | { kind: "create"; path: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "trash"; paths: string[] }
  | { kind: "copy"; from: string[]; dir: string; made: string[] }
  | { kind: "move"; moves: [string, string][] }; // [from, to]
type Gone = { path: string; permanent: boolean; error: string | null };
type Placed = { from: string; to: string | null; error: string | null };

const ROW = 22; // px
const SPARE = 10; // rows drawn beyond each edge
/** A WSL share has no trash, so a delete there is for good (matches fsops::is_wsl). */
export const isWsl = (p: string) => /^(\\\\|\/\/)(\?[\\/]unc[\\/])?wsl(\$|\.localhost)[\\/]/i.test(p);
export const DRAFT = "\u0000draft"; // the path of the row a new name is typed into

/** The rows on show: every loaded child of an open folder, depth first; a draft row leads its folder. */
export function flatten(root: string, kids: Record<string, Node[] | undefined>, open: Set<string>, draft?: Draft | null): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const parent = dir === root ? null : dir;
    if (draft?.dir === dir) out.push({ node: { name: "", path: DRAFT, kind: draft.folder ? "dir" : "file" }, depth, parent });
    for (const node of kids[dir] ?? []) {
      out.push({ node, depth, parent });
      if (open.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The paths from row a to row b, either way round. */
export const between = (rows: Row[], a: number, b: number) => rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.node.path);
export const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
export const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
const inside = insideDir; // T-224-b: Windows paths compare without case, and only on whole folder names
/** A selection to delete: a folder chosen along with things inside it goes once, as the folder. */
export const tops = (paths: string[]) => paths.filter((p) => p !== DRAFT && !paths.some((q) => q !== p && inside(p, q)));
/** The call that undoes an action, and the one that does it again. */
export function undoOf(op: Op): [string, Record<string, unknown>] {
  switch (op.kind) {
    case "create":
      return ["fs_trash", { paths: [op.path] }];
    case "rename":
      return ["fs_rename", { path: op.to, name: baseName(op.from) }];
    case "trash":
      return ["fs_restore", { paths: op.paths }];
    case "copy":
      return ["fs_trash", { paths: op.made }];
    case "move":
      return ["fs_move", { moves: op.moves.map(([from, to]) => [to, parentOf(from)]) }];
  }
}
export function redoOf(op: Op): [string, Record<string, unknown>] {
  switch (op.kind) {
    case "create":
      return ["fs_restore", { paths: [op.path] }];
    case "rename":
      return ["fs_rename", { path: op.from, name: baseName(op.to) }];
    case "trash":
      return ["fs_trash", { paths: op.paths }];
    case "copy":
      return ["fs_copy", { paths: op.from, dir: op.dir }];
    case "move":
      return ["fs_move", { moves: op.moves.map(([from, to]) => [from, parentOf(to)]) }];
  }
}
const touched = (op: Op) =>
  op.kind === "trash" ? op.paths : op.kind === "create" ? [op.path] : op.kind === "rename" ? [op.from, op.to] : op.kind === "copy" ? op.made : op.moves.flat();
/** The folder something lands in at row i: that folder, or the one holding that file; past the last row, the root. */
export function dirAt(rows: Row[], i: number, root: string, isDir: (n: Node) => boolean) {
  const r = rows[i];
  return !r || r.node.path === DRAFT ? root : isDir(r.node) ? r.node.path : (r.parent ?? root);
}
/** A drag's moves: each top-level item not already in that folder and not the folder itself. */
export const movesInto = (paths: string[], dir: string): [string, string][] => tops(paths).filter((p) => p !== dir && parentOf(p) !== dir).map((p) => [p, dir]);
const EDGE = 24; // px from the tree's top or bottom where a drag scrolls it
const LIVE_MS = 3000; // EDIT-035: how often the shown folders are read again
const LIVE_FOLDERS = 40;

type Props = {
  root: string;
  hidden: boolean;
  focusAsk: number;
  /** Opens a file; EDIT-026 (T-317): the row menu's Follow log asks for a followed tab (App's openFile). */
  onOpen: OpenFile;
  onClose: () => void;
  /** EDIT-035: opens a terminal in a folder (the "Open in terminal" row item; without it the item is left out). */
  onOpenTerminal?: (dir: string) => void;
  /** EDIT-037: shows the explorer when Mod+Shift+F is pressed while it is hidden. */
  onWake?: () => void;
};

/** Whether a read of `dir` may go out now: the live poll (quiet) waits while the folder's last read is still out; any other read always goes. Marks it out. */
export function claimRead(out: Set<string>, dir: string, quiet: boolean): boolean {
  if (quiet && out.has(dir)) return false;
  out.add(dir);
  return true;
}

/** What Expand all says when it stopped at the folder cap or met folders it could not read (null: nothing to say). */
export function expandNote(capped: boolean, unreadable: number): string | null {
  const parts = [capped ? `Expand all stopped at ${EXPAND_CAP} folders; open the rest one by one.` : "", unreadable ? `${unreadable} folder${unreadable === 1 ? "" : "s"} could not be read (marked "not readable").` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export default function Explorer({ root, hidden, focusAsk, onOpen, onClose, onOpenTerminal, onWake }: Props) {
  const keymap = useKeymap();
  // EDIT-037: the explorer shows either the file tree or the content search; Mod+Shift+F
  // brings the search forward (with its text selected) while the explorer is shown.
  const [searching, setSearching] = useState(false);
  const [searchAsk, setSearchAsk] = useState(0);
  const [seed, setSeed] = useState<{ text: string; at: number } | undefined>(undefined); // EDIT-038: the editor's selection or word at the caret
  const startSearch = () => {
    const text = currentSeed();
    if (text) setSeed({ text, at: Date.now() });
    setSearchAsk((n) => n + 1);
  };
  // Closing the search never starts one (so the query is not re-seeded); focus goes back to the tree.
  const closeSearch = () => {
    setSearching(false);
    window.setTimeout(() => box.current?.focus());
  };
  // EDIT-043: the Open in menu (null while closed) and the last launch that failed.
  const [openTargets, setOpenTargets] = useState<{ list: Target[]; x: number; y: number } | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  // T-323-b: a file row's menu also lists the Open in apps (read from the settings when the menu opens).
  const [fileApps, setFileApps] = useState<App[]>([]);
  // EDIT-037: with the explorer hidden the key shows it first (onWake) and the search starts once it is on screen.
  const wakeSearch = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!explorerSearchKey(keymap, e)) return; // UX lane C: waits only under a menu or modal dialog
      if (hidden && !onWake) return;
      e.preventDefault();
      setSearching(true);
      if (hidden) {
        wakeSearch.current = true;
        onWake?.();
      } else startSearch();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [hidden, keymap, onWake]);
  useEffect(() => {
    if (!hidden && wakeSearch.current) {
      wakeSearch.current = false;
      startSearch();
    }
  }, [hidden]);
  const [scope, setScope] = useState<{ glob: string; at: number } | undefined>(undefined); // EDIT-035: "Find in folder"
  const [kids, setKids] = useState<Record<string, Node[] | undefined>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [real, setReal] = useState<Record<string, string>>({}); // a link's confirmed kind
  const [at, setAt] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null); // paths waiting for the delete answer
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null); // bad notes show as failures
  const [clip, setClip] = useState<string[] | null>(null); // what Mod+C picked, for Mod+V
  const [dropAt, setDropAt] = useState<string | null>(null); // the folder a drag or a desktop drop would land in
  const swallow = useRef(false); // the click that ends a drag is not a click on the row
  const done = useRef<Op[]>([]);
  const undone = useRef<Op[]>([]);

  // A read that finds the same entries keeps the old list, so the live refresh below does not redraw an unchanged tree.
  // The live poll (quiet) skips a folder whose last read has not come back yet, so a slow disk is not
  // asked again every few seconds; a read the user or an edit asks for always goes out.
  const inflight = useRef<Set<string>>(new Set());
  // How many reads of a folder are out: a user read and a poll can overlap, and the mark stays until the last one is back.
  const reading = useRef<Map<string, number>>(new Map());
  const load = (dir: string, quiet = false) => {
    if (!claimRead(inflight.current, dir, quiet)) return Promise.resolve();
    reading.current.set(dir, (reading.current.get(dir) ?? 0) + 1);
    return invoke<Node[]>("dir_list", { path: dir })
      .then(
        (list) => {
          setKids((k) => (sameNodes(k[dir], list) ? k : { ...k, [dir]: list }));
          setFailed((f) => (dir in f ? Object.fromEntries(Object.entries(f).filter(([p]) => p !== dir)) : f));
        },
        (err) => setFailed((f) => (f[dir] === String(err) ? f : { ...f, [dir]: String(err) })),
      )
      .finally(() => {
        const left = (reading.current.get(dir) ?? 1) - 1;
        if (left > 0) reading.current.set(dir, left);
        else {
          reading.current.delete(dir);
          inflight.current.delete(dir);
        }
      });
  };
  // VIEW-059 (T-224-b): refresh shows a spinner and is off while it runs; expand all opens the folders level by level.
  const [refreshing, setRefreshing] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all(shownDirs.current.map((d) => load(d))).finally(() => setRefreshing(false));
  };
  const expandAll = async () => {
    if (expanding) return;
    setExpanding(true);
    try {
      const seen = new Set(open);
      const lists: Record<string, Node[] | undefined> = { ...kids };
      let room = EXPAND_CAP;
      let unreadable = 0;
      for (let level = 0; level < 12 && room > 0; level++) {
        const wave = nextWave(lists, seen, room);
        if (!wave.length) break;
        room -= wave.length;
        wave.forEach((d) => seen.add(d));
        setOpen((o) => new Set([...o, ...wave]));
        const got = await Promise.all(wave.map((d) => invoke<Node[]>("dir_list", { path: d }).then((l) => [d, l] as const, (err) => [d, String(err)] as const)));
        const fresh = Object.fromEntries(got.filter((x): x is readonly [string, Node[]] => Array.isArray(x[1])));
        // A folder that would not read is marked "not readable" on its row, not skipped without a word.
        const bad = got.filter((x): x is readonly [string, string] => typeof x[1] === "string");
        if (bad.length) {
          setFailed((f) => ({ ...f, ...Object.fromEntries(bad) }));
          unreadable += bad.length;
        }
        Object.assign(lists, fresh);
        setKids((k) => ({ ...k, ...fresh }));
      }
      const capped = room <= 0 && nextWave(lists, seen, 1).length > 0;
      const said = expandNote(capped, unreadable);
      if (said) setNote({ bad: true, text: said });
    } finally {
      setExpanding(false);
    }
  };
  const shownDirs = useRef<string[]>([]);
  shownDirs.current = [root, ...open];
  useEffect(() => {
    if (hidden) return;
    const again = () => shownDirs.current.forEach((d) => void load(d));
    again();
    window.addEventListener("focus", again);
    // EDIT-035: the tree keeps up with the disk by itself: every shown folder is read again every few seconds while the
    // window is on screen (up to 40 folders a round), and a folder that did not change costs no redraw.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") shownDirs.current.slice(0, LIVE_FOLDERS).forEach((d) => void load(d, true));
    }, LIVE_MS);
    return () => {
      window.removeEventListener("focus", again);
      window.clearInterval(timer);
    };
  }, [root, hidden]);
  const reloadAround = (paths: string[]) => new Set(paths.map(parentOf)).forEach((d) => void load(d));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientHeight && setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Hidden, the panel loses its scroll; showing it again puts the scroll back.
  useEffect(() => {
    if (!hidden && box.current) box.current.scrollTop = scroll;
    // A hidden tree must not keep the keyboard.
    if (hidden && box.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }, [hidden]);
  useEffect(() => {
    // T-696: with the content search open, its box takes the focus, so the next Mod+Shift+E hides the panel.
    if (focusAsk && !hidden) searching ? setSearchAsk((n) => n + 1) : box.current?.focus();
  }, [focusAsk, hidden]);

  // EDIT-035: the name filter shows every match in the loaded folders with the folders above it; the
  // dotfiles switch (per worktree) leaves dot names out.
  const [query, setQuery] = useState("");
  const [noDots, setNoDots] = useState(() => {
    try {
      return hidesDotfiles(localStorage.getItem(DOTFILES_KEY), root);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setNoDots(hidesDotfiles(localStorage.getItem(DOTFILES_KEY), root));
    } catch {
      setNoDots(false);
    }
  }, [root]);
  const flipDots = () => {
    const next = !noDots;
    setNoDots(next);
    try {
      localStorage.setItem(DOTFILES_KEY, withDotfiles(localStorage.getItem(DOTFILES_KEY), root, next));
    } catch {
      /* the switch still works for this session */
    }
  };
  // EDIT-035: git-ignored files are shown by default; the switch (kept per worktree) hides the names git ignores.
  const [noIgnored, setNoIgnored] = useState(() => {
    try {
      return hidesDotfiles(localStorage.getItem(IGNORED_KEY), root);
    } catch {
      return false;
    }
  });
  const [ign, setIgn] = useState<Record<string, string[] | undefined>>({});
  const asked = useRef(new Map<string, Node[] | undefined>());
  useEffect(() => {
    if (!noIgnored) return void asked.current.clear();
    for (const dir of Object.keys(kids)) {
      if (asked.current.get(dir) === kids[dir]) continue;
      asked.current.set(dir, kids[dir]);
      void invoke<string[]>("dir_ignored", { path: dir }).then((names) => setIgn((i) => ({ ...i, [dir]: names })), () => undefined);
    }
  }, [noIgnored, kids]);
  const flipIgnored = () => {
    const next = !noIgnored;
    setNoIgnored(next);
    try {
      localStorage.setItem(IGNORED_KEY, withDotfiles(localStorage.getItem(IGNORED_KEY), root, next));
    } catch {
      /* the switch still works for this session */
    }
  };
  const shown = noDots ? withoutDotfiles(kids) : kids;
  const visible = noIgnored ? withoutIgnored(shown, ign) : shown;
  const rows = query.trim() ? filterRows(flatten(root, visible, new Set(Object.keys(visible)), null), query) : flatten(root, visible, open, draft);
  const index = rows.findIndex((r) => r.node.path === at);
  const isDir = (n: Node) => n.kind === "dir" || (n.kind === "link" && real[n.path] === "dir");

  const show = (i: number) => {
    const el = box.current;
    if (!el || i < 0) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  };
  const pick = (path: string) => {
    setAt(path);
    setSel(new Set([path]));
    anchor.current = path;
  };
  const moveTo = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    pick(r.node.path);
    show(rows.indexOf(r));
  };
  const fold = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      next.delete(path);
      return next;
    });
  // Opens a folder, or a link once it is known to be one; anything else opens as a file.
  const expand = async (n: Node) => {
    let kind = n.kind === "link" ? real[n.path] : n.kind;
    if (n.kind === "link" && !kind) {
      kind = await invoke<string>("path_kind", { path: n.path }).catch(() => "missing");
      setReal((r) => ({ ...r, [n.path]: kind! }));
    }
    if (kind !== "dir") return onOpen(n.path);
    setOpen((o) => new Set(o).add(n.path));
    if (!kids[n.path]) void load(n.path);
  };
  const activate = (n: Node) => (open.has(n.path) ? fold(n.path) : n.kind === "file" ? onOpen(n.path) : void expand(n));

  // --- file operations (EDIT-034) ---
  const fail = (err: unknown) => setNote({ text: String(err), bad: true });
  const record = (op: Op) => {
    done.current.push(op);
    undone.current = [];
    setNote(null);
  };
  const back = () => box.current?.focus();
  const startNew = (folder: boolean, into?: string) => {
    const dir = into ?? dirAt(rows, index, root, isDir);
    if (dir !== root) setOpen((o) => new Set(o).add(dir));
    setRenaming(null);
    setDraft({ dir, folder });
    setNote(null);
  };
  const commitNew = (name: string) => {
    const d = draft;
    setDraft(null);
    back();
    if (!d || !name.trim()) return;
    invoke<string>("fs_create", { dir: d.dir, name, folder: d.folder }).then((path) => {
      record({ kind: "create", path });
      void load(d.dir).then(() => pick(path));
    }, fail);
  };
  /** Open folders that moved or were renamed stay open at their new paths. */
  const follow = (moves: [string, string][], also?: string) => {
    // EDIT-032: open tabs follow their files, unsaved text and drafts included.
    announceMoves(moves);
    moves.forEach(([from, to]) => void invoke("editor_draft_rename", { worktree: root, from, to }).catch(() => undefined));
    const to = (p: string) => moves.reduce((q, [a, b]) => (q === a || inside(q, a) ? b + q.slice(a.length) : q), p);
    const next = new Set([...open].map(to));
    if (also && also !== root) next.add(also);
    setOpen(next);
    [...open].filter((p) => to(p) !== p).forEach((p) => void load(to(p)));
  };
  const commitRename = (from: string, name: string) => {
    setRenaming(null);
    back();
    if (!name.trim() || name === baseName(from)) return;
    invoke<string>("fs_rename", { path: from, name }).then((to) => {
      record({ kind: "rename", from, to });
      follow([[from, to]]);
      void load(parentOf(from)).then(() => pick(to));
    }, fail);
  };
  const askDelete = () => {
    const chosen = tops(sel.size ? [...sel] : at ? [at] : []);
    if (chosen.length) setAsking(chosen);
  };
  const doDelete = (paths: string[]) => {
    setAsking(null);
    back();
    invoke<Gone[]>("fs_trash", { paths }).then((gone) => {
      const binned = gone.filter((g) => !g.error && !g.permanent).map((g) => g.path);
      if (binned.length) record({ kind: "trash", paths: binned });
      const errors = gone.filter((g) => g.error).map((g) => g.error);
      setNote(errors.length ? { text: `Not deleted: ${errors.join("; ")}`, bad: true } : null);
      reloadAround(paths);
      setSel(new Set());
    }, fail);
  };
  const errorsOf = (res: Placed[]) => res.flatMap((p) => (p.error ? [p.error] : []));
  const doCopy = (paths: string[], dir: string) =>
    invoke<Placed[]>("fs_copy", { paths, dir }).then((res) => {
      const landed = res.filter((p) => p.to);
      const made = landed.map((p) => p.to!);
      if (made.length) record({ kind: "copy", from: landed.map((p) => p.from), dir, made });
      const errors = errorsOf(res);
      if (errors.length) setNote({ text: errors.join("; "), bad: true });
      if (dir !== root) setOpen((o) => new Set(o).add(dir));
      void load(dir).then(() => made.length && (setSel(new Set(made)), setAt(made[0])));
    }, fail);
  const doMove = (paths: string[], dir: string) => {
    const moves = movesInto(paths, dir);
    if (!moves.length) return;
    invoke<Placed[]>("fs_move", { moves }).then((res) => {
      const ok = res.flatMap((p): [string, string][] => (p.to ? [[p.from, p.to]] : []));
      if (ok.length) record({ kind: "move", moves: ok });
      const errors = errorsOf(res);
      if (errors.length) setNote({ text: `Not moved: ${errors.join("; ")}`, bad: true });
      follow(ok, dir);
      reloadAround(ok.flat());
      void load(dir);
      setSel(new Set(ok.map(([, to]) => to)));
      if (ok.length) setAt(ok[0][1]);
    }, fail);
  };
  const replay = (from: typeof done, to: typeof done, call: (op: Op) => [string, Record<string, unknown>]) => {
    const op = from.current.pop();
    if (!op) return;
    const [cmd, args] = call(op);
    invoke<Gone[] | Placed[] | string | null>(cmd, args).then(
      (res) => {
        const err = Array.isArray(res) ? res.find((g) => g.error)?.error : null;
        if (err) return fail(err);
        if (op.kind === "copy" && cmd === "fs_copy") op.made = (res as Placed[]).flatMap((p) => (p.to ? [p.to] : [])); // the copies may get new names
        to.current.push(op);
        setNote(null);
        if (cmd === "fs_move") follow((res as Placed[]).flatMap((p): [string, string][] => (p.to ? [[p.from, p.to]] : [])));
        if (cmd === "fs_rename") follow([[args.path as string, res as string]]);
        reloadAround(touched(op));
      },
      (err) => {
        from.current.push(op); // still there to try again
        fail(err);
      },
    );
  };
  const relative = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p);
  const copy = (text: string) =>
    invoke("clip_copy_text", { text })
      .catch(() => navigator.clipboard.writeText(text))
      .then(() => setNote({ text: `Copied ${text}` }), fail);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== box.current) return; // a field inside the panel keeps its own keys
    const r = rows[index];
    const hit = matchEvent(keymap, e.nativeEvent, ["explorer"]);
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    const key = !hit && mod && (e.key === "c" || e.key === "v") ? `Mod+${e.key.toUpperCase()}` : e.key;
    switch (hit?.id ?? key) {
      case "Mod+C": {
        const chosen = tops(sel.size ? [...sel] : at ? [at] : []);
        if (!chosen.length) break;
        setClip(chosen);
        {
          const what = chosen.length === 1 ? baseName(chosen[0]) : `${chosen.length} items`;
          setNote({ text: `${what} ready to paste with Ctrl+V into a folder` });
          // T-249-c: the files also go on the system clipboard, so a paste in another program (a mail, a chat, the desktop) gets them.
          void invoke("clip_copy_files", { paths: chosen }).then(
            () => setNote({ text: `${what} ready to paste with Ctrl+V here or in another program` }),
            (err) => setNote({ text: `${what} ready to paste with Ctrl+V into a folder (not on the system clipboard: ${String(err)})` }),
          );
        }
        break;
      }
      case "Mod+V":
        if (clip) void doCopy(clip, dirAt(rows, index, root, isDir));
        break;
      case "fileExplorer.undo":
        replay(done, undone, undoOf);
        break;
      case "fileExplorer.redo":
        replay(undone, done, redoOf);
        break;
      case "fileExplorer.copyPath":
        if (at) void copy(at);
        break;
      case "fileExplorer.copyRelativePath":
        if (at) void copy(relative(at));
        break;
      case "fileExplorer.delete":
        askDelete();
        break;
      case "F2":
        if (r) setRenaming(r.node.path);
        break;
      case "ArrowDown":
        moveTo(index + 1);
        break;
      case "ArrowUp":
        moveTo(index < 0 ? 0 : index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        if (!r) moveTo(0);
        else if (r.node.kind === "file" || (r.node.kind === "link" && real[r.node.path] && !isDir(r.node))) break;
        else if (!open.has(r.node.path)) void expand(r.node);
        else if (rows[index + 1]?.parent === r.node.path) moveTo(index + 1);
        break;
      case "ArrowLeft":
        if (!r) break;
        if (open.has(r.node.path)) fold(r.node.path);
        else if (r.parent) moveTo(rows.findIndex((x) => x.node.path === r.parent));
        break;
      case "Enter":
        if (r) activate(r.node);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  // Dragging rows moves them. Pointer events, not HTML drag and drop: on Windows the web view hands
  // HTML drags to the desktop drop handler below.
  const rowAt = (clientY: number) => {
    const el = box.current!;
    return Math.floor((clientY - el.getBoundingClientRect().top + el.scrollTop) / ROW);
  };
  const startDrag = (e: React.PointerEvent, path: string) => {
    if (e.button !== 0 || path === DRAFT || path === renaming) return;
    const paths = sel.has(path) ? [...sel] : [path];
    const [x0, y0] = [e.clientX, e.clientY];
    let on = false;
    let edge = 0;
    let last = y0;
    const timer = window.setInterval(() => {
      if (!on || !edge || !box.current) return;
      box.current.scrollTop += edge * (ROW / 2);
      setDropAt(dirAt(rows, rowAt(last), root, isDir));
    }, 30);
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      on = true;
      last = ev.clientY;
      const b = box.current!.getBoundingClientRect();
      edge = ev.clientY < b.top + EDGE ? -1 : ev.clientY > b.bottom - EDGE ? 1 : 0;
      setDropAt(dirAt(rows, rowAt(ev.clientY), root, isDir));
    };
    // The system can cancel a drag (a touch turns into a scroll, a window loses the pointer): nothing moves then.
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.clearInterval(timer);
      setDropAt(null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.clearInterval(timer);
      setDropAt(null);
      if (!on) return;
      swallow.current = true;
      window.setTimeout(() => (swallow.current = false));
      const b = box.current!.getBoundingClientRect();
      const inTree = ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom;
      if (inTree) doMove(paths, dirAt(rows, rowAt(ev.clientY), root, isDir));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  // Files dragged in from the desktop are copied into the folder under the pointer.
  const live = useRef({ rows, isDir, doCopy });
  live.current = { rows, isDir, doCopy };
  useEffect(() => {
    if (hidden) return;
    let off: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        const el = box.current;
        if (p.type === "leave" || !el) return setDropAt(null);
        const ratio = window.devicePixelRatio || 1;
        const [x, y] = [p.position.x / ratio, p.position.y / ratio];
        const b = el.getBoundingClientRect();
        // A dialog over the explorer (a kit's setup) takes the drop instead.
        const over = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom && el.contains(document.elementFromPoint(x, y));
        const dir = over ? dirAt(live.current.rows, rowAt(y), root, live.current.isDir) : null;
        if (p.type !== "drop") return setDropAt(dir);
        setDropAt(null);
        const why = refuseDrop(p.paths);
        if (dir && why) setNote({ text: why, bad: true });
        else if (dir) {
          // EDIT-039: the bytes are counted before anything is copied (when they cannot be counted, the copy reports its own failure).
          void invoke<number>("fs_bytes", { paths: p.paths, cap: MAX_DROP_BYTES })
            .catch(() => null)
            .then((bytes) => {
              const big = refuseDrop(p.paths, bytes);
              if (big) setNote({ text: big, bad: true });
              else void live.current.doCopy(p.paths, dir);
            });
        }
      })
      .then((u) => (gone ? u() : (off = u)), () => {});
    return () => {
      gone = true;
      off?.();
    };
  }, [hidden, root]);

  const onRow = (e: React.MouseEvent, i: number) => {
    if (swallow.current) return;
    const n = rows[i].node;
    if (n.path === DRAFT || n.path === renaming) return;
    box.current?.focus();
    setAt(n.path);
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => {
        const next = new Set(s);
        if (!next.delete(n.path)) next.add(n.path);
        return next;
      });
      anchor.current = n.path;
      return;
    }
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((x) => x.node.path === anchor.current);
      setSel(new Set(between(rows, a < 0 ? i : a, i)));
      return;
    }
    pick(n.path);
    activate(n);
  };

  // EDIT-035: the row menu (right-click): find in folder, open in terminal, view file, add as project, copy, and the file actions.
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; dir: boolean } | null>(null);
  const rowContext = (e: React.MouseEvent, path: string, dir: boolean) => {
    if (path === DRAFT || path === renaming) return;
    e.preventDefault();
    box.current?.focus();
    setAt(path);
    if (!sel.has(path)) pick(path);
    setMenu({ x: e.clientX, y: e.clientY, path, dir });
  };
  useEffect(() => {
    if (!menu || menu.dir) return;
    let live = true;
    void invoke<Record<string, unknown>>("get_settings").then((s) => live && setFileApps(fileTargetsOf(s)), () => live && setFileApps(fileTargetsOf(null)));
    return () => {
      live = false;
    };
  }, [menu?.path, menu?.dir]);
  const runMenu = (id: AnyMenuId, path: string, dir: boolean) => {
    setMenu(null);
    const folder = dir ? path : parentOf(path);
    switch (id) {
      case "view":
      case "follow":
        return openRow(id, path, onOpen);
      case "collapse":
        return fold(path);
      case "copyFile":
        return void invoke("clip_copy_files", { paths: [path] }).then(() => setNote({ text: `${baseName(path)} copied; paste it in another program` }), (err) => setNote({ text: `${baseName(path)} could not be copied as a file: ${String(err)}`, bad: true }));
      case "newFile":
      case "newFolder":
        return startNew(id === "newFolder", path);
      case "rename":
        return setRenaming(path);
      case "delete":
        return setAsking(tops(sel.has(path) ? [...sel] : [path]));
      case "copyPath":
        return void copy(path);
      case "copyRelative":
        return void copy(relative(path));
      case "findInFolder":
        setSearching(true);
        setScope({ glob: folderGlob(root, path), at: Date.now() });
        return startSearch();
      case "openTerminal":
        return onOpenTerminal?.(folder);
      case "addProject":
        return projectDrop.add?.([path]);
    }
  };

  const first = Math.max(0, Math.floor(scroll / ROW) - SPARE);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + SPARE);
  const name = baseName(root.replace(/[\\/]+$/, "")) || root;
  const wsl = asking?.some(isWsl);
  const { box: openMenu, remember: rememberOpener } = useMenuKeys(!!openTargets, () => setOpenTargets(null));
  return (
    <aside className="explorer" hidden={hidden} aria-label="Explorer">
      <header className="explorer-head">
        <span className="title">{searching ? "Search" : "Explorer"}</span>
        <span className="path" title={root}>
          {name}
        </span>
        <button className={`ib${searching ? " on" : ""}`} onClick={() => (searching ? closeSearch() : (setSearching(true), startSearch()))} aria-pressed={searching} title="Search file contents (Ctrl+Shift+F)" aria-label="Search file contents">
          <Search size={12} />
        </button>
        <button className="ib" onClick={(e) => { rememberOpener(e.currentTarget); const r = e.currentTarget.getBoundingClientRect(); if (openTargets) setOpenTargets(null); else void loadTargets().then((list) => setOpenTargets({ list, x: r.left, y: r.bottom + 4 })); }} aria-expanded={!!openTargets} aria-haspopup="menu" title="Open this folder in another app" aria-label="Open in">
          <Rocket size={12} />
        </button>
        <button className="ib" onClick={refresh} disabled={refreshing} aria-busy={refreshing} title="Refresh the tree" aria-label="Refresh the tree">
          <Refresh size={12} className={refreshing ? "spin" : undefined} />
        </button>
        <button className="ib" onClick={() => void expandAll()} disabled={expanding} aria-busy={expanding} title="Expand all folders" aria-label="Expand all folders">
          <span className="ex-stack" style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 0 }}>
            <ChevronDown size={9} style={{ marginBottom: -4 }} />
            <ChevronDown size={9} />
          </span>
        </button>
        <button className="ib" onClick={() => setOpen(new Set())} title="Collapse all folders" aria-label="Collapse all folders">
          <span className="ex-stack" style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 0 }}>
            <ChevronDown size={9} style={{ transform: "rotate(180deg)", marginBottom: -4 }} />
            <ChevronDown size={9} style={{ transform: "rotate(180deg)" }} />
          </span>
        </button>
        <button className={`ib${noDots ? " on" : ""}`} onClick={flipDots} aria-pressed={noDots} title={noDots ? "Dotfiles are hidden; click to show them" : "Hide dotfiles"} aria-label="Hide dotfiles">
          <EyeOff size={12} />
        </button>
        <button className={`ib${noIgnored ? " on" : ""}`} onClick={flipIgnored} aria-pressed={noIgnored} title={noIgnored ? "Git-ignored files are hidden; click to show them" : "Hide git-ignored files"} aria-label="Hide git-ignored files">
          <Funnel size={12} />
        </button>
        <button className="ib" onClick={() => startNew(false)} title="New file" aria-label="New file">
          <Plus size={12} />
        </button>
        <button className="ib" onClick={() => startNew(true)} title="New folder" aria-label="New folder">
          <FolderPlus size={12} />
        </button>
        <button className="ib" onClick={onClose} title="Hide the explorer (Ctrl+Shift+E)" aria-label="Hide the explorer">
          <Close size={12} />
        </button>
      </header>
      {openTargets && (
        <>
        <div className="menu-backdrop" onClick={() => setOpenTargets(null)} onContextMenu={(e) => (e.preventDefault(), setOpenTargets(null))} />
        <div ref={openMenu} className="menu open-in-menu" role="menu" aria-label="Open in" style={clampMenu(openTargets.x, openTargets.y, 240, 40 + openTargets.list.length * 28, window.innerWidth, window.innerHeight)}>
          {openTargets.list.map((t) => (
            <button key={t.label} role="menuitem" className="menu-item" onClick={() => (setOpenTargets(null), setOpenErr(null), void openIn(root, t).catch((err) => setOpenErr(`${t.label} did not open: ${err}`)))}>
              {t.label}
            </button>
          ))}
        </div>
        </>
      )}
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
          <div className="menu row-menu" role="menu" aria-label={`Actions for ${baseName(menu.path)}`} style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 340) }} onKeyDown={(e) => e.key === "Escape" && setMenu(null)}>
            {withExtraMenu(rowMenu({ isDir: menu.dir, hasTerminal: !!onOpenTerminal, canProject: menu.dir && menu.path !== root && projectDrop.add !== null }), { isDir: menu.dir, isOpen: open.has(menu.path), single: sel.size <= 1, log: isLog(menu.path) }).map((id) => (
              <button key={id} role="menuitem" className="menu-item" autoFocus={id === withExtraMenu(rowMenu({ isDir: menu.dir, hasTerminal: !!onOpenTerminal, canProject: false }), { isDir: menu.dir, isOpen: open.has(menu.path), single: sel.size <= 1, log: isLog(menu.path) })[0]} onClick={() => runMenu(id, menu.path, menu.dir)}>
                {menuLabel(id)}
              </button>
            ))}
            {!menu.dir &&
              fileApps.map((a) => (
                <button key={"open-in:" + a.label} role="menuitem" className="menu-item" data-row-action="open-in" onClick={() => (setMenu(null), setOpenErr(null), void openFileIn(root, menu.path, a).catch((err) => setOpenErr(`${a.label} did not open: ${err instanceof Error ? err.message : err}`)))}>
                  Open in {a.label}
                </button>
              ))}
          </div>
        </>
      )}
      {openErr && (
        <div className="notice load-failed" role="alert">
          {openErr}
          <button className="btn" onClick={() => setOpenErr(null)}>
            Dismiss
          </button>
        </div>
      )}
      {failed[root] && (
        <div className="notice load-failed" role="alert">
          The folder did not load: {failed[root]}
          <button className="btn" onClick={() => void load(root)}>
            Retry
          </button>
        </div>
      )}
      {asking && (
        <div className="notice ex-ask" role="alertdialog" aria-label="Delete" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setAsking(null), back())}>
          <span>
            {wsl ? "Delete" : "Move"} {asking.length === 1 ? baseName(asking[0]) : `${asking.length} items`} {wsl ? "for good? A WSL share has no trash." : "to the trash?"}
          </span>
          <button className="btn" autoFocus onClick={() => doDelete(asking)}>
            {wsl ? "Delete" : "Move to trash"}
          </button>
          <button className="btn" onClick={() => (setAsking(null), back())}>
            Cancel
          </button>
        </div>
      )}
      {note && (
        <div className={`notice${note.bad ? "" : " ex-note"}`} role={note.bad ? "alert" : "status"}>
          <span>{note.text}</span>
          <button className="ib" onClick={() => setNote(null)} aria-label="Dismiss">
            <Close size={10} />
          </button>
        </div>
      )}
      {!searching && (
        <div className="ex-filter">
          <input className="field" aria-label="Filter files by name" placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
          {query && (
            <button className="ib" onClick={() => setQuery("")} title="Clear the filter" aria-label="Clear the filter">
              <Close size={10} />
            </button>
          )}
        </div>
      )}
      <ContentSearch root={root} hidden={!searching} focusAsk={searchAsk} seed={seed} scope={scope} onOpen={onOpen} onClose={closeSearch} />
      <div
        hidden={searching}
        className={`explorer-rows${dropAt === root ? " drop" : ""}`}
        ref={box}
        tabIndex={0}
        role="tree"
        aria-label={`Files of ${name}`}
        aria-multiselectable
        aria-activedescendant={index >= 0 ? `ex-row-${index}` : undefined}
        onKeyDown={onKey}
        onFocus={() => index < 0 && rows.length && setAt(rows[0].node.path)}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        {kids[root] && !rows.length && <div className="menu-hint">{query.trim() ? "No file name matches the filter." : "This folder is empty."}</div>}
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((r, k) => {
            const i = first + k;
            const dir = r.node.kind !== "file" && !(r.node.kind === "link" && real[r.node.path] && !isDir(r.node));
            const isOpen = open.has(r.node.path);
            const editing = r.node.path === DRAFT || r.node.path === renaming;
            return (
              <div
                key={r.node.path}
                id={`ex-row-${i}`}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={dir ? isOpen : undefined}
                aria-selected={sel.has(r.node.path)}
                className={`ex-row${sel.has(r.node.path) ? " sel" : ""}${i === index ? " at" : ""}${dropAt === r.node.path ? " drop" : ""}`}
                style={{ top: i * ROW, paddingLeft: 8 + r.depth * 12 }}
                onMouseDown={(e) => editing || e.preventDefault()}
                onPointerDown={(e) => startDrag(e, r.node.path)}
                onClick={(e) => onRow(e, i)}
                onContextMenu={(e) => rowContext(e, r.node.path, dir)}
                title={editing ? undefined : r.node.path}
              >
                <span className="ex-twist">{dir ? <ChevronDown size={10} style={isOpen ? undefined : { transform: "rotate(-90deg)" }} /> : <FileIcon name={r.node.name} size={11} />}</span>
                {editing ? (
                  <NameField
                    initial={r.node.name}
                    label={r.node.path === DRAFT ? (r.node.kind === "dir" ? "New folder name" : "New file name") : `New name for ${r.node.name}`}
                    onDone={(v) => (v === null ? (setDraft(null), setRenaming(null), back()) : r.node.path === DRAFT ? commitNew(v) : commitRename(r.node.path, v))}
                  />
                ) : (
                  <span className="ex-name">{r.node.name}</span>
                )}
                {r.node.kind === "link" && <span className="ex-link">link</span>}
                {failed[r.node.path] && (
                  <span className="ex-link" title={failed[r.node.path]}>
                    not readable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** The in-place name field: Enter or leaving it commits, Escape cancels (null). */
function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const finish = (v: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(v);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length); // the name without its extension
  }, []);
  return (
    <input
      ref={ref}
      className="ex-input"
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
