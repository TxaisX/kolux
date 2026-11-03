import { describe, expect, it } from "vitest";
import { clampMenu, menuKeyTarget } from "./menuNav";

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

describe("popup menu keys", () => {
  const rows = ["a", "b", "c"];
  it("moves between the rows while focus is inside the menu", () => {
    expect(menuKeyTarget(rows, "a", true, "ArrowDown")).toBe(1);
    expect(menuKeyTarget(rows, "a", true, "ArrowUp")).toBe(2);
    expect(menuKeyTarget(rows, "b", true, "End")).toBe(2);
  });
  it("leaves the key alone once focus is outside the menu", () => {
    expect(menuKeyTarget(rows, "editor", false, "ArrowDown")).toBeNull();
    expect(menuKeyTarget(rows, "editor", false, "Home")).toBeNull();
  });
  it("ignores keys that are not menu keys", () => {
    expect(menuKeyTarget(rows, "a", true, "x")).toBeNull();
  });
});
