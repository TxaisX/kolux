import { describe, expect, it } from "vitest";
import { commentBlocks, inline, itemFromPaste, safeHref } from "./details";

describe("PROJ-060 workspace details", () => {
  it("pasting a GitHub address into the linked-item field keeps the clean address; other text stays as typed", () => {
    expect(itemFromPaste(" https://www.github.com/acme/app/pull/12/files?x=1 ")).toBe("https://github.com/acme/app/pull/12");
    expect(itemFromPaste("https://git.corp.example/acme/app/issues/5")).toBe("https://git.corp.example/acme/app/issues/5");
    expect(itemFromPaste(" #7 ")).toBe("#7");
  });
  it("only web addresses open from a comment", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("file:///C:/x")).toBeNull();
    expect(inline("see [bad](javascript:alert(1)) now")).toEqual([{ t: "text", text: "see [bad](javascript:alert(1)) now" }]);
  });
  it("a comment shows as headings, links and images in compact blocks", () => {
    expect(commentBlocks("## Plan\nsee [spec](https://example.com)\nand ![shot](https://example.com/a.png)\n\nlast line")).toEqual([
      { kind: "heading", level: 2, spans: [{ t: "text", text: "Plan" }] },
      { kind: "para", spans: [{ t: "text", text: "see " }, { t: "link", text: "spec", href: "https://example.com" }, { t: "text", text: " and " }, { t: "image", alt: "shot", href: "https://example.com/a.png" }] },
      { kind: "para", spans: [{ t: "text", text: "last line" }] },
    ]);
    expect(commentBlocks("  \n ")).toEqual([]);
  });
});
