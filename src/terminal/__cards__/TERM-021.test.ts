// TERM-021 acceptance: the status word's tone follows what the agent needs; a finished agent is done, an idle plain shell neutral.
import { expect, test } from "vitest";
import { headerOf, titleState } from "../status";

// the stylesheet is stripped from imports under vitest, so it is read from disk (no node types in tsc: dynamic specifier)
const fsName = "node:fs";
const css: string = ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("box 1: a permission prompt flips Working to the attention tone in one status update and marks the pane as needing the user", () => {
  const before = headerOf("claude", "running", undefined, false, null, 0, "working");
  expect(before).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  // one update later, the hook says permission: same call, new answer
  const after = headerOf("claude", "running", undefined, false, null, 0, "permission");
  expect(after).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  // the other waiting states take the same tone
  for (const hook of ["waiting", "blocked"] as const) expect(headerOf("claude", "running", undefined, false, null, 0, hook)).toMatchObject({ tone: "attention", needsYou: true });
  // with no hook, the title the program sets stands in (STAT-033)
  expect(headerOf("claude", "running", undefined, false, null, 0, titleState("Allow this tool?") ?? undefined)).toMatchObject({ tone: "attention", needsYou: true });
  // the header span is `status ${tone}` (MIRROR TerminalPane.tsx:1543) and the stylesheet tints it
  expect(css).toMatch(/\.pane-head \.status\.attention \{ color: var\(--working-icon\); \}/);
  expect(css).toMatch(/\.pane-head \.status\.working \{ color: var\(--working\); \}/);
});

test("box 2: a finished agent shows the done tone; an idle plain shell shows the neutral tone", () => {
  expect(headerOf("claude", "running", undefined, false, 1000, 2000, "done")).toMatchObject({ word: "Done", tone: "done", needsYou: false });
  expect(headerOf("claude", "running", undefined, false, 1000, 2000, "done")).toMatchObject({ word: "Done", tone: "done", needsYou: false });
  // DT-C52 (round 3): a program that exited reads Stopped, neutral, as on the Board and in the Inbox
  expect(headerOf("claude", "ended", 0, false, 1000, 2000)).toMatchObject({ word: "Stopped", tone: "", needsYou: false });
  expect(css).toMatch(/\.pane-head \.status\.done \{ color: var\(--done\); \}/);
  const shell = headerOf("shell", "running", undefined, false, null, 0);
  expect(shell.tone).toBe("");
  expect(shell.needsYou).toBe(false);
  // neutral: the base rule is the muted colour, and no tone rule applies to an empty tone
  expect(css).toMatch(/\.pane-head \.status \{ font-weight: 500; color: var\(--fg-muted\); \}/);
  expect(headerOf("claude", "ended", 3, false, null, 0).tone).toBe("");
});
