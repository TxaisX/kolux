import { describe, expect, it } from "vitest";
import { pageFromText, pageTops } from "./pdfNav";

describe("pageTops", () => {
  it("puts the gap above every page and gives the old reduce's numbers", () => {
    const heights = [100, 200, 50, 75.5];
    const gap = 8;
    const old = heights.map((_, i) => heights.slice(0, i).reduce((a, h) => a + h + gap, gap));
    expect(pageTops(heights, gap)).toEqual(old);
    expect(pageTops(heights, gap)).toEqual([8, 116, 324, 382]);
  });
  it("is empty for no pages and linear for many", () => {
    expect(pageTops([], 8)).toEqual([]);
    const many = pageTops(Array.from({ length: 20000 }, () => 10), 2);
    expect(many[19999]).toBe(2 + 19999 * 12);
  });
});

describe("pageFromText", () => {
  it("reads a whole number and keeps it inside the document", () => {
    expect(pageFromText("3", 10)).toBe(3);
    expect(pageFromText(" 7 ", 10)).toBe(7);
    expect(pageFromText("0", 10)).toBe(1);
    expect(pageFromText("99", 10)).toBe(10);
  });
  it("refuses text that is not a page number", () => {
    expect(pageFromText("", 10)).toBeNull();
    expect(pageFromText("2.5", 10)).toBeNull();
    expect(pageFromText("-1", 10)).toBeNull();
    expect(pageFromText("abc", 10)).toBeNull();
    expect(pageFromText("3", 0)).toBeNull();
  });
});
