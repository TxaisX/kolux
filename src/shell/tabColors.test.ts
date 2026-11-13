import { describe, expect, it } from "vitest";
import { colorOf, setTabColor, TAB_COLORS } from "../terminal/tabColor";
import { tabMarksOf, type MarksFrom } from "./window/paneTab";

const none: MarksFrom = { pinned: new Set(), tabColors: {}, running: {}, unreadPanes: new Set(), hook: {}, status: undefined, context: undefined, capped: true, claude: [], codex: null };
const pane = (key: number) => ({ key, agent: "shell" as const });

describe("TERM-133 colour-code a tab", () => {
  it("offers ten choices in the card order: none, then nine colours", () => {
    expect(TAB_COLORS.map((c) => c.id)).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "teal", "grey"]);
    expect(new Set(TAB_COLORS.map((c) => c.css)).size).toBe(9);
  });
  // One session per cell (2026-11-12): the dot is drawn in the pane's header (terminal/TabMarks.tsx).
  it("Green puts a dot on that pane's header only; None takes it away", () => {
    const green = setTabColor({}, 7, "green");
    expect(tabMarksOf(pane(7), { ...none, tabColors: green }).color).toEqual({ label: "Green", css: TAB_COLORS.find((c) => c.id === "green")!.css });
    expect(tabMarksOf(pane(8), { ...none, tabColors: green }).color).toBeNull();
    const cleared = setTabColor(green, 7, null);
    expect(tabMarksOf(pane(7), { ...none, tabColors: cleared }).color).toBeNull();
    expect(colorOf(cleared, 7)).toBeNull();
  });
  it("the dot is the only thing the colour changes: the terminal's own colours are untouched", () => {
    expect(Object.keys(tabMarksOf(pane(1), { ...none, tabColors: { 1: "grey" } }).color!)).toEqual(["label", "css"]);
  });
});
