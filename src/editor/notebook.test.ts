import { describe, expect, it } from "vitest";
import { insertCell, isNotebook, kindOf, limited, moveCell, outputText, parseNotebook, removeCell, serialize, setKind, sourceOf, withOutputs, withSource, type Notebook } from "./notebook";

// EDIT-024 (T-316-b): the notebook model. No DOM and no Python: it reads, changes and writes the JSON.
const RAW = {
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, custom: { keep: [1, 2, 3] } },
  nbformat: 4,
  nbformat_minor: 5,
  future_field: { a: 1 },
  cells: [
    { cell_type: "markdown", id: "m1", metadata: { tags: ["x"] }, source: ["# Title\n", "text"] },
    { cell_type: "code", id: "c1", metadata: {}, execution_count: 3, source: ["print('hi')\n", "x = 1"], outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }] },
  ],
};
const text = JSON.stringify(RAW, null, 1) + "\n";
const load = (t = text): Notebook => {
  const p = parseNotebook(t);
  if (!p.ok) throw new Error(p.why);
  return p.nb;
};

describe("reading", () => {
  it("knows a notebook by its name", () => {
    expect(isNotebook("C:/w/a.IPYNB")).toBe(true);
    expect(isNotebook("a.json")).toBe(false);
  });
  it("says why a file is not a notebook", () => {
    expect(parseNotebook("")).toMatchObject({ ok: false });
    expect(parseNotebook("{nope")).toMatchObject({ ok: false });
    expect(parseNotebook('{"a":1}')).toMatchObject({ ok: false });
    expect(parseNotebook('{"cells":[1]}')).toMatchObject({ ok: false });
    expect(parseNotebook("null")).toMatchObject({ ok: false });
  });
  it("joins a cell stored as lines and keeps multi-line source exactly", () => {
    const nb = load();
    expect(sourceOf(nb.cells[1])).toBe("print('hi')\nx = 1");
    expect(kindOf(nb.cells[0])).toBe("markdown");
    expect(kindOf({ cell_type: "weird" })).toBe("code");
  });
});

describe("writing back", () => {
  it("an untouched notebook writes back byte for byte", () => {
    expect(serialize(load())).toBe(text);
  });
  it("editing one cell keeps every other detail, including fields this view does not know", () => {
    const nb = withSource(load(), 1, "print('bye')\n\ny = 2");
    const back = JSON.parse(serialize(nb));
    expect(back.cells[1].source).toEqual(["print('bye')\n", "\n", "y = 2"]);
    expect(back.cells[1].outputs).toEqual(RAW.cells[1].outputs);
    expect(back.cells[1].execution_count).toBe(3);
    expect(back.cells[0]).toEqual(RAW.cells[0]);
    expect(back.metadata).toEqual(RAW.metadata);
    expect(back.future_field).toEqual({ a: 1 });
  });
  it("a cell stored as one string stays one string; the same text changes nothing", () => {
    const nb = load('{"cells":[{"cell_type":"code","source":"a\\nb","outputs":[]}]}');
    expect(withSource(nb, 0, "a\nb\nc").cells[0].source).toBe("a\nb\nc");
    expect(withSource(nb, 0, "a\nb")).toBe(nb);
  });
});

describe("cells", () => {
  const ids = () => {
    let n = 0;
    return () => `n${++n}`;
  };
  it("adds a blank cell with an id for format 4.5, none for older notebooks", () => {
    const nb = insertCell(load(), 1, "code", ids());
    expect(nb.cells).toHaveLength(3);
    expect(nb.cells[1]).toEqual({ cell_type: "code", id: "n1", metadata: {}, source: [], execution_count: null, outputs: [] });
    const old = insertCell(load('{"cells":[],"nbformat_minor":2}'), 0, "markdown");
    expect(old.cells[0]).toEqual({ cell_type: "markdown", metadata: {}, source: [] });
  });
  it("insert clamps to the ends; remove and move leave the rest in order", () => {
    const nb = load();
    expect(insertCell(nb, 99, "raw").cells[2].cell_type).toBe("raw");
    expect(insertCell(nb, -5, "raw").cells[0].cell_type).toBe("raw");
    expect(removeCell(nb, 0).cells.map((c) => c.id)).toEqual(["c1"]);
    expect(removeCell(nb, 7)).toBe(nb);
    expect(moveCell(nb, 0, 1).cells.map((c) => c.id)).toEqual(["c1", "m1"]);
    expect(moveCell(nb, 0, -1)).toBe(nb);
    expect(moveCell(nb, 1, 1)).toBe(nb);
  });
  it("switching to markdown drops outputs and run count, back to code gives empty ones; text and id stay", () => {
    const md = setKind(load(), 1, "markdown");
    expect(md.cells[1]).toEqual({ cell_type: "markdown", id: "c1", metadata: {}, source: RAW.cells[1].source });
    const code = setKind(md, 0, "code");
    expect(code.cells[0]).toMatchObject({ cell_type: "code", id: "m1", execution_count: null, outputs: [], metadata: { tags: ["x"] } });
    const same = load();
    expect(setKind(same, 1, "code")).toBe(same);
  });
});

describe("long cells and outputs", () => {
  it("a short cell is shown whole", () => {
    expect(limited("a\nb")).toEqual({ shown: "a\nb", cut: false, lines: 2 });
    expect(limited("")).toEqual({ shown: "", cut: false, lines: 1 });
  });
  it("many lines cut at the line limit, counting the whole cell", () => {
    const t = Array.from({ length: 1000 }, (_, i) => `l${i}`).join("\n");
    const r = limited(t, 5);
    expect(r.shown).toBe("l0\nl1\nl2\nl3\nl4\n");
    expect(r.cut).toBe(true);
    expect(r.lines).toBe(1000);
  });
  it("one huge line cuts at the character limit", () => {
    const r = limited("x".repeat(100), 200, 10);
    expect(r.shown).toBe("x".repeat(10));
    expect(r.cut).toBe(true);
  });
  it("outputs read as plain text: streams, results, errors, pictures", () => {
    const c = {
      cell_type: "code",
      outputs: [
        { output_type: "stream", text: ["a\n", "b"] },
        { output_type: "execute_result", data: { "text/plain": ["42"], "text/html": ["<b>no</b>"] } },
        { output_type: "display_data", data: { "image/png": "AAAA" } },
        { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["\u001b[31m"] },
      ],
    };
    expect(outputText(c)).toBe("a\nb\n42\n[picture output, kept in the file]\nValueError: bad");
    expect(outputText({ cell_type: "markdown" })).toBe("");
  });
});

describe("withOutputs", () => {
  const stream = [{ output_type: "stream", name: "stdout", text: ["new\n"] }];
  it("replaces the outputs and run number of that code cell and keeps every other field", () => {
    const nb = load();
    const next = withOutputs(nb, 1, stream, 4);
    expect(next.cells[1]).toEqual({ ...RAW.cells[1], outputs: stream, execution_count: 4 });
    expect(next.cells[1].id).toBe("c1");
    expect(next.cells[1].metadata).toEqual({});
    expect(sourceOf(next.cells[1])).toBe("print('hi')\nx = 1");
  });
  it("keeps the other cells, the notebook's unknown fields, and does not touch the old notebook", () => {
    const nb = load();
    const next = withOutputs(nb, 1, stream, 4);
    expect(next.cells[0]).toBe(nb.cells[0]);
    expect(next.future_field).toEqual({ a: 1 });
    expect(next.metadata).toEqual(RAW.metadata);
    expect(nb.cells[1].execution_count).toBe(3);
    expect(parseNotebook(serialize(next))).toMatchObject({ ok: true });
  });
  it("leaves a markdown cell and a missing cell alone", () => {
    const nb = load();
    expect(withOutputs(nb, 0, stream, 4)).toBe(nb);
    expect(withOutputs(nb, 9, stream, 4)).toBe(nb);
    expect(withOutputs(nb, -1, stream, 4)).toBe(nb);
  });
});
