import { describe, expect, it } from "vitest";
import { parseNotebook, serialize, sourceOf, type Notebook } from "./notebook";
import { runCell, type RunDeps } from "./notebookRun";

// EDIT-024 (T-316-b): what Run does, in order, with Rust and the dialog replaced by recorders.
const NB: Notebook = {
  cells: [
    { cell_type: "markdown", id: "m", metadata: {}, source: ["# t"] },
    { cell_type: "code", id: "c", metadata: { tags: ["keep"] }, execution_count: 2, source: ["print('hi')"], outputs: [{ output_type: "stream", name: "stdout", text: ["old\n"] }] },
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
};
const STREAM = [{ output_type: "stream", name: "stdout", text: ["hi\n"] }];

function rig(opts: { trusted: boolean; yes?: boolean; saved?: boolean; run?: () => unknown }) {
  const log: string[] = [];
  const texts: string[] = [];
  const deps: RunDeps = {
    invoke: (async (command: string) => {
      log.push(command);
      if (command === "notebook_trusted") return opts.trusted;
      if (command === "notebook_run_cell") return opts.run ? opts.run() : { outputs: STREAM, execution_count: 3 };
      return undefined;
    }) as RunDeps["invoke"],
    ask: async () => (log.push("ask"), opts.yes ?? false),
    onText: (t) => (log.push("text"), texts.push(t)),
    save: async () => (log.push("save"), opts.saved ?? true),
    current: () => {
      const p = parseNotebook(texts[texts.length - 1] ?? serialize(NB));
      return p.ok ? p.nb : null;
    },
  };
  return { deps, log, texts };
}

describe("running a cell", () => {
  it("a declined trust never runs and never writes", async () => {
    const r = rig({ trusted: false, yes: false });
    expect(await runCell("C:/w/a.ipynb", NB, 1, r.deps)).toBe("declined");
    expect(r.log).toEqual(["notebook_trusted", "ask"]);
    expect(r.texts).toEqual([]);
  });

  it("an accepted run writes the stream output and bumps the run number", async () => {
    const r = rig({ trusted: false, yes: true });
    expect(await runCell("C:/w/a.ipynb", NB, 1, r.deps)).toBe("ran");
    const final = parseNotebook(r.texts[r.texts.length - 1]!);
    if (!final.ok) throw new Error(final.why);
    expect(final.nb.cells[1].outputs).toEqual(STREAM);
    expect(final.nb.cells[1].execution_count).toBe(3);
    expect(final.nb.cells[1].metadata).toEqual({ tags: ["keep"] });
    expect(sourceOf(final.nb.cells[1])).toBe("print('hi')");
    expect(final.nb.cells[0]).toEqual(NB.cells[0]);
    expect(final.nb.metadata).toEqual(NB.metadata);
  });

  it("the order is trust, then save, then run, then the outputs", async () => {
    const r = rig({ trusted: false, yes: true });
    await runCell("C:/w/a.ipynb", NB, 1, r.deps);
    expect(r.log).toEqual(["notebook_trusted", "ask", "notebook_trust", "text", "save", "notebook_run_cell", "text"]);
    expect(JSON.parse(r.texts[0]).cells[1].outputs).toEqual(NB.cells[1].outputs); // the save is the notebook as it was, not the new outputs
  });

  it("a notebook that is already trusted does not ask again", async () => {
    const r = rig({ trusted: true });
    expect(await runCell("C:/w/a.ipynb", NB, 1, r.deps)).toBe("ran");
    expect(r.log).toEqual(["notebook_trusted", "text", "save", "notebook_run_cell", "text"]);
  });

  it("asks Rust about, trusts and runs the same path and index", async () => {
    const calls: [string, unknown][] = [];
    const r = rig({ trusted: false, yes: true });
    const inner = r.deps.invoke;
    r.deps.invoke = ((c: string, a?: Record<string, unknown>) => (calls.push([c, a]), inner(c, a))) as RunDeps["invoke"];
    await runCell("C:/w/a.ipynb", NB, 1, r.deps);
    expect(calls).toEqual([
      ["notebook_trusted", { path: "C:/w/a.ipynb" }],
      ["notebook_trust", { path: "C:/w/a.ipynb" }],
      ["notebook_run_cell", { path: "C:/w/a.ipynb", index: 1 }],
    ]);
  });

  it("a markdown cell or a missing cell never reaches Rust", async () => {
    const r = rig({ trusted: true });
    expect(await runCell("C:/w/a.ipynb", NB, 0, r.deps)).toBe("skipped");
    expect(await runCell("C:/w/a.ipynb", NB, 7, r.deps)).toBe("skipped");
    expect(r.log).toEqual([]);
  });

  it("a notebook that could not be saved is not run", async () => {
    const r = rig({ trusted: true, saved: false });
    await expect(runCell("C:/w/a.ipynb", NB, 1, r.deps)).rejects.toThrow(/not run/);
    expect(r.log).not.toContain("notebook_run_cell");
  });

  it("a run that fails writes no outputs and says why", async () => {
    const r = rig({ trusted: true, run: () => Promise.reject("No Python found.") });
    r.deps.invoke = (async (c: string) => {
      r.log.push(c);
      if (c === "notebook_trusted") return true;
      if (c === "notebook_run_cell") throw "No Python found.";
    }) as RunDeps["invoke"];
    await expect(runCell("C:/w/a.ipynb", NB, 1, r.deps)).rejects.toBe("No Python found.");
    expect(r.texts).toHaveLength(1); // only the save before the run
  });

  it("puts the outputs into what the tab holds now, so typing during a run is not lost", async () => {
    const r = rig({ trusted: true });
    const typed = { ...NB, cells: [NB.cells[0], { ...NB.cells[1], source: ["print('typed meanwhile')"] }] };
    r.deps.current = () => typed;
    await runCell("C:/w/a.ipynb", NB, 1, r.deps);
    const final = parseNotebook(r.texts[r.texts.length - 1]!);
    if (!final.ok) throw new Error(final.why);
    expect(sourceOf(final.nb.cells[1])).toBe("print('typed meanwhile')");
    expect(final.nb.cells[1].outputs).toEqual(STREAM);
  });
});
