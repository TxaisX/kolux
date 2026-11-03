import { describe, expect, it } from "vitest";
import { POLL_MS, copyLabel, copyText, outside, pollMs, selfClearing } from "./ux";

describe("copy", () => {
  it("reports copied when the clipboard takes the text", async () => {
    let got = "";
    expect(await copyText(async (t) => void (got = t), "hi")).toBe("copied");
    expect(got).toBe("hi");
  });
  it("reports failed, not a throw, when the clipboard refuses", async () => {
    expect(await copyText(() => Promise.reject(new Error("denied")), "hi")).toBe("failed");
  });
  it("labels each state", () => {
    expect(copyLabel(null, "Copy diff")).toBe("Copy diff");
    expect(copyLabel("copied", "Copy diff")).toBe("Copied");
    expect(copyLabel("failed", "Copy")).toBe("Copy failed");
  });
});

describe("polling and notes", () => {
  it("does not poll while the page is hidden", () => {
    expect(pollMs(true)).toBeNull();
    expect(pollMs(false)).toBe(POLL_MS);
  });
  it("clears every note except the one the turn ending clears", () => {
    expect(selfClearing(null, "Stopping")).toBe(false);
    expect(selfClearing("Stopping", "Stopping")).toBe(false);
    expect(selfClearing("Other", "Stopping")).toBe(true);
  });
  it("tells a pointer inside a menu from one outside", () => {
    const inner = {} as Node;
    const box = { contains: (n: Node) => n === inner };
    expect(outside(box, inner)).toBe(false);
    expect(outside(box, {} as Node)).toBe(true);
    expect(outside(null, inner)).toBe(false);
  });
});
