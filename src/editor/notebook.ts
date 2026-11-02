// EDIT-024 (T-316-b): the model behind a Jupyter notebook (.ipynb) tab. A notebook is JSON; this file reads it,
// changes a cell at a time and writes it back. Everything the view does not show (metadata, kernel details,
// cell ids, outputs, any field a newer format adds) stays in the object untouched, so saving never loses it.
// Running a cell is Rust's job (notebook_run.rs, behind a trust prompt, see notebookRun.ts); nothing in this file runs
// code, so a notebook can never run by being opened.

export const isNotebook = (path: string) => /\.ipynb$/i.test(path);

export type CellKind = "code" | "markdown" | "raw";
export type Cell = { cell_type: string; source?: unknown; [k: string]: unknown };
export type Notebook = { cells: Cell[]; nbformat_minor?: number; [k: string]: unknown };
export type Parsed = { ok: true; nb: Notebook } | { ok: false; why: string };

/** Reads a notebook; a file that is not one says why, and the source view still has the text. */
export function parseNotebook(text: string): Parsed {
  if (!text.trim()) return { ok: false, why: "This notebook file is empty." };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, why: "This file is not valid notebook JSON; the source view has the text." };
  }
  const nb = v as Notebook | null;
  if (!nb || typeof nb !== "object" || !Array.isArray(nb.cells)) return { ok: false, why: "This file has no list of cells; the source view has the text." };
  if (!nb.cells.every((c) => c && typeof c === "object" && typeof (c as Cell).cell_type === "string")) return { ok: false, why: "A cell in this file is damaged; the source view has the text." };
  return { ok: true, nb };
}

/** Jupyter's own layout: one space of indent, a final newline. */
export const serialize = (nb: Notebook): string => JSON.stringify(nb, null, 1) + "\n";

const lines = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("") : "");

export const kindOf = (c: Cell): CellKind => (c.cell_type === "markdown" || c.cell_type === "raw" ? c.cell_type : "code");
export const sourceOf = (c: Cell): string => lines(c.source);

/** The text as Jupyter stores it: a list of lines each keeping its line break. A cell stored as one string stays one string. */
const asSource = (text: string, like: unknown): string | string[] => (typeof like === "string" ? text : text.split(/(?<=\n)/));

export function withSource(nb: Notebook, at: number, text: string): Notebook {
  const c = nb.cells[at];
  if (!c || sourceOf(c) === text) return nb;
  return { ...nb, cells: nb.cells.map((x, i) => (i === at ? { ...x, source: asSource(text, x.source) } : x)) };
}

/** A blank cell. Notebooks of format 4.5 and later give every cell an id; `id` makes it. */
export function newCell(kind: CellKind, nb: Notebook, id: () => string = () => crypto.randomUUID().slice(0, 8)): Cell {
  const c: Cell = { cell_type: kind, ...((nb.nbformat_minor ?? 0) >= 5 ? { id: id() } : {}), metadata: {}, source: [] };
  return kind === "code" ? { ...c, execution_count: null, outputs: [] } : c;
}

export function insertCell(nb: Notebook, at: number, kind: CellKind, id?: () => string): Notebook {
  const i = Math.max(0, Math.min(at, nb.cells.length));
  return { ...nb, cells: [...nb.cells.slice(0, i), newCell(kind, nb, id), ...nb.cells.slice(i)] };
}

export const removeCell = (nb: Notebook, at: number): Notebook => (nb.cells[at] ? { ...nb, cells: nb.cells.filter((_, i) => i !== at) } : nb);

/** Moves a cell one place up (-1) or down (1); at an end it stays. */
export function moveCell(nb: Notebook, at: number, dir: -1 | 1): Notebook {
  const to = at + dir;
  if (!nb.cells[at] || to < 0 || to >= nb.cells.length) return nb;
  const cells = nb.cells.slice();
  [cells[at], cells[to]] = [cells[to], cells[at]];
  return { ...nb, cells };
}

/** Switches a cell between code and markdown (or raw). A cell leaving code drops its outputs and run count, as Jupyter does;
 * one arriving as code gets empty ones. Its text, id and metadata stay. */
export function setKind(nb: Notebook, at: number, kind: CellKind): Notebook {
  const c = nb.cells[at];
  if (!c || c.cell_type === kind) return nb;
  const { outputs, execution_count, ...rest } = c;
  const next: Cell = kind === "code" ? { ...rest, cell_type: kind, execution_count: execution_count ?? null, outputs: Array.isArray(outputs) ? outputs : [] } : { ...rest, cell_type: kind };
  return { ...nb, cells: nb.cells.map((x, i) => (i === at ? next : x)) };
}

/** A code cell after a run: its outputs and run number replaced, every other field of it and every other cell kept.
 * Anything that is not a code cell stays as it is. */
export function withOutputs(nb: Notebook, at: number, outputs: unknown[], count: number): Notebook {
  const c = nb.cells[at];
  if (!c || c.cell_type !== "code") return nb;
  return { ...nb, cells: nb.cells.map((x, i) => (i === at ? { ...x, outputs, execution_count: count } : x)) };
}

/** A long cell shows only its start, so a huge cell never locks the view. */
export const PREVIEW_LINES = 200;
export const PREVIEW_CHARS = 20000;

export type Limited = { shown: string; cut: boolean; lines: number };
export function limited(text: string, maxLines = PREVIEW_LINES, maxChars = PREVIEW_CHARS): Limited {
  let end = 0;
  let n = 0;
  while (n < maxLines && end < text.length && end < maxChars) {
    const nl = text.indexOf("\n", end);
    end = nl < 0 ? text.length : nl + 1;
    n++;
  }
  end = Math.min(end, maxChars, text.length);
  let total = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) total++;
  return { shown: text.slice(0, end), cut: end < text.length, lines: total };
}

/** What a cell's saved outputs look like as plain text (never HTML): streams and text results as written, an error as
 * its name and message, a picture as a note that it is kept in the file. */
export function outputText(c: Cell): string {
  if (!Array.isArray(c.outputs)) return "";
  const out: string[] = [];
  for (const o of c.outputs as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") continue;
    if (o.output_type === "stream") out.push(lines(o.text));
    else if (o.output_type === "error") out.push(`${String(o.ename ?? "Error")}: ${String(o.evalue ?? "")}`);
    else {
      const data = (o.data ?? {}) as Record<string, unknown>;
      if ("text/plain" in data) out.push(lines(data["text/plain"]));
      else if (Object.keys(data).some((k) => k.startsWith("image/"))) out.push("[picture output, kept in the file]");
      else if (Object.keys(data).length) out.push("[output, kept in the file]");
    }
  }
  return out.join("\n");
}
