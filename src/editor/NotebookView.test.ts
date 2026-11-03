import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { needsAsk, RunButton, sameCell } from "./NotebookView";

describe("RunButton (T-713)", () => {
  const props = (running: number | null, got: string[]) => ({ i: 1, running, onRun: () => got.push("run"), onStop: () => got.push("stop") });
  const html = (running: number | null) => renderToString(createElement(RunButton, props(running, [])));
  it("is Run when nothing runs, Stop on the running cell, and a disabled Run on the others", () => {
    expect(html(null)).toMatch(/<button type="button" aria-label="Run cell 2">Run<\/button>/);
    expect(html(1)).toMatch(/<button type="button" aria-label="Stop cell 2">Stop<\/button>/);
    expect(html(0)).toMatch(/<button type="button" disabled="" aria-label="Run cell 2">Run<\/button>/);
  });
  it("a press on the running cell stops it; otherwise it runs", () => {
    const got: string[] = [];
    const press = (running: number | null) => (RunButton(props(running, got)) as { props: { onClick: () => void } }).props.onClick();
    press(1);
    press(null);
    expect(got).toEqual(["stop", "run"]);
  });
});

const code = (source: string | string[], outputs?: unknown[]) => ({ cell_type: "code", source, ...(outputs ? { outputs } : {}) });

describe("sameCell", () => {
  const ask = { i: 1, src: "print(1)", kind: "code" as const };
  it("matches the cell that was asked about", () => {
    expect(sameCell(code("print(1)"), ask)).toBe(true);
    expect(sameCell(code(["print(1)"]), ask)).toBe(true);
  });
  it("does not match when the text, the kind or the cell itself changed", () => {
    expect(sameCell(code("print(2)"), ask)).toBe(false);
    expect(sameCell({ cell_type: "markdown", source: "print(1)" }, ask)).toBe(false);
    expect(sameCell(undefined, ask)).toBe(false);
  });
});

describe("needsAsk", () => {
  it("asks for a cell with text or saved outputs, not for an empty one", () => {
    expect(needsAsk(code("x = 1"))).toBe(true);
    expect(needsAsk(code("", [{ output_type: "stream" }]))).toBe(true);
    expect(needsAsk(code("  \n"))).toBe(false);
    expect(needsAsk(code("", []))).toBe(false);
  });
});
