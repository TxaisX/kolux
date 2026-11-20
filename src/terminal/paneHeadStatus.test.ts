// LV-3 (review 0.2.0): in a 6-pane grid the focused pane read "Rea..." (the "+" took the status word's room) and the
// worktree chip showed as an empty capsule once its label was hidden in a narrow cell.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import WorktreeChip from "../shell/WorktreeChip";

const fsName = "node:fs";
const read = async (rel: string): Promise<string> => ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL(rel, import.meta.url), "utf8");
const styles = await read("../styles.css");
const pane = await read("./TerminalPane.tsx");

test("LV-3: the status word has a floor, yet still shrinks so a long word gives way and Close never leaves", () => {
  expect(pane).toMatch(/<span className=\{`status state \$\{tone\}`\}/);
  expect(styles).toContain(".pane:not(.editor) .pane-head .status.state { min-width: min(6ch, 30%); }");
  expect(styles).toContain(".pane:not(.editor) .pane-head .status { flex-shrink: 10; }");
  expect(styles).not.toMatch(/\.status\.state \{[^}]*flex-shrink: 0/); // a status word that cannot shrink pushes the buttons out
});

test("LV-3: a worktree chip whose label is hidden collapses to its coloured dot, no empty capsule", () => {
  expect(styles).toMatch(/@container \(max-width: 340px\) \{ \.pane:not\(\.editor\) \.pane-head \.chip\.wt-chip \{[^}]*min-width: 0;[^}]*border-color: transparent;[^}]*background: none;[^}]*\} \}/);
});

const tag = (label: string) => ({ path: "C:/w/a", label, tip: label, color: "#08f", typed: true, isMain: false });

test("LV-3: a chip with an empty label is the dot alone (class bare, no empty .wt-text); a labelled one keeps its text", () => {
  const empty = renderToStaticMarkup(createElement(WorktreeChip, { tag: tag("  "), live: null }));
  expect(empty).toContain("wt-chip bare");
  expect(empty).toContain("wt-dot");
  expect(empty).not.toContain("wt-text");
  const named = renderToStaticMarkup(createElement(WorktreeChip, { tag: tag("main"), live: null }));
  expect(named).not.toContain("bare");
  expect(named).toContain('<span class="wt-text">main</span>');
  expect(styles).toMatch(/\.chip\.wt-chip\.bare \{[^}]*min-width: 0;[^}]*border-color: transparent;[^}]*background: none;[^}]*\}/);
});
