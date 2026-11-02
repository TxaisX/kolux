// One text per open file (EDIT-001). Every editor showing the same file is attached to its
// buffer: what is typed in one is copied into the others, so two split panes edit one text; the
// buffer remembers what is on disk, so a tab is unsaved only while its text differs from that by
// more than trailing whitespace; a save writes the file once and leaves every view clean.
//
// The first frame loads this module (FloatingLayer asks isDirty, the window asks keyOf and
// baseName), so it carries no CodeMirror: the values it cannot make itself — the annotation that
// marks Kolux's own change and the read of it, the undo grouping a reload gets, the line separator
// of a view, the text split into lines, and the field that holds a mixed file's endings — are
// installed by editor/editors.ts, the CodeMirror side, which loads with the editor. Everything here
// that is not one of those values is plain text work and stays on the first frame.
import type { Annotation, ChangeSet, EditorState, Extension, StateEffect, Text, Transaction } from "@codemirror/state";

/** What the CodeMirror side gives the store; editor/editors.ts builds it from @codemirror/state and
 *  @codemirror/commands and installs it before any view is attached. */
type CodeMirror = {
  /** marks a change Kolux made itself (a copy from the twin view, a reload) */
  mark: () => Annotation<boolean>;
  /** whether a transaction carries that mark */
  marked: (tr: Transaction) => boolean;
  /** makes the transaction one undo step of its own, apart from the typing before it */
  isolate: () => Annotation<unknown>;
  /** the effect that switches a view's line separator */
  ends: (end: string) => StateEffect<unknown>;
  /** text already split into lines, as a view splits them */
  lines: (text: string, end: string) => Text;
  /** T-603: the effect that sets a state's per-line endings beside its document */
  setEnds: (ends: Ends) => StateEffect<unknown>;
  /** T-603: the endings a state holds, in order */
  endsOfState: (state: EditorState) => Ends;
  /** T-603: the separator compartment and the endings field for a file's text */
  lineEndsFor: (text: string) => Extension;
  /** T-603: the text of a state as the file would be saved, each line with its own ending */
  fileText: (state: EditorState) => string;
};

let codeMirror: CodeMirror | null = null;

/** Installs the CodeMirror values, once, as editor/editors.ts loads (it is the module the editor and
 *  the buffers' own tests import; nothing on the first frame calls a view's dispatch). */
export function useCodeMirror(cm: CodeMirror): void {
  codeMirror = cm;
}

function cm(): CodeMirror {
  if (!codeMirror) throw new Error("editor/buffers: the CodeMirror side is not loaded (import editor/editors before attaching a view)");
  return codeMirror;
}

// A file with Windows line ends is shown and saved with them. T-603: the separator sits in a
// compartment (editor/editors.ts) that a reload using other line ends throughout switches
// (replaceAll), and text the rich view or the notebook view hands the editor gets the editor's own
// line breaks (withLineBreaks).
//
// DT-C57 (T-603, Txais 2026-10-31, option a): a file that holds both CRLF and LF lines draws every
// line on its own and is saved ending by ending, byte for byte. One separator cannot split both
// kinds, so such a file's document holds no CR at all (nothing joins, nothing shows a control
// character) and each line's own ending is kept beside it in the CodeMirror side's ends field
// (`endsField` in editor/editors.ts); `fileText` puts the endings back, and `save` writes that.
export const mixedEnds = (text: string) => text.includes("\r\n") && /(^|[^\r])\n/.test(text);
/** The text an editor draws for `text`: a mixed file's CRLFs are held aside (see `fileText`). */
export const docText = (text: string) => (mixedEnds(text) ? text.replace(/\r\n/g, "\n") : text);

/** The ending after each line but the last, in order: one entry per line break the file has. */
export type Ends = readonly string[];
/** T-603: the endings of `text`, one per line break, when it mixes CRLF and LF; else none. */
export const endsOf = (text: string): Ends => (mixedEnds(text) ? text.split("\n").slice(0, -1).map((l) => (l.endsWith("\r") ? "\r\n" : "\n")) : []);

/** DT-C57: each break of the new document keeps the ending of the old break it stands for; a break the edit added takes
 *  the ending of the line beside it. Each old break is carried forward through the change; a new break at that same place
 *  is that line's own, and one at a place no old break reached was added by the edit. */
export function mapEnds(oldDoc: Text, changes: ChangeSet, newDoc: Text, ends: Ends): Ends {
  const at = new Map<number, number>();
  for (let i = 1; i < oldDoc.lines; i++) at.set(changes.mapPos(oldDoc.line(i + 1).from - 1, 1), i - 1);
  const out: string[] = [];
  for (let i = 1; i < newDoc.lines; i++) {
    const j = at.get(newDoc.line(i + 1).from - 1);
    out.push(j === undefined ? (out[i - 2] ?? ends[0] ?? "\n") : ends[Math.min(j, ends.length - 1)]);
  }
  return out;
}

/** The line separator of an editor showing `text` (EditorPane, DiffPane), and a mixed file's line endings. */
export const lineEndsFor = (text: string): Extension => cm().lineEndsFor(text);

/** The text of the file an editor state would save: its lines with each line's own ending (a state
 *  built without the endings, or a file with one kind throughout, is its document as before). */
export const fileText = (state: EditorState): string => cm().fileText(state);

/** T-603: the one line end `text` uses throughout, or null when it has none. A mixed file is split on LF, its CRs
 *  held aside, so every line is drawn on its own. */
const soleLineEnd = (text: string): string | null => {
  if (mixedEnds(text)) return "\n";
  const crlf = text.includes("\r\n");
  return crlf === /(^|[^\r])\n/.test(text) ? null : crlf ? "\r\n" : "\n";
};

/** T-603 (F01-editor.2): a change worked out on doc.toString() (lines joined with \n), its line breaks as `state` splits them. */
export const withLineBreaks = <C extends { insert: string }>(state: EditorState, c: C): C =>
  state.lineBreak === "\n" ? c : { ...c, insert: c.insert.replace(/\r?\n/g, state.lineBreak) };

/** The part of an editor view a buffer needs; EditorView fits it, and the tests use plain states. */
export type View = { state: EditorState; dispatch: (spec: { changes: ChangeSet | { from: number; to: number; insert: string | Text }; effects?: StateEffect<unknown> | readonly StateEffect<unknown>[]; annotations: Annotation<unknown> | readonly Annotation<unknown>[] }) => void };

/** Text equal to the disk copy except for whitespace at the ends of lines (and of the file). */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[ \t]+(?=\r?\n|$)/g, "").replace(/\s+$/, "");
  return a === b || norm(a) === norm(b);
}

/** EDIT-046: the refusals a retry cannot change (the file is binary, over the size bound, or not UTF-8). */
export const NOT_TEXT = /is a binary file|is too large to open|is not UTF-8 text/;

/** Reads a file, trying again a few times before giving up with the last error (EDIT-001). A file
 *  that is not text (EDIT-046) is given up on at once: reading it again changes nothing. */
export async function loadText(read: () => Promise<string>, tries = 3, wait = 300): Promise<string> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      if (NOT_TEXT.test(String(e))) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** The buffer key: Windows paths compare without case and with either slash. */
/** EDIT-044 (T-062-b): a path inside a WSL distribution, `\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`
 * (either share name, either slash, the long-path `\\?\UNC\` form too): the distribution and the Linux path. */
const WSL = /^[\\/]{2}(?:\?[\\/]unc[\\/])?wsl(?:\$|\.localhost)[\\/]([^\\/]+)(.*)$/i;

/** One key per file, so two tabs on the same file share one text. A Windows drive path is case-blind with forward
 * slashes. A file inside a WSL distribution keys as `//wsl/<distro>/<linux path>`, the Linux path case-sensitive as
 * Linux keeps it; one that reaches a Windows drive through the distribution's `/mnt/<letter>` keys as that drive, so
 * the WSL path and the drive alias of one file are one file (EDIT-044, T-062-b). Any other path is its own key. */
export function keyOf(path: string): string {
  if (/^[a-z]:[\\/]/i.test(path)) return path.replace(/\\/g, "/").toLowerCase();
  const m = WSL.exec(path);
  if (!m) return path;
  const tail = m[2].replace(/\\/g, "/");
  const mnt = /^\/mnt\/([a-z])(?=\/|$)/i.exec(tail);
  if (mnt) return `${mnt[1]}:${tail.slice(mnt[0].length) || "/"}`.toLowerCase();
  return `//wsl/${m[1].toLowerCase()}${tail}`;
}
export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

// fileText, not sliceDoc(): a mixed file's endings are held beside the document (T-603, DT-C57).
type Buffer = { disk: string; views: Set<View>; listeners: Set<() => void> };
const buffers = new Map<string, Buffer>();

function buf(path: string): Buffer {
  const k = keyOf(path);
  let b = buffers.get(k);
  if (!b) buffers.set(k, (b = { disk: "", views: new Set(), listeners: new Set() }));
  return b;
}
const tell = (b: Buffer) => b.listeners.forEach((f) => f());

/** The text a newly attached view should show: a twin's current text, else what was read. T-603: the twin's lines,
 *  separator and per-line endings too, as a change relayed between views that split the text differently does not fit. */
export function attach(path: string, view: View, disk: string): void {
  const b = buf(path);
  if (b.views.size === 0) b.disk = disk;
  const twin = [...b.views][0];
  b.views.add(view);
  if (twin && (twin.state.lineBreak !== view.state.lineBreak || fileText(twin.state) !== fileText(view.state))) {
    const end = twin.state.lineBreak;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: twin.state.doc },
      effects: [...(view.state.lineBreak === end ? [] : [cm().ends(end)]), cm().setEnds(cm().endsOfState(twin.state))],
      annotations: cm().mark(),
    });
  }
  tell(b);
}

export function detach(path: string, view: View): void {
  const b = buf(path);
  b.views.delete(view);
  if (b.views.size === 0 && b.listeners.size === 0) buffers.delete(keyOf(path));
}

/** Called for each transaction of an attached view: the user's edits go to its twins. */
export function relay(path: string, from: View, tr: Transaction): void {
  if (!tr.docChanged) return;
  const b = buf(path);
  if (!cm().marked(tr)) for (const v of b.views) if (v !== from) v.dispatch({ changes: tr.changes, annotations: cm().mark() });
  tell(b);
}

export function isDirty(path: string): boolean {
  const b = buffers.get(keyOf(path));
  const v = b && [...b.views][0];
  return !!v && !sameText(fileText(v.state), b.disk);
}

/** EDIT-003 (T-073-a): lowercase hex SHA-256 of a text's UTF-8 bytes. file_read returns the file's
 *  bytes unchanged, so this is the hash of the disk copy the buffer holds; file_write's optional
 *  `loaded_hash` is compared with the file's bytes before writing. */
export async function hashOf(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** file_write's typed refusal when the file changed on disk since it was loaded: error kind
 *  `stale`, as an object's `kind` or as the start of the error text. */
export const isStale = (e: unknown): boolean => (typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "stale") || String(e).startsWith("stale");

/** Writes the file once, from the buffer's text; every view of it is clean afterwards. The write
 *  gets the hash of the disk copy the buffer was loaded from, so a file changed meanwhile is
 *  refused; `force` (Keep mine) leaves the hash out and overwrites. */
export async function save(path: string, write: (text: string, loadedHash?: string) => Promise<unknown>, force = false): Promise<void> {
  const b = buf(path);
  const v = [...b.views][0];
  if (!v) return;
  const text = fileText(v.state);
  await write(text, force ? undefined : await hashOf(b.disk));
  b.disk = text;
  tell(b);
}

/** Text Kolux puts in itself (a reload): every view shows it and none is unsaved. `undoable`
 *  (EDIT-003's Reload) makes it one step of its own in each view's undo history, so Ctrl+Z or the
 *  toast's Undo brings the edits back. T-603 (F01-editor.4): text that uses one line end throughout,
 *  other than the view's, switches the view's separator; a mixed file is split on LF with its CRs held
 *  aside, so every line is drawn on its own (DT-C57). It goes in already split into lines (the
 *  transaction splits a string on the separator it starts with). */
export function replaceAll(path: string, text: string, undoable = false): void {
  const b = buf(path);
  b.disk = text;
  const annotations = undoable ? [cm().mark(), cm().isolate()] : cm().mark();
  const sole = soleLineEnd(text);
  const ends = endsOf(text);
  for (const v of b.views) {
    if (fileText(v.state) === text) continue;
    const end = sole ?? v.state.lineBreak;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: cm().lines(end === "\r\n" ? text : docText(text), end) },
      effects: [...(v.state.lineBreak === end ? [] : [cm().ends(end)]), cm().setEnds(ends)],
      annotations,
    });
  }
  tell(b);
}

export function subscribe(path: string, f: () => void): () => void {
  const b = buf(path);
  b.listeners.add(f);
  return () => {
    b.listeners.delete(f);
    if (b.views.size === 0 && b.listeners.size === 0) buffers.delete(keyOf(path));
  };
}

/** The open text of a file as the editor draws it, or null when no editor has it open (a preview then reads the disk).
 *  A mixed file's text here has no CRs: `fileTextOf` is what a save writes. */
export function textOf(path: string): string | null {
  const v = buffers.get(keyOf(path))?.views.values().next().value;
  return v ? v.state.sliceDoc() : null;
}

/** The text a save of the open file would write (T-603: a mixed file's own endings are here), or null. */
export function fileTextOf(path: string): string | null {
  const v = buffers.get(keyOf(path))?.views.values().next().value;
  return v ? fileText(v.state) : null;
}

/** The text of the open file and the disk copy it was typed over, for the drafts (EDIT-004). */
export function diskOf(path: string): string | null {
  const b = buffers.get(keyOf(path));
  return b && b.views.size ? b.disk : null;
}

// EDIT-032: unsaved text that follows a renamed or moved file. The tab at the new path starts from
// the disk copy it reads, then takes what was carried so the edits stay and the tab stays unsaved.
const carried = new Map<string, { text: string; disk: string }>();

/** Carries the unsaved text of every open file the moves touch (a folder move takes what is under
 *  it) to the new path. Returns the new paths' keys. A clean file carries nothing: its tab reads
 *  the disk at the new place. */
export function carryOver(moves: [string, string][]): string[] {
  const made: string[] = [];
  for (const [k, b] of buffers) {
    const v = [...b.views][0];
    if (!v || sameText(fileText(v.state), b.disk)) continue;
    for (const [from, to] of moves) {
      const f = keyOf(from);
      if (k !== f && !k.startsWith(f + "/")) continue;
      const nk = keyOf(to) + k.slice(f.length);
      carried.set(nk, { text: fileText(v.state), disk: b.disk });
      made.push(nk);
      break;
    }
  }
  return made;
}

/** The text carried to this path, once. */
export function takeCarried(path: string): { text: string; disk: string } | null {
  const k = keyOf(path);
  const c = carried.get(k) ?? null;
  carried.delete(k);
  return c;
}

/** Unsaved text a view held when it was torn down to be built again (a diff tab changing its
 *  layout), with the disk copy it was typed over. */
export type Held = { path: string; text: string; disk: string };

/** The unsaved text of an open file and its disk copy, or null when it is clean or not open. */
export function heldOf(path: string): Held | null {
  const b = buffers.get(keyOf(path));
  const v = b && [...b.views][0];
  if (!b || !v || sameText(fileText(v.state), b.disk)) return null;
  return { path, text: fileText(v.state), disk: b.disk };
}

/** How a view opening `path` starts. `text` is what it shows; `base` is the disk copy the buffer
 *  takes for it, so a save is checked against the copy that text was typed over, never against a
 *  newer one; `keep` is set when carried unsaved text was typed over a copy that is no longer the
 *  one on disk: the caller keeps it beside the file (unsavedCopy.ts) instead of saving it over. */
export type Opening = { text: string; base: string; keep?: string };

/** The start of a view of `path` read as `disk` (EDIT-001, EDIT-032): a twin's text when another
 *  view has the file open; else unsaved text held across a rebuild; else text carried by a move,
 *  used only when the disk at the new place is the very copy it was typed over. The carry is
 *  taken (once) in every case, so it can never surface later over a newer disk copy. */
export function opening(path: string, disk: string, held?: Held | null): Opening {
  const carry = takeCarried(path);
  const twin = textOf(path);
  if (twin !== null) return { text: twin, base: disk };
  if (held && keyOf(held.path) === keyOf(path)) return { text: held.text, base: held.disk };
  if (!carry) return { text: disk, base: disk };
  if (carry.disk === disk) return { text: carry.text, base: disk };
  return { text: carry.text, base: carry.disk, keep: carry.text };
}
