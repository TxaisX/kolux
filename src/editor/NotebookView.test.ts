import { describe, expect, it } from "vitest";
import { needsAsk, sameCell } from "./NotebookView";

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
