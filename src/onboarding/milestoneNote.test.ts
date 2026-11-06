// ONB-011 rest (T-298-b): the first-run milestone times in the copied terminal diagnostics.
import { describe, expect, it } from "vitest";
import { milestoneBlock, withBlock, withMilestones } from "./milestoneNote";

const T = Date.UTC(2026, 9, 14, 8, 30, 5, 123);

describe("the milestone block", () => {
  it("lists the first, with a UTC time or not yet", () => {
    expect(milestoneBlock({ aiConnected: T })).toBe(
      "First milestones\n  AI connected: 2026-10-14T08:30:05Z",
    );
  });
  it("a profile with no record says so (it had its firsts before the wizard)", () => {
    expect(milestoneBlock(null)).toBe("First milestones: no record on this profile");
  });
  it("damaged times read as not yet, never as a date or a crash", () => {
    expect(milestoneBlock({ aiConnected: "soon" })).toBe("First milestones\n  AI connected: not yet");
  });
  it("only dates are written: no names, paths or text can come through", () => {
    expect(milestoneBlock({ aiConnected: { path: "C:/secret" } as never })).not.toContain("secret");
  });
});

describe("added to the diagnostics", () => {
  it("goes after the existing text, once, with one blank line between", () => {
    const out = withBlock("Kolux 0.1.0 diagnostics\nline\n\n", { aiConnected: T });
    expect(out.startsWith("Kolux 0.1.0 diagnostics\nline\n\nFirst milestones\n")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.match(/First milestones/g)).toHaveLength(1);
  });
  it("reads the record through guide_get's shape", async () => {
    const out = await withMilestones("text", async () => ({ firstRun: { milestones: { aiConnected: T } } }));
    expect(out).toContain("AI connected: 2026-10-14T08:30:05Z");
    expect(await withMilestones("text", async () => ({ firstRun: null }))).toContain("no record on this profile");
  });
  it("an unreadable record leaves the report as it was", async () => {
    expect(await withMilestones("text", async () => { throw new Error("store busy"); })).toBe("text");
  });
});
