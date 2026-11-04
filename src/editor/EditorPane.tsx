// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays. A save is refused when the file changed on disk since it was loaded (EDIT-003,
// T-073-a): the pane then asks Reload (take the disk copy) or Keep mine (overwrite it). Before any
// save, a cheap check (diskChange.ts, every 2 s for a tab in front and on window focus) notices
// that the file moved on (T-073): a tab without edits takes the disk copy quietly, one with edits
// shows the banner (DiskBanner.tsx: Reload, undoable / Keep my edits / Compare). The check is
// advisory; the save's hash check stays the guard. A markdown file opens in a rich view (EDIT-012, markdown.ts) with a Rich |
// Source switch; the source view is the CodeMirror one, which keeps holding the text throughout.
// EDIT-007: Copy Context copies the selection under its path and line range, with a hint beside a
// selection it applies to; EDIT-020: review notes take a selection from any file, not just Markdown.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { currentDark } from "../theme";
import { languageFor } from "./languages";
import { codeHighlighting, editorMode } from "./syntax";
import { ChevronDown, Close, List } from "../chrome/icons";
import FileIcon from "./FileIcon";
import CsvTable from "./CsvTable";
import NotebookView from "./NotebookView";
import SvgView from "./SvgView";
import { insertError, insertPastedPicture, pastedPicture } from "./pictureBytes";
import { applyImage } from "./richFormat";
import ImageView from "./ImageView";
import PdfView from "./PdfView";
import { isPdf } from "./pdfFiles";
import { isPicture, isSvg } from "./imageFiles";
import { isNotebook } from "./notebook";
import { isTable } from "./csv";
import { useSettings } from "../settings/useSettings";
import { prefPatch, readEditorPrefs } from "../settings/editorPrefs";
import { undo } from "@codemirror/commands";
import { clampView, keepView, takeView } from "../terminal/viewKeep";
import { attach, baseName, detach, diskOf, docText, fileTextOf, hashOf, isDirty, isStale, lineEndsFor, loadText, opening, relay, replaceAll, save, subscribe, textOf, withLineBreaks } from "./editors";
import { keepUnsaved, keptToast } from "./unsavedCopy";
import NamePrompt from "./NamePrompt";
import { announceMoves } from "./fileMoved";
import { isUntitled, needsName } from "./untitled";
import { seedSources, seedText } from "./searchSeed";
import { followTick, type FollowIo } from "./logFollow";
import { offersPreview, previewHtml } from "./htmlPreview";
import DiffPane from "./DiffPane"; // EDIT-056: the Changes view (DiffPane imports this file back; both only use each other when rendering)
import { drawn, underRoot, VIEW_LABEL, viewsFor, type View } from "./viewSwitch";
import { createAutosave, covers, movingNow, prefsReader, type Autosave } from "./autosave";
import { drafts, restoreFrom, worktreeOf } from "./drafts";
import { confirmed } from "./fileMoved";
import { richBlocker, richBlockerSince, richChange, splitFront } from "./frontMatter";
import { bannerUp, beginSave, canUndo, checkOnce, endSave, forget, holdRestored, keep, POLL_MS, readFresh, reloadNow, remember, setBanner as markBanner, UNDO_TOAST_MS, type Io, type Stamp, type UndoEntry } from "./diskChange";
import { CompareView, DiskBanner, GoneNotice, UndoToast } from "./DiskBanner";
import { isMarkdown, mountRich } from "./markdown";
import { minimap } from "./minimap";
import { SlashMenu, TableMenu, WikiMenu } from "./SlashPanel";
import TableControls from "./TableControls";
import CodeLabel from "./CodeLabel";
import DrawPanel from "./DrawPanel";
import LinkHover from "./LinkHover";
import { sourceLinks } from "./sourceLinks";
import type { SlashView } from "./slashMenu";
import type { WikiView } from "./wikiPopup";
import { domPick, noteDraft, selections, type Note } from "./notes";
import { contextText, richContext } from "./copyContext";
import NoteRail from "./NoteRail";
import RichToolbar from "./RichToolbar";
import { railNotes } from "./rail";
import { shortPath } from "./diffNotes";
import { findSupport, openFind } from "./find";
import { conflictColours, conflictField, goConflict } from "./conflicts";
import { useKeymap, useLabel } from "../keys/KeymapContext";
import { withChord } from "../terminal/PaneMenu";
import { labelOf, matchEvent } from "../keys/keymap";
import { Contents, FindBar, selectedIn, type FindOpen } from "./NoteTools";
import { replaceInRich } from "./notefind";
import { outline } from "./toc";
import { mdPrefs, setMdPrefs } from "../shell/mdPrefs";
import { FrontMatterBlock, TocResizer } from "../shell/MdViewControls";
import { frontControl, tocVar } from "../shell/mdView";
import { followClick, openHref, type LinkHandler } from "./linkClicks";
import { hasSpot, jumpSpot, onReveal, revealAt, spotRange, takeSpot } from "./search";
import "./editor-extras.css";
import { pasteGuard } from "./paste";

// Cycle 3 (first load): the two latches the window's Mod+S and Copy Context call live in keys/handles.ts
// now, so the shortcut router holds them without loading this pane; filled here while a tab is open.
import { copiers, editors } from "../keys/handles";
export { copiers, editors };

/** EDIT-003 (T-073-a, T-073-c): Mod+S for an editor tab or an unstaged diff tab. The write carries
 *  the hash of the disk copy the tab loaded; a refusal because the file moved on calls
 *  `onStale(true)` (the pane shows StaleNotice), any other failure is a toast. */
/** T-073: the disk stamp of one file, null when it is gone or the check failed. */
export const stampOne = (path: string): Promise<Stamp | null> =>
  invoke<(Stamp | null)[]>("file_stamps", { paths: [path] }).then(
    (r) => r?.[0] ?? null,
    () => null,
  );

/** Writes the buffer and remembers the stamp the write answered with, so Kolux's own save never
 *  looks like someone else's change (EDIT-003). */
async function writeRemembering(path: string, force: boolean): Promise<void> {
  let wrote: Stamp | null | undefined;
  // T-073-e (council A1): while the write is out the disk check treats this file as unchanged, so
  // a poll landing between the write and remember() cannot flash the banner on the user's own save.
  beginSave(path);
  try {
    await save(path, async (text, loadedHash) => void (wrote = await invoke<Stamp | null>("file_write", force ? { path, text } : { path, text, loadedHash })), force);
    remember(path, wrote ?? (await stampOne(path)));
  } finally {
    endSave(path);
  }
}

export async function saveFile(path: string, onStale: (stale: boolean) => void, onToast?: (text: string) => void): Promise<void> {
  try {
    await writeRemembering(path, false);
    onStale(false);
  } catch (err) {
    if (isStale(err)) return onStale(true);
    onToast?.(`${baseName(path)} was not saved: ${String(err)}`);
  }
}

/** EDIT-031 (T-236-b): saves in place for the close prompt; true only when the file was written. A refusal is a toast, so the
 *  tab stays open with its text. */
export async function saveQuiet(path: string, onToast?: (text: string) => void): Promise<boolean> {
  try {
    await writeRemembering(path, false);
    return true;
  } catch (err) {
    onToast?.(isStale(err) ? `${baseName(path)} changed on disk since you opened it, so it was not saved.` : `${baseName(path)} was not saved: ${String(err)}`);
    return false;
  }
}

/** The choice after a stale refusal: Reload takes the disk copy, Keep mine writes over it. */
export function StaleNotice({ path, onDone, onToast }: { path: string; onDone: () => void; onToast?: (text: string) => void }) {
  const name = baseName(path);
  return (
    <div className="notice save-stale" role="alert">
      {name} changed on disk since you opened it, so it was not saved.
      <button
        className="btn"
        title="Show the disk copy; your unsaved edits are dropped"
        onClick={() =>
          void readFresh(
            path,
            () => stampOne(path),
            () => invoke<string>("file_read", { path }),
          ).then(
            (got) => {
              if (!got) return;
              replaceAll(path, got.text, true);
              remember(path, got.stamp);
              onDone();
            },
            (err) => onToast?.(name + " did not reload: " + String(err)),
          )
        }
      >
        Reload
      </button>
      <button
        className="btn"
        title="Save your text over the disk copy"
        onClick={() =>
          void writeRemembering(path, true).then(
            () => onDone(),
            (err) => onToast?.(name + " was not saved: " + String(err)),
          )
        }
      >
        Keep mine
      </button>
    </div>
  );
}

const lang = new Compartment();
const minimapping = new Compartment(); // T-316-b: the minimap beside the text, off unless Settings > General turns it on
const wrapping = new Compartment(); // EDIT-006: word wrap, on unless the setting or Alt+Z turned it off
export const look = EditorView.theme(
  {
    "&": { height: "100%", background: "var(--pane-bg)", color: "var(--fg)", fontSize: "13px" },
    // TERM-097 / SET-018: the editor font, which is the terminal font unless set on its own.
    ".cm-scroller": { fontFamily: "var(--editor-font, var(--mono-font))", lineHeight: "1.5" },
    ".cm-gutters": { background: "var(--pane-bg)", color: "var(--fg-faint)", border: "none" },
    // See-through, so the selection drawn under the text still shows on the caret's line.
    ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--row-selected) 45%, transparent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--line-focus) 90%, transparent) !important" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--fg)" },
  },
);

/** `readOnly`: typing changes nothing (SKILL-012 previews a kit result this way). */
type Props = { id: number; path: string; root?: string | null; readOnly?: boolean; /** EDIT-026: a log tab that keeps adding lines as the file grows (give it readOnly too). */ follow?: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; jump?: { line: number; at: number; col?: number }; onLink?: LinkHandler; /** EDIT-020: the Markdown review notes, shown in a rail beside the rich view. */ notes?: Note[]; onRemoveNote?: (n: Note) => void; /** A rail card edited in place: the note and its new text. */ onEditNote?: (n: Note, text: string) => void };

function TextEditorPane({ id, path, root = null, readOnly = false, follow = false, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, jump, onLink, notes = [], onRemoveNote, onEditNote }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [naming, setNaming] = useState(false); // EDIT-054: the first save of an untitled note is asking for its name
  const [stale, setStale] = useState(false); // the last save was refused: the disk copy moved on
  // T-073: the disk copy changed under unsaved edits (with the stamp Keep my edits keeps), the
  // Compare view, and the Undo toast after a Reload.
  const [moved, setMoved] = useState<{ stamp: Stamp | null } | null>(null);
  const [gone, setGone] = useState(false); // EDIT-032: the file was deleted or moved away while this tab is open
  const [comparing, setComparing] = useState(false);
  const [undoable, setUndoable] = useState<UndoEntry | null>(null);
  const report = useRef({ onDirty, onToast, onLink });
  report.current = { onDirty, onToast, onLink };
  // EDIT-002: autosave reads the settings afresh at an edit (at most every 5 s), so switching it on
  // in Settings reaches tabs that are already open.
  const autoRef = useRef<Autosave | null>(null);
  const prefs = useRef(prefsReader(() => invoke<Record<string, unknown>>("get_settings"))).current;
  const wantFocus = useRef(focused);
  wantFocus.current = focused;
  const md = isMarkdown(path);
  const grid = isTable(path) || isNotebook(path) || isSvg(path); // EDIT-023: a CSV or TSV file opens as a table, a notebook (EDIT-024) as cells, an SVG file (EDIT-029) as its picture, with Source beside it
  const [table, setTable] = useState(grid);
  const [changesOn, setChangesOn] = useState(false); // EDIT-056: the Changes view (last commit beside the working file)
  const tableOn = grid && table;
  // EDIT-006: wrapping is on by default; the saved setting decides once it has loaded, Alt+Z flips it.
  const { settings, save: saveSetting } = useSettings();
  const [wrap, setWrap] = useState(true);
  const [mini, setMini] = useState(false);
  const miniOn = useRef(false);
  miniOn.current = mini;
  const [spell, setSpell] = useState(true); // SET-038: Settings > General > spelling underlines in notes
  const wrapOn = useRef(true);
  wrapOn.current = wrap;
  useEffect(() => {
    if (settings) {
      const p = readEditorPrefs(settings);
      setWrap(p.wordWrap);
      setSpell(p.spellcheck);
      setMini(p.minimap);
    }
  }, [settings === null]);
  const richHost = useRef<HTMLDivElement>(null);
  const rich = useRef<ReturnType<typeof mountRich> | null>(null);
  const [slashView, setSlashView] = useState<SlashView | null>(null);
  const [wikiView, setWikiView] = useState<WikiView | null>(null);
  const wikiAsked = useRef(false); // the worktree file list is asked for once, by the rich view or by source-view note links
  const wikiFiles = useRef<string[]>([]); // the worktree's files for the [[ popup, listed once per open note
  const [richEditor, setRichEditor] = useState<ReturnType<typeof mountRich>["editor"] | null>(null);
  const [ready, setReady] = useState(0); // counts loads, so the rich view starts after each one
  useEffect(() => view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) }), [wrap, ready]);
  useEffect(() => view.current?.dispatch({ effects: minimapping.reconfigure(mini ? minimap() : []) }), [mini, ready]);
  const [mode, setMode] = useState<"rich" | "source">(md ? "rich" : "source");
  const [banner, setBanner] = useState<{ text: string; big?: boolean } | null>(null);
  const [bigOk, setBigOk] = useState(false); // Open anyway, for this tab and this file only
  const [richError, setRichError] = useState<string | null>(null);
  const [richTries, setRichTries] = useState(0);
  // EDIT-007: the hint beside a selection Copy Context applies to, gone once that selection is copied.
  const copyKey = useLabel("editor.copyContext").join("+");
  const [hint, setHint] = useState<{ x: number; y: number; sel: string } | null>(null);
  const [copiedSel, setCopiedSel] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ x: number; y: number } | null>(null);
  const place = useRef((_v: EditorView) => {});
  place.current = (v) => {
    const { from, to } = v.state.selection.main;
    const c = from !== to && v.hasFocus ? v.coordsAtPos(to) : null;
    setHint(c && contextText(v.state.doc, from, to, "").header ? { x: c.right, y: c.bottom, sel: `${from}-${to}` } : null);
  };
  const [conflicts, setConflicts] = useState(0);
  const conflictsRef = useRef(0);
  conflictsRef.current = conflicts;
  // EDIT-016 / EDIT-017: the rich view's find bar and contents panel, and the note text they read
  // (taken from the buffer a moment after typing stops).
  const [noteFind, setNoteFind] = useState<FindOpen | null>(null);
  // VIEW-113: the contents panel stays open or shut for this file.
  const [toc, setToc] = useState(() => mdPrefs(path).toc);
  useEffect(() => void setMdPrefs(path, { toc }), [path, toc]);
  // VIEW-113: front matter shown or hidden, and the contents panel width, also stay per file.
  const [hideFront, setHideFront] = useState(() => mdPrefs(path).hideFront);
  const [tocWidth, setTocWidth] = useState(() => mdPrefs(path).tocWidth);
  useEffect(() => void setMdPrefs(path, { hideFront, tocWidth }), [path, hideFront, tocWidth]);
  const [noteText, setNoteText] = useState("");
  const noteTimer = useRef(0);

  useEffect(() => {
    let alive = true;
    let made: EditorView | null = null;
    // EDIT-002: autosave; EDIT-032: it stands down while the file is being moved.
    const auto = createAutosave({
      prefs: prefs.get,
      covered: () => covers({ readOnly, conflict: conflictsRef.current > 0 }) && !needsName(path, root, diskOf(path)), // an untitled note waits for its name
      dirty: () => isDirty(path),
      held: () => bannerUp(path) || movingNow(path),
      write: () => saveFile(path, setStale, report.current.onToast),
    });
    autoRef.current = auto;
    const wt = worktreeOf(root, path);
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
      // EDIT-004: the unsaved text is kept as a draft; a clean tab clears it.
      drafts.edited(wt, path, readOnly);
      if (d && !readOnly) void prefs.refresh().then(() => alive && auto.edit());
    });
    setError(null);
    setStale(false);
    setMoved(null);
    setGone(false);
    setComparing(false);
    let loaded: Stamp | null = null;
    // T-073: the stamp is taken before the text, so a write landing in between shows at the next check.
    stampOne(path)
      .then((st) => ((loaded = st), loadText(() => invoke<string>("file_read", { path }))))
      .then(async (text) => {
        // EDIT-032 carries unsaved text to a moved file's new path; EDIT-004 brings a draft back.
        // Row 131: carried text typed over a copy that is no longer on disk is kept beside the
        // file, never saved over it; if that copy cannot be written the tab keeps the text and
        // its saves are checked against the old copy, so they ask first.
        let o = opening(path, text);
        if (o.keep !== undefined) {
          const kept = await keepUnsaved(path, o.keep).catch((e) => (report.current.onToast?.(keptToast(baseName(path), null, e)), null));
          if (kept) {
            report.current.onToast?.(keptToast(baseName(path), kept));
            o = { text, base: text };
          }
        }
        const carried = o.text !== text || o.base !== text;
        const draft = readOnly || carried ? null : await drafts.take(wt, path).catch(() => null);
        const r = carried ? { text: o.text, moved: false, stale: false } : restoreFrom(text, await hashOf(text), draft);
        if (r.stale) void drafts.discard(wt, path);
        return { text, shown: r.text, base: o.base, draftMoved: r.moved };
      })
      .then(
      ({ text, shown, base, draftMoved }) => {
        if (!alive) return;
        made = new EditorView({
          doc: docText(shown),
          parent: host.current!,
          // T-603 (DT-C57): a file with one kind of line end is saved with it; a mixed file draws every line and keeps each ending.
          extensions: [lineEndsFor(text), EditorState.readOnly.of(readOnly), basicSetup, look, codeHighlighting, editorMode(currentDark()), lang.of([]), wrapping.of(wrapOn.current ? EditorView.lineWrapping : []), minimapping.of(miniOn.current ? minimap() : []), findSupport, conflictColours, isMarkdown(path) ? sourceLinks(() => ({ note: path, root, files: () => { if (!wikiAsked.current && root) { wikiAsked.current = true; void invoke<{ files: string[] }>("file_list", { root }).then((l) => void (wikiFiles.current = l.files), () => undefined); } return wikiFiles.current; }, onLink: (a, shift) => report.current.onLink?.(a, shift), onToast: (t) => report.current.onToast?.(t) })) : [], pasteGuard((t) => report.current.onToast?.(t)), EditorView.updateListener.of((u) => {
            u.transactions.forEach((tr) => relay(path, u.view, tr));
            if (u.docChanged) setConflicts(u.state.field(conflictField).list.length);
            if (u.docChanged && isMarkdown(path)) {
              clearTimeout(noteTimer.current);
              noteTimer.current = window.setTimeout(() => setNoteText(u.state.doc.toString()), 300);
            }
          }), EditorView.updateListener.of((u) => (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) && place.current(u.view)), EditorView.domEventHandlers({ scroll: (_e, v) => void place.current(v) })],
        });
        view.current = made;
        // T-102-b: a pane rebuilt by a move to another cell comes back with its caret, selection and scroll.
        const kept = takeView(id);
        if (kept) {
          const v = clampView(kept, made.state.doc.length);
          made.dispatch({ selection: { anchor: v.anchor, head: v.head } });
          requestAnimationFrame(() => {
            made?.scrollDOM.scrollTo(v.scrollLeft, v.scrollTop);
          });
        }
        attach(path, made, base);
        // A twin pane already holds this file: its stamp stays the one its copy came from.
        if (fileTextOf(path) === text) remember(path, loaded);
        setNoteText(shown);
        // EDIT-004: a draft over a disk copy that moved on comes back with the banner up.
        if (draftMoved) {
          holdRestored(path); // T-073-d: the hold is up before autosave.resume() below can fire
          setMoved({ stamp: loaded });
        }
        // EDIT-032: the file is read at its new place; autosave may write again.
        confirmed(path);
        if (shown !== text) auto.resume();
        setReady((n) => n + 1);
        // EDIT-009: a file still holding conflicts opens on the first one.
        setConflicts(made.state.field(conflictField).list.length);
        goConflict(made, 0);
        // A newly opened file takes the keyboard at once.
        if (wantFocus.current) made.focus();
        languageFor(baseName(path))
          ?.load()
          .then((support) => alive && made?.dispatch({ effects: lang.reconfigure(support) }))
          .catch(() => undefined);
      },
      (err) => alive && setError(String(err)),
    );
    editors.set(id, () => (needsName(path, root, diskOf(path)) ? (setNaming(true), Promise.resolve()) : saveFile(path, setStale, report.current.onToast)));
    return () => {
      alive = false;
      auto.cancel();
      autoRef.current = null;
      clearTimeout(noteTimer.current);
      editors.delete(id);
      off();
      if (made) {
        const sel = made.state.selection.main;
        keepView(id, { anchor: sel.anchor, head: sel.head, scrollTop: made.scrollDOM.scrollTop, scrollLeft: made.scrollDOM.scrollLeft });
        detach(path, made);
        made.destroy();
      }
      if (textOf(path) === null) forget(path);
      view.current = null;
    };
  }, [id, path, tries]);

  // EDIT-003 (T-073): the disk check, only while this tab is in front: at once when it comes
  // forward (a background tab whose file changed reloads then, not while hidden), every POLL_MS
  // and whenever the window gets focus.
  const io = useRef<Io>(null!);
  io.current = {
    stamp: () =>
      stampOne(path).then((s) => {
        // EDIT-032: a file that is gone is said so (a failed look at a file that is still there is not).
        if (s) setGone(false);
        else void invoke<string>("path_kind", { path }).then((k) => setGone(k === "missing"), () => undefined);
        return s;
      }),
    read: () => invoke<string>("file_read", { path }),
    dirty: () => isDirty(path),
    current: () => fileTextOf(path),
    apply: (text, undoable) => replaceAll(path, text, undoable),
  };
  useEffect(() => {
    if (hidden || !ready || readOnly) return;
    let busy = false;
    let alive = true;
    const raised = (stamp: Stamp | null) => alive && setMoved((m) => (m && m.stamp?.mtime === stamp?.mtime && m.stamp?.size === stamp?.size ? m : { stamp }));
    const check = () => {
      if (busy) return;
      busy = true;
      void checkOnce(path, io.current, raised)
        .then(
          (v) => alive && v !== "banner" && setMoved(null),
          () => undefined,
        )
        .finally(() => (busy = false));
    };
    check();
    // ponytail: each poll's file_stamps runs fence.allow, which lists worktrees about every 4 s
    // (TREES_FRESH 3 s) under the fence mutex while an agent-worktree file is open (council MERGE 33
    // A3, folded into the MERGE 29 A1 fence fast path by origin record); the upgrade is that fast
    // path, or a fence decision cached per open tab, not a slower poll.
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [path, hidden, ready, readOnly]);
  useEffect(() => {
    if (!undoable) return;
    const t = window.setTimeout(() => setUndoable(null), UNDO_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [undoable]);
  useEffect(() => {
    markBanner(path, !!moved);
    if (!moved) autoRef.current?.resume(); // EDIT-002: the banner went (Reload, Keep my edits)
  }, [path, moved]);
  const reload = () =>
    void reloadNow(path, io.current).then(
      (u) => {
        if (!u) return;
        setMoved(null);
        setComparing(false);
        setUndoable(u);
      },
      (err) => report.current.onToast?.(`${baseName(path)} did not reload: ${String(err)}`),
    );
  const keepMine = () => {
    keep(path, moved?.stamp ?? null);
    setMoved(null);
    setComparing(false);
  };
  const undoReload = () => {
    const cm = view.current;
    if (cm && canUndo(undoable, textOf(path))) undo(cm);
    else report.current.onToast?.("The reload can no longer be undone from the toast; Ctrl+Z in the tab still steps back through it.");
    setUndoable(null);
  };
  const readDisk = useCallback(() => invoke<string>("file_read", { path }), [path]);

  // A new file in this tab starts over: rich again, and Open anyway forgotten.
  useEffect(() => {
    setMode(isMarkdown(path) ? "rich" : "source");
    setTable(isTable(path) || isSvg(path));
    setChangesOn(false);
    setBigOk(false);
    setBanner(null);
  }, [path]);

  // EDIT-037: a search hit opens here with the hit selected and in view. A note in the rich view
  // shows its source for that, since the hit's line and column are the file's.
  const [reveals, setReveals] = useState(0);
  useEffect(() => onReveal(() => setReveals((n) => n + 1)), []);
  // T-222-c (TERM-093): a printed path:line opens the file at that line, the way a search hit does.
  useEffect(() => {
    // T-329-b: a chat link's column puts the cursor there; without one it is the line's start.
    if (jump) revealAt(path, jump.col ? { ...jumpSpot(jump.line), col: jump.col } : jumpSpot(jump.line));
  }, [jump?.at]);
  useEffect(() => {
    const cm = view.current;
    if (!cm || !hasSpot(path)) return;
    if (changesOn) return setChangesOn(false);
    if (md && mode !== "source") return setMode("source");
    if (tableOn) return setTable(false);
    const s = takeSpot(path)!;
    const r = spotRange(cm.state.doc, s);
    cm.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: "center" }) });
    cm.focus();
  }, [reveals, ready, mode, path, md, tableOn, changesOn]);

  // EDIT-012: the rich view, started over the source text whenever the tab switches to it.
  useEffect(() => {
    const cm = view.current;
    if (!md || mode !== "rich" || !ready || !cm || !richHost.current) return;
    setRichError(null);
    const text = cm.state.doc.toString();
    const fallBack = (b: { text: string; big?: boolean }) => {
      setBanner(b);
      setMode("source");
    };
    // EDIT-019: front matter stays out of the rich view's text and is never touched by it.
    const blocked = richBlocker(text, bigOk);
    if (blocked) return fallBack(blocked);
    let pushed = text;
    try {
      rich.current = mountRich(richHost.current, splitFront(text).body, (out, prev) => {
        const now = cm.state.doc.toString();
        // An edit that cannot be placed for sure is not written; the note shows as source so the view and the file cannot drift.
        const change = richChange(now, out, prev, () => fallBack({ text: "Showing source: the rich view could not place your last edit in the note, so it was not applied. The file is unchanged." }));
        if (change) {
          pushed = now.slice(0, change.from) + change.insert + now.slice(change.to);
          cm.dispatch({ changes: withLineBreaks(cm.state, change), userEvent: "input" });
        }
      }, (t) => report.current.onToast?.(t), setSlashView, { files: () => wikiFiles.current, notePath: shortPath(path, root), show: setWikiView });
      if (root) {
        wikiAsked.current = true;
        void invoke<{ files: string[] }>("file_list", { root }).then((l) => void (wikiFiles.current = l.files), () => undefined);
      }
      setRichEditor(rich.current.editor);
    } catch (err) {
      setRichError(String(err));
      return;
    }
    setBanner(null);
    const r = rich.current;
    if (wantFocus.current) r.editor.focus();
    // Text changed elsewhere (a twin pane, a reload) is shown afresh.
    const off = subscribe(path, () => {
      const now = cm.state.doc.toString();
      if (now === pushed) return;
      // Same check as the first show, on the blocks that changed since the last show (L1: not the whole note per keystroke).
      const stop = richBlockerSince(pushed, now, bigOk);
      if (stop) return fallBack(stop);
      r.show(splitFront((pushed = now)).body);
    });
    return () => {
      off();
      r.destroy();
      rich.current = null;
      setRichEditor(null);
      setSlashView(null);
      setWikiView(null);
    };
  }, [md, mode, ready, bigOk, richTries, path]);

  useEffect(() => {
    if (!focused || hidden) return;
    if (rich.current) rich.current.editor.focus();
    else view.current?.focus();
  }, [focused, hidden]);

  const name = baseName(path);
  // EDIT-005 / EDIT-009: find and conflict stepping act on the source view (the rich view's
  // find comes with EDIT-017).
  const sourceShown = (!md || mode === "source") && !tableOn && !changesOn;
  // EDIT-056 (T-237-b): one switch for the views the file offers; Changes is only for files in the worktree.
  const offer = viewsFor({ path, untitled: isUntitled(path, root), inWorktree: !readOnly && underRoot(path, root) });
  const views = drawn(offer, grid);
  const current: View = changesOn ? "changes" : tableOn ? "rendered" : md ? (mode === "rich" ? "rich" : "source") : grid ? "source" : "edit";
  const pick = (v: View) => {
    setChangesOn(v === "changes");
    if (v === "rich") {
      setMode("rich");
      if (changesOn) setRichTries((n) => n + 1); // text typed in Changes reaches the rich view
    }
    if (v === "source") {
      setMode("source");
      setBanner(null);
      setTable(false);
    }
    if (v === "rendered") setTable(true);
  };
  const keymap = useKeymap();
  const stepConflicts = (dir: 1 | -1) => {
    const cm = view.current;
    if (cm && goConflict(cm, dir)) cm.focus();
  };
  // The user's own chords for editor.find / editor.replace (a rebinding is the one that works;
  // CodeMirror's built-in Mod+F is off) and, with conflicts in the file, editor.nextChange /
  // editor.previousChange. App's router leaves these to the focused editor pane.
  const onKeys = (e: React.KeyboardEvent) => {
    const hit = matchEvent(keymap, e.nativeEvent, ["editor"]);
    const finding = hit?.id === "editor.find" || hit?.id === "editor.replace";
    if (shown === "rich" && finding) {
      // EDIT-017: the rich view's own bar, with replace.
      const replace = hit.id === "editor.replace" && !readOnly;
      if (!e.repeat) setNoteFind((f) => ({ replace, seed: selectedIn(richHost.current), n: (f?.n ?? 0) + 1 }));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (hit?.id === "editor.toggleWordWrap" && sourceShown) {
      const next = !wrap;
      setWrap(next);
      void saveSetting(prefPatch("wordWrap", next));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!sourceShown || !view.current) return;
    if (finding) {
      // Holding the chord down does not keep reopening the bar.
      if (!e.repeat) openFind(view.current, hit.id === "editor.replace" && !readOnly);
    } else if ((hit?.id === "editor.nextChange" || hit?.id === "editor.previousChange") && conflicts) stepConflicts(hit.id === "editor.nextChange" ? 1 : -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const shown = changesOn ? "changes" : tableOn ? "table" : !md || mode === "source" ? "source" : richError ? "error" : "rich";
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const richRoot = useCallback(() => richHost.current, []);
  const hasHeadings = useMemo(() => md && outline(noteText).length > 0, [md, noteText]);
  const frontText = useMemo(() => (md ? splitFront(noteText).front : ""), [md, noteText]);
  const frontCtl = frontControl(frontText, hideFront);
  const tocShown = toc && hasHeadings && shown === "rich";
  // GIT-042, EDIT-020: the add-note shortcut reads this tab's selection, in any file.
  useEffect(() => {
    selections.set(id, () => {
      const cm = view.current;
      if (!cm) return null;
      if (shown === "rich") return domPick(richHost.current, path, cm.state.doc.toString());
      const { from, to } = cm.state.selection.main;
      const draft = noteDraft(path, "", cm.state.sliceDoc(from, to), cm.state.doc.lineAt(from).number);
      const at = cm.coordsAtPos(to);
      return draft && { draft, x: at?.left ?? 200, y: at?.bottom ?? 200 };
    });
    return () => void selections.delete(id);
  }, [md, id, path, shown]);
  // EDIT-038: a file search started from here takes the selection, or the word at the caret, as its first query.
  useEffect(() => {
    seedSources.set(id, () => {
      const sel = window.getSelection();
      if (shownRef.current === "rich" && richHost.current && sel && richHost.current.contains(sel.anchorNode)) return seedText(sel.toString(), 0, sel.toString().length);
      const cm = view.current;
      if (!cm) return "";
      const r = cm.state.selection.main;
      return seedText(cm.state.doc.toString(), r.from, r.to);
    });
    return () => void seedSources.delete(id);
  }, [id]);
  useEffect(() => {
    if (focused && !hidden) seedSources.focus(id);
  }, [focused, hidden, id]);

  // EDIT-026: a followed log reads the file once a second while its tab shows, and only when it changed; it waits while
  // another tab of the file holds unsaved edits (T-317, followTick).
  // ponytail: reads the whole file each time it changes; a tail-only read if logs of hundreds of MB matter.
  useEffect(() => {
    if (!follow || !ready || hidden) return;
    let alive = true;
    let last = "";
    let busy = false;
    const io: FollowIo = {
      stamp: async () => JSON.stringify(await invoke("file_stamps", { paths: [path] })),
      read: () => invoke<string>("file_read", { path }),
      dirty: () => isDirty(path),
      shown: () => textOf(path) ?? "",
      show: (next) => {
        if (!alive) return;
        const cm = view.current;
        const d = cm?.scrollDOM;
        const atEnd = !d || next.reset || d.scrollHeight - d.scrollTop - d.clientHeight < 40;
        replaceAll(path, next.text);
        if (cm && atEnd) cm.dispatch({ effects: EditorView.scrollIntoView(cm.state.doc.length) });
      },
    };
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        last = await followTick(last, io);
      } catch {
        // a read that failed is tried again on the next second
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [follow, ready, hidden, path]);
  useEffect(() => {
    copiers.set(id, () => {
      const cm = view.current;
      if (cm && shown === "rich") {
        // EDIT-007 (T-132-b): the rich view copies its selection with the source lines it covers.
        const sel = window.getSelection();
        const got = richHost.current && sel && richHost.current.contains(sel.anchorNode) ? richContext(cm.state.doc.toString(), sel.toString(), shortPath(path, root)) : null;
        if (!got) return false;
        const r = sel!.getRangeAt(0).getBoundingClientRect();
        navigator.clipboard.writeText(got.text).then(
          () => {
            setFlash({ x: r.right, y: r.bottom });
            setTimeout(() => setFlash(null), 1500);
          },
          (err) => report.current.onToast?.(`Nothing was copied: ${String(err)}`),
        );
        return true;
      }
      if (!cm || shown !== "source") return false;
      const { from, to } = cm.state.selection.main;
      const c = cm.coordsAtPos(to);
      navigator.clipboard.writeText(contextText(cm.state.doc, from, to, shortPath(path, root)).text).then(
        () => {
          setCopiedSel(`${from}-${to}`);
          setFlash(c ? { x: c.right, y: c.bottom } : null);
          setTimeout(() => setFlash(null), 1500);
        },
        (err) => report.current.onToast?.(`Nothing was copied: ${String(err)}`),
      );
      return true;
    });
    return () => void copiers.delete(id);
  }, [id, path, root, shown]);
  const railed = useMemo(() => (md ? railNotes(notes, path) : []), [md, notes, path]);
  const railShown = shown === "rich" && railed.length > 0;
  // EDIT-009 (T-234-b): a picture pasted into a note (a screenshot, a copied image, or one picture path) is saved beside the note and linked there.
  const pastePicture = (e: React.ClipboardEvent) => {
    if (!md || readOnly || (shown !== "rich" && shown !== "source")) return;
    const got = pastedPicture(e.clipboardData);
    if (!got) return;
    e.preventDefault();
    e.stopPropagation();
    insertPastedPicture(path, got, invoke).then(
      (link) => {
        const cm = view.current;
        if (shownRef.current === "rich" && richEditor) {
          if (!applyImage(richEditor, link)) onToast?.("Put the caret in the note first, then paste the picture.");
        } else if (cm) cm.dispatch(cm.state.replaceSelection(link));
      },
      (err) => onToast?.(insertError(err)),
    );
  };
  return (
    <section style={tocShown ? (tocVar(tocWidth) as CSSProperties) : undefined} className={`pane editor${focused ? " focused" : ""}${tocShown ? " toc-open" : ""}${railShown ? " rail-open" : ""}`} hidden={hidden} aria-label={`${name} pane`} onMouseDown={onFocus} onKeyDownCapture={onKeys} onPasteCapture={pastePicture} data-kind="editor" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="File">
          <FileIcon name={name} size={13} />
        </span>
        <span className="title">{name}</span>
        {dirty && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
        <span className="path" title={path}>
          {path}
        </span>
        <button
          className="btn small"
          title="Copy the full path"
          aria-label="Copy the full path"
          onClick={() =>
            void navigator.clipboard.writeText(path).then(
              () => report.current.onToast?.("Path copied"),
              () => report.current.onToast?.("The path could not be copied; select it in the header instead."),
            )
          }
        >
          Copy path
        </button>
        {offersPreview(path) && (
          <button
            className="btn small"
            title="Show this page rendered in a browser tab"
            aria-label="Preview in a browser tab"
            onClick={() => void previewHtml(path).then((err) => err && report.current.onToast?.(err))}
          >
            Preview
          </button>
        )}
        {views.length > 1 && (
          <span className="view-switch" role="group" aria-label="View">
            {views.map((v) => (
              <button key={v} aria-pressed={current === v} onClick={() => pick(v)} title={offer.why?.[v] ?? `${VIEW_LABEL[v]} view`}>
                {v === "rendered" && isNotebook(path) ? "Cells" : v === "rendered" && isSvg(path) ? "Picture" : VIEW_LABEL[v]}
              </button>
            ))}
          </span>
        )}
        {md && shown === "rich" && frontCtl && (
          <button className={`btn small${frontCtl.pressed ? " on" : ""}`} aria-pressed={frontCtl.pressed} style={frontCtl.pressed ? { background: "var(--row-selected)" } : undefined} title={frontCtl.label} aria-label={frontCtl.label} onClick={() => setHideFront((v) => !v)}>
            Front
          </button>
        )}
        {hasHeadings && shown === "rich" && (
          <button className="ib" aria-pressed={toc} title="Contents" aria-label="Contents" onClick={() => setToc((v) => !v)}>
            <List size={13} />
          </button>
        )}
        {conflicts > 0 && sourceShown && (
          <span className="conflict-nav" role="group" aria-label="Merge conflicts">
            <span className="count">{conflicts === 1 ? "1 conflict" : `${conflicts} conflicts`}</span>
            <button className="ib up" title={withChord("Previous conflict", labelOf(keymap, "editor.previousChange"))} aria-label="Previous conflict" onClick={() => stepConflicts(-1)}>
              <ChevronDown size={12} />
            </button>
            <button className="ib" title={withChord("Next conflict", labelOf(keymap, "editor.nextChange"))} aria-label="Next conflict" onClick={() => stepConflicts(1)}>
              <ChevronDown size={12} />
            </button>
          </span>
        )}
        <span className="right">
          <button className="ib" onClick={() => onClose?.()} title={withChord("Close tab", labelOf(keymap, "tab.close"))}>
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          {name} did not open: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
          {/outside (your projects|them)/.test(error) && (
            <button className="btn" title="Allows this one file for this run; nothing beneath it" onClick={() => void invoke("file_grant", { path }).then(() => setTries((n) => n + 1), (err) => setError(String(err)))}>
              Open this file anyway
            </button>
          )}
        </div>
      )}
      {naming && root && (
        <NamePrompt
          path={path}
          root={root}
          text={() => textOf(path) ?? ""}
          onCancel={() => setNaming(false)}
          onSaved={(r) => {
            setNaming(false);
            if (r.note) report.current.onToast?.(r.note);
            // The suggested name saves in place; a new name was written already and the tab follows the file (EDIT-032).
            if (r.same) void saveFile(path, setStale, report.current.onToast);
            else announceMoves([[path, r.path]]);
          }}
        />
      )}
      {stale && <StaleNotice path={path} onDone={() => setStale(false)} onToast={report.current.onToast} />}
      {gone && <GoneNotice path={path} />}
      {moved && !stale && !comparing && !follow && <DiskBanner path={path} onReload={reload} onKeep={keepMine} onCompare={() => setComparing(true)} />}
      {undoable && !moved && <UndoToast path={path} onUndo={undoReload} onClose={() => setUndoable(null)} />}
      {banner && (
        <div className="notice md-banner" role="status">
          {banner.text}
          {banner.big && (
            <button
              className="btn"
              onClick={() => {
                setBigOk(true);
                setMode("rich");
              }}
            >
              Open anyway
            </button>
          )}
        </div>
      )}
      {shown === "error" && (
        <div className="notice load-failed" role="alert">
          The rich view did not start: {richError}
          <button className="btn" onClick={() => setRichTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {noteFind && shown === "rich" && (
        <FindBar pane={id} root={richRoot} open={noteFind} onClose={() => setNoteFind(null)} replace={readOnly ? undefined : (ranges, text) => rich.current && replaceInRich(rich.current.editor, ranges, text)} />
      )}
      {md && shown === "rich" && !comparing && !readOnly && <RichToolbar get={() => rich.current} notePath={path} onNote={onToast} />}
      {railShown && <NoteRail host={richHost} notes={railed} version={noteText} onRemove={onRemoveNote} onEdit={onEditNote} />}
      {tocShown && <Contents md={noteText} path={path} root={richRoot} onClose={() => setToc(false)} />}
      {tocShown && <TocResizer width={tocWidth} onWidth={setTocWidth} />}
      {comparing && <CompareView path={path} text={textOf(path) ?? ""} read={readDisk} onReload={reload} onKeep={keepMine} onClose={() => setComparing(false)} />}
      {changesOn && <DiffPane embedded against="head" id={id} path={path} root={root} staged={false} hidden={hidden || comparing} focused={focused} onFocus={onFocus} onToast={onToast} />}
      <div ref={host} className="pane-body" hidden={shown !== "source" || comparing} />
      {grid && (isSvg(path) ? <SvgView path={path} loaded={ready} hidden={shown !== "table" || comparing} /> : isNotebook(path) ? <NotebookView path={path} loaded={ready} hidden={shown !== "table" || comparing} readOnly={readOnly} onText={(t) => { const cm = view.current; if (cm) cm.dispatch({ changes: withLineBreaks(cm.state, { from: 0, to: cm.state.doc.length, insert: t }) }); }} /> : <CsvTable path={path} loaded={ready} hidden={shown !== "table" || comparing} />)}
      {!hidden && shown === "source" && hint && copyKey && copiedSel !== hint.sel && !flash && (
        <div className="copy-hint" style={{ left: hint.x + 8, top: hint.y + 2 }}>
          {copyKey} copies with path and lines
        </div>
      )}
      {!hidden && flash && (
        <div className="copy-hint done" role="status" style={{ left: flash.x + 8, top: flash.y + 2 }}>
          Copied with path and lines
        </div>
      )}
      {md && shown === "rich" && !comparing && <SlashMenu view={slashView} onPick={(id) => rich.current?.pickSlash(id)} />}
      {md && shown === "rich" && !comparing && <WikiMenu view={wikiView} onPick={(p) => rich.current?.pickWiki(p)} />}
      {md && shown === "rich" && !comparing && <TableMenu editor={richEditor} />}
      {md && shown === "rich" && !comparing && <FrontMatterBlock front={frontText} hide={hideFront} />}
      {md && shown === "rich" && !comparing && !readOnly && <TableControls editor={richEditor} />}
      {md && shown === "rich" && !comparing && !readOnly && <CodeLabel editor={richEditor} />}
      {md && shown === "rich" && !comparing && <DrawPanel editor={richEditor} />}
      {md && shown === "rich" && !comparing && <LinkHover editor={richEditor} host={richHost.current} onOpen={(href, shift) => richHost.current && openHref(href, richHost.current, path, root, shift, onLink)} onToast={onToast} />}
      {md && <div ref={richHost} className="pane-body md-rich" onClickCapture={(e) => richHost.current && followClick(e.nativeEvent, richHost.current, path, root, onLink)} contentEditable suppressContentEditableWarning spellCheck={spell} hidden={shown !== "rich" || comparing} aria-label={`${name}, rich view`} />}
    </section>
  );
}

// EDIT-029 (T-235-b): a PNG, JPEG or similar file opens in the image viewer instead of the text editor (it would be refused as binary); everything else is the text editor.
export default function EditorPane(props: Props) {
  if (isPdf(props.path)) return <PdfView id={props.id} path={props.path} root={props.root} onLink={props.onLink} hidden={props.hidden} focused={props.focused} onFocus={props.onFocus} onClose={props.onClose} onToast={props.onToast} />;
  return isPicture(props.path) ? <ImageView id={props.id} path={props.path} hidden={props.hidden} focused={props.focused} onFocus={props.onFocus} onClose={props.onClose} onToast={props.onToast} /> : <TextEditorPane {...props} />;
}
