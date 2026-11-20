// LV-3 (review 0.2.0): in a 6-pane grid the focused pane read "Rea..." (the "+" took the status word's room) and the
// worktree chip showed as an empty capsule once its label was hidden in a narrow cell.
import { expect, test } from "vitest";

const fsName = "node:fs";
const read = async (rel: string): Promise<string> => ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL(rel, import.meta.url), "utf8");
const styles = await read("../styles.css");
const pane = await read("./TerminalPane.tsx");

test("LV-3: the status word keeps its width while the right-hand buttons can still give way", () => {
  expect(pane).toMatch(/<span className=\{`status state \$\{tone\}`\}/);
  expect(styles).toContain("@container (min-width: 205px) { .pane:not(.editor) .pane-head .status.state { flex-shrink: 0; } }");
});

test("LV-3: a worktree chip whose label is hidden collapses to its coloured dot, no empty capsule", () => {
  expect(styles).toMatch(/@container \(max-width: 340px\) \{ \.pane:not\(\.editor\) \.pane-head \.chip\.wt-chip \{[^}]*min-width: 0;[^}]*border-color: transparent;[^}]*background: none;[^}]*\} \}/);
});
