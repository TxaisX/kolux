// D-08 (design audit): in a narrow pane header the split, expand and "+" buttons wait until the header is
// hovered or holds keyboard focus (the focused pane always shows them), so the status word and Approve keep their room. Menu and close always stay.
import { expect, test } from "vitest";

const fsName = "node:fs";
const read = async (rel: string): Promise<string> => ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL(rel, import.meta.url), "utf8");
const styles = await read("../styles.css");
const pane = await read("./TerminalPane.tsx");
const THREE = ['.pane-expand', '[data-testid="pane-new-session"]', '[data-testid="pane-split-right"]'];
const hide = styles.match(/@container \(max-width: 560px\) \{ \.pane:not\(([^)]*)\) \.pane-head[^{]*\{ display: none; \} \}/);

test("a narrow header hides split, expand and + until hover or focus, except in the focused pane; menu and close are not named", () => {
  const rule = styles.match(/@container \(max-width: 560px\) \{ \.pane:not\(\.focused, \.card\) \.pane-head:not\(:hover, :focus-within\) \.right :is\(([^)]*)\) \{ display: none; \} \}/);
  expect(rule).not.toBeNull();
  expect(rule![1].split(", ").sort()).toEqual(THREE);
  expect(pane).toContain('className="ib pane-expand"');
  expect(pane).toContain('data-testid="pane-split-right"');
  expect(pane).toContain('data-testid="pane-new-session"');
});

// F2: a Board card is narrow and never focused, and its Expand button is how the card opens its terminal.
test("Board cards are left out of the narrow hide rule, so a card keeps its Expand button", () => {
  expect(hide).not.toBeNull();
  expect(hide![1].split(", ")).toEqual(expect.arrayContaining([".focused", ".card"]));
  expect(pane).toContain("const onExpand = card ? card.onToggle : expand?.toggle;");
});

// F1: the three sit at the left end of the right-hand group, which is packed to its right end, so when they
// appear nothing that shows at rest (meter, Review plan, usage, menu, close) moves under the pointer. The
// rule must not depend on .focused: a pane takes focus on mousedown, so a focus-keyed order would move the
// menu between press and release.
test("in a narrow header the three come first, so showing them never moves the menu or close", () => {
  const order = styles.match(/@container \(max-width: 560px\) \{ \.pane:not\(([^)]*)\) \.pane-head \.right :is\(([^)]*)\) \{ order: -1; \} \}/);
  expect(order).not.toBeNull();
  expect(order![2].split(", ").sort()).toEqual(THREE);
  expect(order![1].split(", ")).toEqual([".card"]);
  // No other rule reorders anything in the header's right-hand group (the menu and close are plain .ib buttons).
  const reorders = styles.split("\n").filter((l) => /\.pane-head[^{]*\.right/.test(l) && /[{;]\s*order\s*:/.test(l));
  expect(reorders).toEqual([order![0]]);
  // The group is packed to its right end; that is what keeps the items at rest still.
  expect(styles).toContain(".pane:not(.editor) .pane-head .right { flex-shrink: 100; justify-content: flex-end; }");
  expect(pane).toContain('onMouseDown={onFocus}');
});
