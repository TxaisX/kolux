import { describe, expect, it } from "vitest";
import { tabStop } from "./CloseDialog";

describe("close dialog Tab trap", () => {
  it("wraps forward from the last button to the first", () => {
    expect(tabStop(3, 2, false)).toBe(0);
    expect(tabStop(3, 0, false)).toBe(1);
  });
  it("wraps backward from the first button to the last", () => {
    expect(tabStop(3, 0, true)).toBe(2);
    expect(tabStop(3, 2, true)).toBe(1);
  });
  it("enters the trap from outside at either end", () => {
    expect(tabStop(3, -1, false)).toBe(0);
    expect(tabStop(3, -1, true)).toBe(2);
  });
  it("has no stop while every button is off (a save is running)", () => {
    expect(tabStop(0, -1, false)).toBe(-1);
  });
});
