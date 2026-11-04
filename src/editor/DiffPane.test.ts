import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { binNote, noteField, noteTools, setNotes, unbinNote, withoutWhitespace, type NoteActions } from "./DiffPane";
import type { LineNote } from "./diffNotes";

const chunks = (a: string, b: string, override?: typeof withoutWhitespace) => Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), override && { override });

describe("diff tab whitespace (EDIT-027)", () => {
  const a = "one\n  two\nthree\nfour";
  const b = "one\ntwo   \nthree\nFOUR";
  it("shows whitespace-only changes when asked", () => {
    expect(chunks(a, b).length).toBe(2);
  });
  it("leaves them out by default, keeping real changes where they are", () => {
    const left = chunks(a, b, withoutWhitespace);
    expect(left.length).toBe(1);
    expect(Text.of(b.split("\n")).lineAt(left[0].fromB).number).toBe(4);
  });
});

describe("diff of a whole-file rewrite stays bounded (row 804)", () => {
  const gen = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed} line ${i} ${(i * 7919).toString(36)} lorem ipsum dolor sit amet ${(i * 104729).toString(16)}`).join("\n");
  // The unbounded diff took seconds at 1,500 lines and minutes at 19,000; bounded it is milliseconds.
  it.each([1500, 19000])("a %i-line rewrite is diffed in well under 2 s with the default override", (n) => {
    const t = Date.now();
    const found = chunks(gen("alpha", n), gen("betabeta", n), withoutWhitespace);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(found.length).toBeGreaterThan(0);
  }, 30000);
});

describe("review notes on both sides of a side-by-side diff (GIT-040, T-034-b)", () => {
  const act: NoteActions = { add: () => {}, edit: () => {}, remove: () => {} };
  const note = (id: string, line: number, side?: "old"): LineNote => ({ id, path: "a.ts", line, text: id, staged: false, side });
  // a card per note that lands on a line the side's text has, and each side only takes its own
  const cards = (doc: string, side: "new" | "old", notes: LineNote[]) => {
    const field = noteField(act, side);
    const state = EditorState.create({ doc, extensions: [field] }).update({ effects: setNotes.of(notes) }).state;
    return state.field(field).deco.size;
  };
  const notes = [note("n2", 2), note("o2", 2, "old"), note("o3", 3, "old"), note("o9", 9, "old")];
  it("the new side draws the new notes and the old side the old ones, even on the same line", () => {
    expect(cards("one\ntwo\nthree", "new", notes)).toBe(1);
    expect(cards("one\ntwo\nthree", "old", notes)).toBe(2); // o9 is past the old text's last line, so no card
  });
  it("an added file has an empty old side, so it draws no old card", () => {
    expect(cards("", "old", [note("o1", 1, "old")])).toBe(0);
  });
  it("the cards are laid out again when a new read of the text arrives", () => {
    const field = noteField(act, "old");
    let state = EditorState.create({ doc: "one", extensions: [field] }).update({ effects: setNotes.of([note("o2", 2, "old")]) }).state;
    expect(state.field(field).deco.size).toBe(0);
    state = state.update({ changes: { from: 3, insert: "\ntwo" } }).state;
    expect(state.field(field).deco.size).toBe(1);
  });
});

describe("how a diff tab starts (SET-038, T-323-b)", () => {
  it("follows the Settings > General diff choices, and starts inline, unwrapped, whitespace hidden by default", async () => {
    const { diffStart } = await import("./DiffPane");
    const { readEditorPrefs } = await import("../settings/editorPrefs");
    expect(diffStart(readEditorPrefs({}))).toEqual({ split: false, wrap: false, spaces: false });
    expect(diffStart(readEditorPrefs({ diffView: "split", diffWordWrap: true, diffShowWhitespace: true }))).toEqual({ split: true, wrap: true, spaces: true });
    // the editor's own word wrap does not move the diff's
    expect(diffStart(readEditorPrefs({ editorWordWrap: false })).wrap).toBe(false);
  });
});

// Row 277: the embedded Changes view of a file tab (no pane header of its own) still has the layout
// switch, the previous/next change buttons and Copy Context.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DiffPane from "./DiffPane";

describe("the embedded Changes view has its own slim bar (row 277)", () => {
  const html = (embedded: boolean) => renderToString(createElement(DiffPane, { id: 1, path: "C:/w/a.ts", staged: false, embedded, against: "head" }));
  it("carries the Inline / Side by side switch, previous and next change and Copy Context", () => {
    const h = html(true);
    expect(h).toContain("Side by side");
    expect(h).toContain('aria-label="Previous change"');
    expect(h).toContain('aria-label="Next change"');
    expect(h).toContain("Copy context");
    expect(h).not.toContain("pane-head"); // still no header of a pane of its own
  });
  it("the pane's own header keeps them too, once each", () => {
    const h = html(false);
    expect(h.match(/Side by side/g)?.length).toBe(2); // the button text and its title
    expect(h.match(/aria-label="Next change"/g)?.length).toBe(1);
  });
});

describe("note gutter (the + beside a line)", () => {
  const act: NoteActions = { add: () => {}, edit: () => {}, remove: () => {} };
  it("is drawn where a note can be saved", () => {
    expect((noteTools(act, "new", true) as unknown[])[1]).not.toEqual([]);
  });
  it("is left out where notes cannot be saved (the embedded Changes view), but the cards stay", () => {
    const ext = noteTools(act, "new", false) as unknown[];
    expect(ext[1]).toEqual([]);
    expect(ext[0]).toBeTruthy();
  });
});

// T-723 (DT-C159): the bin on a review note deletes at once, and the banner's Undo saves the same note back.
describe("a binned review note can be undone (T-723)", () => {
  const note: LineNote = { id: "n1", path: "a.ts", line: 4, end: 6, text: "rename this", staged: false, side: "old" };
  it("deletes at once, keeps the note for Undo, and Undo puts back the same note", () => {
    let list: LineNote[] = [note, { ...note, id: "n2", line: 9 }];
    const r = { current: { onDeleteNote: (n: LineNote) => (list = list.filter((x) => x.id !== n.id)), onSaveNote: (n: LineNote) => (list = [...list, n]) } };
    const kept = binNote(note, r);
    expect(list.map((n) => n.id)).toEqual(["n2"]);
    expect(kept).toBe(note);
    unbinNote(kept!, r);
    expect(list.find((n) => n.id === "n1")).toEqual(note);
  });
  it("offers no Undo when nothing can save the note back", () => {
    const gone: string[] = [];
    expect(binNote(note, { current: { onDeleteNote: (n) => gone.push(n.id) } })).toBeNull();
    expect(gone).toEqual(["n1"]);
  });
});
