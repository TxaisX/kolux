// The CodeMirror side of the open-file buffers (EDIT-001, T-603). buffers.ts holds the documents and
// carries no CodeMirror, because the first frame loads it (the window asks isDirty, keyOf and
// keyOf and baseName); this module is what the editor and the buffers' tests import, and loading it
// installs every value the store cannot make itself: the annotation that marks Kolux's own change and
// the read of it, the undo grouping a reload gets (isolateHistory, compared by identity with the
// history extension, so it must come from this package, never a copy), the line separator compartment
// a view splits on, the text split into lines the way that view splits it, and — DT-C57 — the field
// that holds a mixed file's per-line endings beside its document.
import { Annotation, Compartment, EditorState, StateEffect, StateField, Text, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { endsOf, mapEnds, mixedEnds, useCodeMirror, type Ends } from "./buffers";

/** Marks a change Kolux made itself (a copy from the twin view, a reload), not the user's typing. */
export const synced = Annotation.define<boolean>();

// A file with Windows line ends is shown and saved with them. The editor splits text on its separator only, so
// T-603: the separator sits in a compartment that a reload using other line ends throughout switches (replaceAll).
const lineEnds = new Compartment();
// DT-C57: a mixed file is drawn split on LF with its CRs held aside, so its separator is LF even
// though it holds CRLF pairs; every other file splits on the one ending it has.
const lineEndOf = (text: string) => (mixedEnds(text) ? "\n" : text.includes("\r\n") ? "\r\n" : "\n");

/** The endings of a mixed file's lines, one per break, held beside the document (DT-C57). */
const setEnds = StateEffect.define<Ends>();
const endsField = StateField.define<Ends>({
  create: () => [],
  update(ends, tr) {
    for (const e of tr.effects) if (e.is(setEnds)) return e.value;
    return tr.docChanged && ends.length ? mapEnds(tr.startState.doc, tr.changes, tr.newDoc, ends) : ends;
  },
});

/** The separator and endings an editor showing `text` starts with (EditorPane, DiffPane). */
const endsFor = (text: string): Extension => [lineEnds.of(EditorState.lineSeparator.of(lineEndOf(text))), endsField.init(() => endsOf(text))];

/** The text of the file a state would save: its lines with each line's own ending (DT-C57). */
function textOf(state: EditorState): string {
  const ends = state.field(endsField, false) ?? [];
  if (!ends.length) return state.sliceDoc();
  let out = "";
  for (let i = 1; i <= state.doc.lines; i++) {
    out += state.doc.line(i).text;
    if (i < state.doc.lines) out += ends[Math.min(i - 1, ends.length - 1)];
  }
  return out;
}

useCodeMirror({
  mark: () => synced.of(true),
  marked: (tr) => !!tr.annotation(synced),
  isolate: () => isolateHistory.of("full"),
  ends: (end) => lineEnds.reconfigure(EditorState.lineSeparator.of(end)),
  lines: (text, end) => Text.of(text.split(end)),
  setEnds: (ends) => setEnds.of(ends),
  endsOfState: (state) => state.field(endsField, false) ?? [],
  lineEndsFor: endsFor,
  fileText: textOf,
});

// Everything a caller of a buffer needs, from one module: importing this one is what installs the
// CodeMirror values above, so a view can never be attached to a buffer that cannot dispatch to it.
export * from "./buffers";
