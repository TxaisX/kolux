// D-08 (design audit): in a narrow pane header the split, expand and "+" buttons wait until the header is
// hovered or holds keyboard focus (the focused pane always shows them), so the status word and Approve keep their room. Menu and close always stay.
import { expect, test } from "vitest";

const fsName = "node:fs";
const read = async (rel: string): Promise<string> => ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL(rel, import.meta.url), "utf8");
const styles = await read("../styles.css");
const pane = await read("./TerminalPane.tsx");

test("a narrow header hides split, expand and + until hover or focus, except in the focused pane; menu and close are not named", () => {
  const rule = styles.match(/@container \(max-width: 560px\) \{ \.pane:not\(\.focused\) \.pane-head:not\(:hover, :focus-within\) \.right :is\(([^)]*)\) \{ display: none; \} \}/);
  expect(rule).not.toBeNull();
  expect(rule![1].split(", ").sort()).toEqual(['.pane-expand', '[data-testid="pane-new-session"]', '[data-testid="pane-split-right"]']);
  expect(pane).toContain('className="ib pane-expand"');
  expect(pane).toContain('data-testid="pane-split-right"');
  expect(pane).toContain('data-testid="pane-new-session"');
});
