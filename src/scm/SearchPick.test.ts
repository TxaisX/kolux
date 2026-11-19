import { describe, expect, it } from "vitest";
import { pickStep } from "./SearchPick";

describe("pickStep: arrows between the box and its suggestions", () => {
  it("goes from the box to the first suggestion and down the list, stopping at the last", () => {
    expect(pickStep(3, -1, "ArrowDown")).toBe(0);
    expect(pickStep(3, 0, "ArrowDown")).toBe(1);
    expect(pickStep(3, 2, "ArrowDown")).toBe(2);
  });
  it("goes back up to the box from the first suggestion", () => {
    expect(pickStep(3, 2, "ArrowUp")).toBe(1);
    expect(pickStep(3, 0, "ArrowUp")).toBe(-1);
    expect(pickStep(3, -1, "ArrowUp")).toBeNull();
  });
  it("does nothing with no suggestions, and leaves other keys (and Home and End in the box) alone", () => {
    expect(pickStep(0, -1, "ArrowDown")).toBeNull();
    expect(pickStep(3, 1, "Home")).toBe(0);
    expect(pickStep(3, 1, "End")).toBe(2);
    expect(pickStep(3, -1, "Home")).toBeNull();
    expect(pickStep(3, 1, "a")).toBeNull();
  });
});
