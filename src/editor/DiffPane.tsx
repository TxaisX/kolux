// A diff tab (EDIT-027): one file's staged or unstaged change, inline or in two columns. It starts
// inline, with whitespace-only changes hidden and long lines unwrapped; the actions menu turns
// either on. F7 and Shift+F7 (App's shortcut router, `diffNav`) step through the changes. An
// unstaged diff's right side is the working file itself, kept in the shared buffer (buffers.ts), so
// it can be edited and Mod+S writes the file. The sides are read again whenever git state moves
// (the git status watcher, scm/watch.ts) while the tab is in front, or when it comes to the front
// after a move, so a change made in a terminal, or a stage made elsewhere, shows without
// reopening. A markdown file's diff is source text, never the rich view. GIT-040: a review note
// hangs under a line of the new side, in both layouts, and under a line of the old (left) side too:
// in the side-by-side layout under that line, in the inline layout under the deleted lines of its
// chunk (or the line it is now); a note on the old side is only started side by side. The plus in the note gutter or the Add
// Review Note command's chord (Mod+Shift+A unless the user rebinds it) on a selection opens the
// note popover.
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings/useSettings";
import { readEditorPrefs, type EditorPrefs } from "../settings/editorPrefs";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from "@codemirror/view";
import { ChangeSet, Compartment, EditorState, StateEffect, Text, StateField, type Extension } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { languageFor } from "./languages";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { diff, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, MergeView, originalDocChangeEffect, unifiedMergeView } from "@codemirror/merge";
import { ChevronDown, Close, Dots, FileCode, TRASH_PATH } from "../chrome/icons";
import { attach, baseName, detach, docText, fileTextOf, heldOf, isDirty, lineEndsFor, opening, relay, replaceAll, subscribe, type Held } from "./editors";
import { confirmed } from "./fileMoved";
import { keepUnsaved, keptToast } from "./unsavedCopy";
import { copiers, editors, look, saveFile, StaleNotice } from "./EditorPane";
import { contextText, oldSideContext } from "./copyContext";
import { editedText, notesOn, shortPath, sideOf, where, type LineNote, type Side } from "./diffNotes";
import { oldSideDoc, unifiedSpot, withOldSideNote } from "./oldSide";
import { noteCommand } from "./noteCommands";
import { useKeymap } from "../keys/KeymapContext";
import { watchStatus } from "../scm/watch";
import { askText, needsAsk } from "./bigDiff";
import { bannerUp } from "./diskChange";
import { covers, createAutosave, movingNow, prefsReader } from "./autosave";
import { headSides } from "./viewSwitch";
import { fileOnDisk, isHtml, previewHtml } from "./htmlPreview";

/** Next (1) or previous (-1) change, by pane key; App's F7 and Shift+F7 call the focused one. */
/** SET-038 (T-323-b): how a new diff tab starts, from the Settings > General choices. */
export const diffStart = (p: EditorPrefs) => ({ split: p.diffView === "split", wrap: p.diffWordWrap, spaces: p.diffWhitespace });

// Cycle 3 (first load): the change stepper the window's F7 calls lives in keys/handles.ts now, so the
// shortcut router holds it without loading this pane; filled here while a diff tab is open.
import { diffNav } from "../keys/handles";
import { useMenuKeys } from "./menuNav";
export { diffNav };

type Sides = { original: string; modified: string };

const squash = (s: string) => s.replace(/\s+/g, "");
/** The diff with whitespace-only changes left out, which is how a diff tab starts. */
// Row 804: the override skips the merge package's own default scan limit, so it needs the same bound plus a timeout.
export const DIFF_BOUND = { scanLimit: 500, timeout: 1000 };
export const withoutWhitespace = (a: string, b: string) => diff(a, b, DIFF_BOUND).filter((c) => squash(a.slice(c.fromA, c.toA)) !== squash(b.slice(c.fromB, c.toB)));

// GIT-040: the note cards are block widgets under their line, so their height is part of the
// document's layout and the lines below never jump when a card draws.
export type NoteActions = { add: (line: number, end: number, at: { x: number; y: number }, side?: Side) => void; edit: (n: LineNote, at: { x: number; y: number }) => void; remove: (n: LineNote) => void };
export const setNotes = StateEffect.define<LineNote[]>();
const noteSpan = where;
class NoteCard extends WidgetType {
  constructor(
    readonly note: LineNote,
    readonly act: NoteActions,
  ) {
    super();
  }
  eq(o: NoteCard) {
    return o.note.id === this.note.id && o.note.text === this.note.text && o.note.sent === this.note.sent && o.note.line === this.note.line && o.note.side === this.note.side;
  }
  get estimatedHeight() {
    return 56;
  }
  ignoreEvent() {
    return true;
  }
  toDOM() {
    const el = (tag: string, cls: string, text?: string) => Object.assign(document.createElement(tag), { className: cls, ...(text === undefined ? {} : { textContent: text }) });
    const card = el("div", "diff-note");
    card.dataset.note = this.note.id;
    const head = el("div", "diff-note-head");
    head.append(el("span", "what", `Note on ${noteSpan(this.note)}${this.note.sent ? " · sent" : ""}`));
    const edit = el("button", "ib diff-note-edit", "Edit") as HTMLButtonElement;
    edit.title = "Edit this note";
    edit.onclick = (e) => this.act.edit(this.note, { x: e.clientX, y: e.clientY });
    const del = el("button", "ib diff-note-del") as HTMLButtonElement;
    del.title = "Delete this note";
    del.setAttribute("aria-label", "Delete note");
    del.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TRASH_PATH}"/></svg>`;
    del.onclick = () => this.act.remove(this.note);
    head.append(edit, del);
    card.append(head, el("div", "diff-note-text", this.note.text));
    return card;
  }
}
export const noteField = (act: NoteActions, side: Side) =>
  // A note belongs to a line number, so the cards are laid out again from the notes whenever the
  // text changes (a new read of the file replaces it whole).
  StateField.define<{ notes: LineNote[]; deco: DecorationSet }>({
    create: () => ({ notes: [], deco: Decoration.none }),
    update(was, tr) {
      const set = tr.effects.find((e) => e.is(setNotes));
      if (!set && !tr.docChanged) return was;
      const notes = set ? notesOn(set.value as LineNote[], side) : was.notes;
      const doc = tr.state.doc;
      const at = (n: LineNote) => Math.min(n.end ?? n.line, doc.lines);
      // An added file has nothing on its old side to hang a card on.
      const ranges = (side === "old" && doc.length === 0 ? [] : notes).filter((n) => n.line >= 1 && n.line <= doc.lines).map((n) => Decoration.widget({ widget: new NoteCard(n, act), block: true, side: 1 }).range(doc.line(at(n)).to));
      return { notes, deco: Decoration.set(ranges, true) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
// Row 25: the unified layout has no left view, so the cards of old-side notes are placed from the
// merge view's chunks (unifiedSpot) and follow edits to the new text.
type OldSpot = { note: LineNote; pos: number; side: number };
export const setOldSpots = StateEffect.define<OldSpot[]>();
export const oldNoteField = (act: NoteActions) =>
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      const set = [...tr.effects].reverse().find((e) => e.is(setOldSpots));
      if (set) return Decoration.set((set.value as OldSpot[]).filter((s) => s.pos <= tr.state.doc.length).map((s) => Decoration.widget({ widget: new NoteCard(s.note, act), block: true, side: s.side }).range(s.pos)), true);
      return tr.docChanged ? deco.map(tr.changes) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
/** Puts the old-side cards of a unified view where its chunks say; true when it drew any. */
const placeOldNotes = (v: EditorView, notes: LineNote[], had: boolean): boolean => {
  const old = notesOn(notes, "old");
  if (!old.length && !had) return false;
  const orig = getOriginalDoc(v.state);
  const chunks = getChunks(v.state)?.chunks ?? [];
  const spots = old.flatMap((n) => {
    const spot = unifiedSpot(chunks, orig, v.state.doc, n.end ?? n.line);
    return spot ? [{ note: n, ...spot }] : [];
  });
  v.dispatch({ effects: setOldSpots.of(spots) });
  return spots.length > 0;
};
class Plus extends GutterMarker {
  toDOM() {
    return Object.assign(document.createElement("span"), { className: "note-plus", textContent: "+", title: "Add a review note on this line" });
  }
}
const plus = new Plus();
/** The popover for the lines a view has selected, under the last of them. */
const noteAtSelection = (view: EditorView, act: NoteActions, side: Side = "new") => {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const end = doc.lineAt(sel.to).number;
  const c = view.coordsAtPos(doc.line(end).to);
  act.add(doc.lineAt(sel.from).number, end, { x: c?.left ?? 200, y: c?.bottom ?? 200 }, side);
};
/** The note gutter and the cards, for the new side of a diff. The Add Review Note chord is read
 * from the user's keymap by the pane (a rebinding is the one that works). */
export const noteTools = (act: NoteActions, side: Side = "new", canNote = true): Extension => [
  noteField(act, side),
  // The "+" is drawn only where a note can be saved (the embedded Changes view has no saver).
  !canNote ? [] : gutter({
    class: "cm-note-gutter",
    lineMarker: () => plus,
    initialSpacer: () => plus,
    domEventHandlers: {
      mousedown: (view, line, ev) => {
        const n = view.state.doc.lineAt(line.from).number;
        act.add(n, n, { x: (ev as MouseEvent).clientX, y: (ev as MouseEvent).clientY }, side);
        return true;
      },
    },
  }),
];
type Pop = { line: number; end: number; side?: Side; note?: LineNote; text: string; x: number; y: number; refused?: boolean };

type Props = { id: number; path: string; staged: boolean; root?: string | null; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; notes?: LineNote[]; onSaveNote?: (n: LineNote) => void; onDeleteNote?: (n: LineNote) => void; jump?: { line: number; at: number; side?: "old" };
  /** EDIT-056 (T-237-b): "head" compares the last commit with the working file (staged edits count as uncommitted). */
  against?: "head";
  /** The Changes view inside a file tab: that tab's header, save, copy and autosave stay in charge. */
  embedded?: boolean;
};

/** The diff's outer box: its own pane, or a plain filler inside a file tab. */
function Shell({ embedded, focused, hidden, label, onFocus, onKeys, id, children }: { embedded: boolean; focused: boolean; hidden: boolean; label: string; onFocus?: () => void; onKeys: (e: React.KeyboardEvent) => void; id: number; children: React.ReactNode }) {
  return embedded ? (
    <div className="diff changes-view" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }} hidden={hidden} aria-label={label} onMouseDown={onFocus} onKeyDown={onKeys}>
      {children}
    </div>
  ) : (
    <section className={`pane editor diff${focused ? " focused" : ""}`} hidden={hidden} aria-label={label} onMouseDown={onFocus} onKeyDown={onKeys} data-kind="diff" data-key={id}>
      {children}
    </section>
  );
}

export default function DiffPane({ id, path, staged, root = null, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, notes = [], onSaveNote, onDeleteNote, jump, against, embedded = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [sides, setSides] = useState<Sides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [split, setSplit] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const [wrap, setWrap] = useState(false);
  // The settings only choose how the tab starts: a choice made in this tab's menu is never overridden.
  const { settings } = useSettings();
  const touched = useRef(false);
  useEffect(() => {
    if (!settings || touched.current) return;
    const s = diffStart(readEditorPrefs(settings));
    setSplit(s.split);
    setWrap(s.wrap);
    setSpaces(s.spaces);
  }, [settings === null]);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  useMenuKeys(menuBox, menu, () => setMenu(false), menuBtn);
  const [changes, setChanges] = useState(0);
  const [onDisk, setOnDisk] = useState(false); // EDIT-025: a preview is offered only while the file still exists
  useEffect(() => {
    if (!isHtml(path)) return;
    let alive = true;
    void fileOnDisk(path).then((v) => alive && setOnDisk(v));
    return () => void (alive = false);
  }, [path, sides]);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false); // EDIT-003 (T-073-c): the last save was refused, the file moved on
  const views = useRef<{ a: EditorView | null; b: EditorView } | null>(null);
  const shown = useRef<Sides | null>(null); // the sides the views were last given
  const spotted = useRef(false); // row 25: the unified view holds old-side cards
  const held = useRef<Held | null>(null); // row 131: unsaved text kept while the views are built again
  const report = useRef({ onDirty, onToast });
  report.current = { onDirty, onToast };
  const front = useRef(!hidden);
  front.current = !hidden;
  const lang = useRef(new Compartment());
  // EDIT-028: a very big diff asks before it draws; Load draws it as usual.
  const [loadBig, setLoadBig] = useState(false);
  const asking = sides !== null && !loadBig && needsAsk(sides);
  const ready = sides !== null && !asking;
  const prefs = useRef(prefsReader(() => invoke<Record<string, unknown>>("get_settings"))).current;
  const [pop, setPop] = useState<Pop | null>(null);
  const noteRef = useRef({ notes, onDeleteNote, onSaveNote, canNote: !!onSaveNote });
  noteRef.current = { notes, onDeleteNote, onSaveNote, canNote: !!onSaveNote };
  // The bin on a note card deletes at once; the note is kept here for a few seconds so Undo can put it back.
  const [undoNote, setUndoNote] = useState<LineNote | null>(null);
  useEffect(() => {
    if (!undoNote) return;
    const t = window.setTimeout(() => setUndoNote(null), 8000);
    return () => window.clearTimeout(t);
  }, [undoNote]);
  const act = useRef<NoteActions>({
    add: (line, end, at, side = "new") => {
      if (!noteRef.current.canNote) return;
      // The old side is the left view's text; a line is only offered where that text has one.
      const old = side === "old" ? oldSideDoc(views.current?.a?.state.doc ?? Text.empty, line, end) : null;
      if (side === "old" && !old) return;
      setPop({ line: old?.line ?? line, end: old?.end ?? end, side, text: "", ...at });
    },
    edit: (note, at) => setPop({ line: note.line, end: note.end ?? note.line, side: sideOf(note), note, text: note.text, ...at }),
    remove: (note) => {
      noteRef.current.onDeleteNote?.(note);
      if (noteRef.current.onSaveNote) setUndoNote(note);
    },
  });
  const notesKey = JSON.stringify(notes);
  const keys = useKeymap();
  // GIT-040: the Add Review Note chord, whatever the user has bound it to, adds a note under the
  // selected lines; holding the keys adds one note.
  const onKeys = (e: React.KeyboardEvent) => {
    if (noteCommand(keys, e.nativeEvent) !== "add") return;
    e.preventDefault();
    e.stopPropagation();
    const v = views.current;
    const old = !!v?.a?.hasFocus;
    const view = old ? v?.a : v?.b;
    if (!e.repeat && view) noteAtSelection(view, act.current, old ? "old" : "new");
  };

  // The sides, now and whenever git state moves; a move while the tab is hidden is read on its return.
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
    setError(null);
    const fetch = () =>
      (against === "head"
        ? Promise.all([invoke<Sides>("diff_sides", { path, staged: true }), invoke<Sides>("diff_sides", { path, staged: false })]).then(([h, w]) => headSides(h, w))
        : invoke<Sides>("diff_sides", { path, staged })
      ).then(
        (s) => alive && setSides((old) => (old && old.original === s.original && old.modified === s.modified ? old : s)),
        (err) => alive && setError(String(err)),
      );
    void fetch();
    const stop = watchStatus(path, () => {
      if (front.current) void fetch();
      else missed.current = () => void fetch();
    });
    return () => {
      alive = false;
      missed.current = null;
      stop();
    };
  }, [path, staged, tries, against]);

  // The views, built again when the layout or a menu option changes.
  useEffect(() => {
    if (!ready || !host.current) return;
    const s = shown.current ?? sides!;
    // Row 131: the right side starts from a twin's text, the unsaved text this tab held before it
    // was built again, or text carried by a move (checked against the disk at the new place).
    const o = staged ? null : opening(path, s.modified, held.current);
    held.current = null;
    const modified = o ? o.text : s.modified;
    shown.current = { original: s.original, modified: s.modified };
    const common: Extension[] = [basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.current.of([]), wrap ? EditorView.lineWrapping : []];
    const count = (st: EditorState) => setChanges(getChunks(st)?.chunks.length ?? 0);
    const right: Extension[] = [
      ...common,
      lineEndsFor(modified),
      staged ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      noteTools(act.current, "new", !!onSaveNote),
      EditorView.updateListener.of((u) => {
        count(u.state);
        if (!staged) u.transactions.forEach((tr) => relay(path, u.view, tr));
        // Row 25: an edit can change the chunks, so the old-side cards are placed again.
        if (u.docChanged && !split) queueMicrotask(() => views.current?.b === u.view && (spotted.current = placeOldNotes(u.view, noteRef.current.notes, spotted.current)));
      }),
    ];
    const diffConfig = spaces ? undefined : { override: withoutWhitespace };
    let a: EditorView | null = null;
    let b: EditorView;
    let merge: MergeView | null = null;
    if (split) {
      merge = new MergeView({ a: { doc: docText(s.original), extensions: [...common, lineEndsFor(s.original), EditorState.readOnly.of(true), EditorView.editable.of(false), noteTools(act.current, "old", !!onSaveNote)] }, b: { doc: docText(modified), extensions: right }, parent: host.current, gutter: true, diffConfig });
      a = merge.a;
      b = merge.b;
    } else {
      b = new EditorView({ doc: docText(modified), parent: host.current, extensions: [...right, oldNoteField(act.current), unifiedMergeView({ original: docText(s.original), mergeControls: false, gutter: true, diffConfig })] });
    }
    views.current = { a, b };
    a?.dispatch({ effects: setNotes.of(noteRef.current.notes) });
    b.dispatch({ effects: setNotes.of(noteRef.current.notes) });
    spotted.current = !split && placeOldNotes(b, noteRef.current.notes, false);
    count(b.state);
    if (o) {
      attach(path, b, o.base);
      if (o.keep === undefined) confirmed(path);
      else {
        const keep = o.keep;
        const name = baseName(path);
        void keepUnsaved(path, keep).then(
          (kept) => {
            // The copy is written: the tab shows the disk, unless the user typed meanwhile.
            if (fileTextOf(path) === keep) replaceAll(path, s.modified);
            report.current.onToast?.(keptToast(name, kept));
            confirmed(path);
          },
          (err) => {
            report.current.onToast?.(keptToast(name, null, err));
            confirmed(path);
          },
        );
      }
    }
    languageFor(baseName(path))
      ?.load()
      .then((support) => [a, b].forEach((v) => v?.dispatch({ effects: lang.current.reconfigure(support) })))
      .catch(() => undefined);
    return () => {
      if (!staged) {
        held.current = heldOf(path);
        detach(path, b);
      }
      views.current = null;
      if (merge) merge.destroy();
      else b.destroy();
    };
  }, [ready, split, spaces, wrap, path, staged, !!onSaveNote]);

  // New sides from git: the left side always follows; the right one does unless it has unsaved edits.
  useEffect(() => {
    const v = views.current;
    const old = shown.current;
    if (!v || !old || !sides) return;
    shown.current = sides;
    if (sides.original !== old.original) {
      const len = (v.a ?? v.b).state.doc.length;
      if (v.a) v.a.dispatch({ changes: { from: 0, to: len, insert: sides.original } });
      else {
        const was = getOriginalDoc(v.b.state);
        v.b.dispatch({ effects: originalDocChangeEffect(v.b.state, ChangeSet.of({ from: 0, to: was.length, insert: sides.original }, was.length)) });
        spotted.current = placeOldNotes(v.b, noteRef.current.notes, spotted.current);
      }
    }
    if (sides.modified !== old.modified) {
      if (!staged) {
        if (!isDirty(path)) replaceAll(path, sides.modified);
      } else v.b.dispatch({ changes: { from: 0, to: v.b.state.doc.length, insert: sides.modified } });
    }
  }, [sides, path, staged]);

  // Unsaved marker and Mod+S, for an unstaged diff. The save carries the loaded hash like an editor
  // tab's (EDIT-003, T-073-c), so an agent's edit made behind the diff is never overwritten unseen.
  useEffect(() => {
    if (staged || embedded) return; // a file tab's own pane saves, autosaves and answers Mod+S
    // EDIT-002: autosave covers the diff tab of one unstaged file.
    const auto = createAutosave({
      prefs: prefs.get,
      covered: () => covers({ staged: false }),
      dirty: () => isDirty(path),
      held: () => bannerUp(path) || movingNow(path),
      write: () => saveFile(path, setStale, report.current.onToast),
    });
    let alive = true;
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
      if (d) void prefs.refresh().then(() => alive && auto.edit());
    });
    setStale(false);
    editors.set(id, () => saveFile(path, setStale, report.current.onToast));
    return () => {
      alive = false;
      auto.cancel();
      off();
      editors.delete(id);
    };
  }, [id, path, staged, embedded]);

  // GIT-040 / GIT-041: the cards follow the notes; opening a note from Source Control scrolls to it.
  useEffect(() => {
    views.current?.a?.dispatch({ effects: setNotes.of(noteRef.current.notes) });
    views.current?.b.dispatch({ effects: setNotes.of(noteRef.current.notes) });
    const b = views.current?.b;
    if (b && !views.current?.a) spotted.current = placeOldNotes(b, noteRef.current.notes, spotted.current);
  }, [notesKey]);
  useEffect(() => {
    const v = views.current;
    if (v && jump?.side === "old" && !v.a) {
      // Inline layout: the old line's card hangs where unifiedSpot puts it.
      const spot = unifiedSpot(getChunks(v.b.state)?.chunks ?? [], getOriginalDoc(v.b.state), v.b.state.doc, jump.line);
      if (spot) v.b.dispatch({ selection: { anchor: spot.pos }, effects: EditorView.scrollIntoView(spot.pos, { y: "center" }) });
      return;
    }
    const target = jump?.side === "old" ? v?.a : v?.b;
    if (!target || !jump) return;
    const at = target.state.doc.line(Math.min(Math.max(jump.line, 1), target.state.doc.lines)).from;
    target.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  }, [jump?.at, ready, split]);
  const savePop = () => {
    if (!pop) return;
    const text = editedText(pop.text);
    if (text === null) return setPop({ ...pop, refused: true });
    onSaveNote?.(pop.note ? { ...pop.note, text, sent: undefined } : withOldSideNote({ id: crypto.randomUUID(), path, line: pop.line, ...(pop.end !== pop.line ? { end: pop.end } : {}), text, staged }, pop.side ?? "new"));
    setPop(null);
  };

  useEffect(() => {
    diffNav.set(id, (dir) => {
      const b = views.current?.b;
      if (!b) return;
      (dir > 0 ? goToNextChunk : goToPreviousChunk)(b);
      b.focus();
    });
    return () => void diffNav.delete(id);
  }, [id]);

  // EDIT-007 (T-132-b): Copy Context in a diff copies the selection of the side that has focus (the
  // new side when neither has), headed by the path and the lines of that side.
  const copyContext = () => {
    const v = views.current;
    if (!v) return false;
    const old = v.a !== null && v.a.hasFocus && !v.b.hasFocus;
    const view = old && v.a ? v.a : v.b;
    const { from, to } = view.state.selection.main;
    const got = contextText(view.state.doc, from, to, shortPath(path, root));
    navigator.clipboard.writeText(old ? oldSideContext(got) : got.text).then(
      () => report.current.onToast?.("Copied with path and lines"),
      (err) => report.current.onToast?.(`Nothing was copied: ${String(err)}`),
    );
    return true;
  };
  useEffect(() => {
    if (embedded) return; // the file tab's own pane owns the chord; the bar's button calls copyContext
    copiers.set(id, copyContext);
    return () => void copiers.delete(id);
  }, [id, path, root, embedded]);

  useEffect(() => {
    if (focused && !hidden) views.current?.b.focus();
  }, [focused, hidden, ready]);

  const name = baseName(path);
  const step = (dir: 1 | -1) => diffNav.get(id)?.(dir);
  const actionsMenu = (
    <span className="diff-actions">
      <button ref={menuBtn} className="ib" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Diff actions" aria-label="Diff actions">
        <Dots size={12} />
      </button>
      {menu && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setMenu(false)} />
          <div ref={menuBox} className="menu diff-menu" role="menu">
            <button role="menuitemcheckbox" aria-checked={spaces} className="menu-item" onClick={() => ((touched.current = true), setSpaces((v) => !v))}>
              <span className="check">{spaces ? "✓" : ""}</span>
              <span className="name">Show whitespace changes</span>
            </button>
            <button role="menuitemcheckbox" aria-checked={wrap} className="menu-item" onClick={() => ((touched.current = true), setWrap((v) => !v))}>
              <span className="check">{wrap ? "✓" : ""}</span>
              <span className="name">Wrap lines</span>
            </button>
          </div>
        </>
      )}
    </span>
  );
  const layoutSwitch = (
    <span className="view-switch" role="group" aria-label="Layout">
      <button aria-pressed={!split} onClick={() => ((touched.current = true), setSplit(false))} title="Inline">
        Inline
      </button>
      <button aria-pressed={split} onClick={() => ((touched.current = true), setSplit(true))} title="Side by side">
        Side by side
      </button>
    </span>
  );
  const stepButtons = (
    <>
    <button className="ib" disabled={!changes} onClick={() => step(-1)} title="Previous change (Shift+F7)" aria-label="Previous change">
      <ChevronDown size={12} style={{ transform: "rotate(180deg)" }} />
    </button>
    <button className="ib" disabled={!changes} onClick={() => step(1)} title="Next change (F7)" aria-label="Next change">
      <ChevronDown size={12} />
    </button>
    </>
  );
  return (
    <Shell embedded={embedded} focused={focused} hidden={hidden} label={`Diff of ${name}`} onFocus={onFocus} onKeys={onKeys} id={id}>
      {embedded && (
        <div className="changes-bar" role="toolbar" aria-label="Changes view">
          {layoutSwitch}
          <span className="right">
            {stepButtons}
            {actionsMenu}
            <button className="btn" onClick={copyContext} title="Copy the selection with its path and line numbers">
              Copy context
            </button>
          </span>
        </div>
      )}
      {!embedded && (
      <header className="pane-head">
        <span className="agent-mark" title="Diff">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">{staged ? "Staged" : "Unstaged"}</span>
        {dirty && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
        <span className="path" title={path}>
          {path}
        </span>
        {isHtml(path) && onDisk && (
          <button className="btn small" title="Show this page rendered in a browser tab" aria-label="Preview in a browser tab" onClick={() => void previewHtml(path).then((err) => err && report.current.onToast?.(err))}>
            Preview
          </button>
        )}
        {layoutSwitch}
        <span className="right">
          {stepButtons}
          {actionsMenu}
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      )}
      {error && (
        <div className="notice load-failed" role="alert">
          The diff of {name} did not load: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {undoNote && (
        <div className="notice md-banner" role="status">
          Review note deleted.
          <button className="btn" onClick={() => (noteRef.current.onSaveNote?.(undoNote), setUndoNote(null))}>
            Undo
          </button>
        </div>
      )}
      {stale && !staged && <StaleNotice path={path} onDone={() => setStale(false)} onToast={report.current.onToast} />}
      {asking && sides && (
        <div className="notice md-banner" role="status">
          {askText(name, sides)}
          <button className="btn" onClick={() => setLoadBig(true)}>
            Load the full diff
          </button>
        </div>
      )}
      {ready && !changes && <div className="notice md-banner" role="status">{against === "head" ? "Nothing uncommitted in this file." : `No ${staged ? "staged" : "unstaged"} changes in this file right now.`}</div>}
      <div ref={host} className="pane-body diff-body" />
      {pop && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setPop(null)} />
          <div className="diff-note-pop" role="dialog" aria-label={pop.note ? "Edit review note" : "Add review note"} style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - 336)), top: Math.max(8, Math.min(pop.y + 12, window.innerHeight - 190)) }}>
            <div className="what">{`${pop.note ? "Edit the note on" : "Note on"} ${where({ id: "", path: "", text: "", staged: false, line: pop.line, end: pop.end, side: pop.side === "old" ? "old" : undefined })}`}</div>
            <textarea
              autoFocus
              aria-label="review note"
              className="field multi"
              value={pop.text}
              placeholder="What should change here?"
              onChange={(e) => setPop({ ...pop, text: e.target.value, refused: false })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPop(null);
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) savePop();
              }}
            />
            {pop.refused && <div className="note error">A note needs some text. To remove it, use the bin on its card.</div>}
            <div className="btn-row">
              <button className="btn primary" onClick={savePop} disabled={!pop.note && !pop.text.trim()}>
                {pop.note ? "Save" : "Add note"}
              </button>
              <button className="btn" onClick={() => setPop(null)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
