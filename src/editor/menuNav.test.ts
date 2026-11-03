import { describe, expect, it } from "vitest";
import { clampMenu } from "./menuNav";

describe("popup menu placement", () => {
  it("keeps a menu that fits where it was asked for", () => {
    expect(clampMenu(100, 50, 200, 80, 1000, 800)).toEqual({ left: 100, top: 50 });
  });
  it("pulls a menu back from the right and bottom edges", () => {
    expect(clampMenu(950, 790, 200, 80, 1000, 800)).toEqual({ left: 792, top: 712 });
  });
  it("never leaves the top-left corner either", () => {
    expect(clampMenu(-30, -5, 200, 80, 1000, 800)).toEqual({ left: 8, top: 8 });
  });
});
