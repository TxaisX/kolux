import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type ElementNode, KEY_BACKSPACE_COMMAND, KEY_ENTER_COMMAND, KEY_TAB_COMMAND, type LexicalCommand, type LexicalEditor } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import {
  $addColumn,
  $addRow,
  $insertTable,
  $isTableNode,
  $removeColumn,
  $removeRow,
  $tableAt,
  alignOf,
  delimLine,
  isDelimiterRow,
  registerTable,
  respellRow,
  rowLine,
  splitRow,
  TABLE,
  TABLE_NODES,
} from "./richTable";
import { roundTrip, unsupported } from "./markdown";
import { richBlocker } from "./frontMatter";

// EDIT-010 (T-234-b): tables in the rich view. The text of a table, its keys and its row and
// column edits, on a headless editor.
const mk = (md: string): LexicalEditor => {
  const ed = createEditor({ namespace: "t", nodes: TABLE_NODES, onError: (e) => { throw e; } });
  registerTable(ed);
  ed.update(() => $convertFromMarkdownString(md, [TABLE]), { discrete: true });
  return ed;
};
const out = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString([TABLE]));
const run = (ed: LexicalEditor, f: () => unknown) => ed.update(() => void f(), { discrete: true });
const key = (ed: LexicalEditor, cmd: LexicalCommand<KeyboardEvent> | LexicalCommand<KeyboardEvent | null>, shiftKey = false) => {
  let prevented = false;
  ed.update(() => void ed.dispatchCommand(cmd as LexicalCommand<KeyboardEvent>, { shiftKey, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent), { discrete: true });
  return prevented;
};
/** Puts the caret at the end of cell (row r, column c). No type argument on getChildAtIndex: Lexical 0.53 dropped it. */
const caret = (ed: LexicalEditor, r: number, c: number) =>
  run(ed, () => {
    const t = $getRoot().getChildren().find($isTableNode)!;
    const row = (t as unknown as ElementNode).getChildAtIndex(r) as unknown as ElementNode;
    (row.getChildAtIndex(c) as unknown as ElementNode).selectEnd();
  });
const where = (ed: LexicalEditor) => ed.getEditorState().read(() => { const a = $tableAt(); return a && [a.r, a.c]; });

const T = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";

describe("table text", () => {
  it("splits rows on pipes that are not escaped, and reads the delimiter row", () => {
    expect(splitRow("| a | b\\|c |  |")).toEqual(["a", "b\\|c", ""]);
    expect(splitRow("a|b")).toEqual(["a", "b"]);
    expect(isDelimiterRow("|:--|:-:|--:|")).toBe(true);
    expect(isDelimiterRow("| a | b |")).toBe(false);
    expect([alignOf(":--"), alignOf(":-:"), alignOf("--:"), alignOf("---")]).toEqual(["left", "center", "right", ""]);
    expect(rowLine(["a", ""])).toBe("| a |  |");
    expect(delimLine(["left", "center", "right", ""])).toBe("| :--- | :---: | ---: | --- |");
  });

  it("reads a table and writes it back, byte for byte when nothing in it changed", () => {
    for (const md of [T, "|a|b|\n|:-|-:|\n|1|2|", "| x | y |\n|---|---|\n| only one", "para\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter"]) expect(out(mk(md))).toBe(md);
  });

  it("pads a short row and keeps its original text until it is changed", () => {
    const ed = mk("| a | b |\n| --- | --- |\n| 1 |");
    expect(out(ed)).toBe("| a | b |\n| --- | --- |\n| 1 |");
    caret(ed, 1, 1);
    run(ed, () => $tableAt()!.cell.append($createTextNode("z")));
    expect(out(ed)).toBe("| a | b |\n| --- | --- |\n| 1 | z |");
  });

  it("row 194: an edited row keeps the file's spelling of the cells that did not change", () => {
    const md = "|Name|Age|City|\n|---|:-:|--:|\n|Ann   |  31 |Oslo|\n|Bo|7|Rome  |";
    const edit = (r: number, c: number, text: string) => {
      const ed = mk(md);
      caret(ed, r, c);
      run(ed, () => {
        const cell = $tableAt()!.cell;
        cell.clear();
        cell.append($createTextNode(text));
      });
      return out(ed);
    };
    // Unchanged cells keep their padding; the edited cell keeps its own padding style.
    expect(edit(2, 2, "Paris")).toBe("|Name|Age|City|\n|---|:-:|--:|\n|Ann   |  31 |Oslo|\n|Bo|7|Paris |");
    expect(edit(1, 1, "32")).toBe("|Name|Age|City|\n|---|:-:|--:|\n|Ann   |  32 |Oslo|\n|Bo|7|Rome  |");
    expect(edit(1, 0, "Annabel")).toBe("|Name|Age|City|\n|---|:-:|--:|\n|Annabel |  31 |Oslo|\n|Bo|7|Rome  |");
    expect(edit(0, 0, "Who")).toBe("|Who|Age|City|\n|---|:-:|--:|\n|Ann   |  31 |Oslo|\n|Bo|7|Rome  |");
    // A cell written back to what it was gives the row back byte for byte.
    expect(edit(2, 0, "Bo")).toBe(md);
  });

  it("row 194: respellRow keeps indent, an unclosed row end and escaped pipes, and gives up on a changed shape", () => {
    expect(respellRow("  a | b\\| c  ", ["a", "b\\| c"], ["x", "b\\| c"])).toBe("  x | b\\| c  ");
    expect(respellRow("|a|b|", ["a", "b"], ["a", "b", "c"])).toBeNull();
    expect(respellRow("|a|b|", ["a", "q"], ["a", "b"])).toBeNull();
  });

  it("row 194: a row of a different shape (a column added) is written canonically", () => {
    const ed = mk("|a|b|\n|---|---|\n|1  |2|");
    caret(ed, 1, 0);
    run(ed, () => $addColumn("right"));
    expect(out(ed).split("\n")[2]).toBe("| 1 |  | 2 |");
  });

  it("a table in a note no longer sends the rich view to source, and a pipe in plain text stays text", () => {
    expect(unsupported("# T\n\n" + T + "\n")).toBeNull();
    expect(roundTrip("# T\n\n" + T + "\n")).toContain("| 1 | 2 |");
    expect(unsupported("a | b is not a table\n\nnext\n")).toBeNull();
    expect(roundTrip("a | b is not a table\n")).toContain("a | b is not a table");
  });
});

// T-602 (audit F01-editor.3): the rich view never deletes cell text. The auditor's three cases.
describe("cell text is never lost", () => {
  const typeInto = (ed: LexicalEditor, r: number, c: number, text: string) => {
    caret(ed, r, c);
    run(ed, () => {
      const cell = $tableAt()!.cell;
      cell.clear();
      cell.append($createTextNode(text));
    });
  };

  it("a | typed into a cell is saved escaped, so the cell keeps all its text and reopens whole", () => {
    const ed = mk("| cmd | what |\n| --- | --- |\n| du | disk use |");
    typeInto(ed, 1, 1, "lists files | sort");
    const saved = out(ed);
    expect(saved.split("\n")[2]).toBe("| du | lists files \\| sort |");
    expect(splitRow(saved.split("\n")[2])).toEqual(["du", "lists files \\| sort"]);
    expect(out(mk(saved))).toBe(saved);
    // a pipe the file already escaped is not escaped twice; an escaped backslash before a typed pipe still ends in one
    typeInto(ed, 1, 1, "a \\| b, c \\\\| d");
    expect(out(ed).split("\n")[2]).toBe("| du | a \\| b, c \\\\\\| d |");
    // a canonical row (a new one) escapes too
    const fresh = mk("| a | b |\n| --- | --- |");
    caret(fresh, 0, 0);
    run(fresh, () => $addRow("below"));
    typeInto(fresh, 1, 0, "x|y");
    expect(out(fresh).split("\n")[2]).toBe("| x\\|y |  |");
  });

  it("a note whose table has a row with more cells than its header opens in source view, with the reason", () => {
    const note = (row: string) => `# Commands\n\n| cmd | what |\n| --- | --- |\n${row}\n`;
    expect(unsupported(note("| du | lists files | sort |"))).toBe("it has table rows with more cells than their header");
    expect(richBlocker(note("| 1 | 2 | note: keep me |"), false)?.text).toBe("Showing source: the rich view cannot show this file because it has table rows with more cells than their header.");
    // rows that fit, short rows and escaped pipes still open in the rich view
    expect(unsupported(note("| du | lists files \\| sort |"))).toBeNull();
    expect(unsupported(note("| du |"))).toBeNull();
  });

  it("editing a row that holds more cells than it shows keeps the row as the file has it instead of dropping the rest", () => {
    const md = "| cmd | what |\n| --- | --- |\n| du | lists files | sort |";
    const ed = mk(md);
    typeInto(ed, 1, 0, "ls -la");
    expect(out(ed)).toBe(md);
    // a column added still reaches every row (the canonical line is written when the row shows all its cells)
    const grown = mk("|a|b|\n|---|---|\n|1|2|");
    caret(grown, 1, 0);
    run(grown, () => $addColumn("right"));
    expect(out(grown).split("\n")[2]).toBe("| 1 |  | 2 |");
  });
});

describe("keys", () => {
  it("Tab and Shift+Tab move across cells in reading order and Tab from the last cell grows a row", () => {
    const ed = mk(T);
    caret(ed, 0, 0);
    expect(key(ed, KEY_TAB_COMMAND)).toBe(true);
    expect(where(ed)).toEqual([0, 1]);
    key(ed, KEY_TAB_COMMAND);
    expect(where(ed)).toEqual([1, 0]);
    key(ed, KEY_TAB_COMMAND, true);
    expect(where(ed)).toEqual([0, 1]);
    caret(ed, 2, 1);
    key(ed, KEY_TAB_COMMAND);
    expect(where(ed)).toEqual([3, 0]);
    expect(out(ed)).toBe(T + "\n|  |  |");
  });

  it("Enter goes down a cell and grows a row after the last one", () => {
    const ed = mk(T);
    caret(ed, 0, 1);
    key(ed, KEY_ENTER_COMMAND);
    expect(where(ed)).toEqual([1, 1]);
    caret(ed, 2, 0);
    key(ed, KEY_ENTER_COMMAND);
    expect(where(ed)).toEqual([3, 0]);
    expect(out(ed).split("\n")).toHaveLength(5);
  });

  it("Backspace in an empty row removes it, never in a row with text or the header", () => {
    const ed = mk(T + "\n|  |  |");
    caret(ed, 3, 0);
    key(ed, KEY_BACKSPACE_COMMAND);
    expect(out(ed)).toBe(T);
    expect(where(ed)).toEqual([2, 0]);
    key(ed, KEY_BACKSPACE_COMMAND); // caret at the end of "3": not the start of an empty row
    expect(out(ed)).toBe(T);
    const h = mk("|  |  |\n| --- | --- |\n| 1 | 2 |");
    caret(h, 0, 0);
    key(h, KEY_BACKSPACE_COMMAND);
    expect(out(h)).toBe("|  |  |\n| --- | --- |\n| 1 | 2 |");
  });
});

describe("rows and columns", () => {
  it("adds a row above or below, never above the header, and removes a body row but not the header", () => {
    const ed = mk(T);
    caret(ed, 1, 1);
    run(ed, () => $addRow("above"));
    expect(out(ed)).toBe("| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |");
    expect(where(ed)).toEqual([1, 1]);
    caret(ed, 0, 0);
    run(ed, () => $addRow("above"));
    expect(out(ed).split("\n")[2]).toBe("|  |  |"); // landed below the header
    caret(ed, 0, 0);
    run(ed, () => expect($removeRow()).toBe(false));
    caret(ed, 1, 0);
    run(ed, () => $removeRow());
    expect(out(ed).split("\n")).toHaveLength(5);
  });

  it("adds a column on either side as one undo step and keeps the header row a header", () => {
    const ed = mk(T);
    let updates = 0;
    ed.registerUpdateListener(() => updates++);
    caret(ed, 1, 0);
    updates = 0;
    run(ed, () => $addColumn("right"));
    expect(updates).toBe(1);
    expect(out(ed)).toBe("| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |");
    expect(where(ed)).toEqual([1, 1]);
    run(ed, () => $addColumn("left"));
    expect(out(ed).split("\n")[0]).toBe("| a |  |  | b |");
    expect(ed.getEditorState().read(() => ($tableAt()!.table.getChildAtIndex(0) as unknown as ElementNode).getChildren().every((c) => (c as unknown as { isHeader(): boolean }).isHeader()))).toBe(true);
  });

  it("removes a column, and removing the last one removes the table", () => {
    const ed = mk("before\n\n" + T + "\n\nafter");
    caret(ed, 2, 0);
    run(ed, () => $removeColumn());
    expect(out(ed)).toBe("before\n\n| b |\n| --- |\n| 2 |\n| 4 |\n\nafter");
    run(ed, () => $removeColumn());
    expect(out(ed)).toBe("before\n\nafter");
    expect(ed.getEditorState().read(() => $getRoot().getChildren().some($isTableNode))).toBe(false);
  });

  it("inserts a table after the caret's block, or in place of an empty paragraph", () => {
    const ed = createEditor({ namespace: "t", nodes: TABLE_NODES, onError: (e) => { throw e; } });
    run(ed, () => {
      const p = $createParagraphNode();
      p.append($createTextNode("text"));
      $getRoot().clear().append(p);
      p.selectEnd();
    });
    run(ed, () => $insertTable(3, 2));
    expect(out(ed)).toBe("text\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |");
    expect(where(ed)).toEqual([0, 0]);
    run(ed, () => {
      const p = $createParagraphNode();
      $getRoot().clear().append(p);
      p.select();
    });
    run(ed, () => $insertTable(2, 2));
    expect(out(ed)).toBe("|  |  |\n| --- | --- |\n|  |  |");
  });
});
