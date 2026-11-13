// VIEW-026 class collision: the Board screen's grid is `.board`; the workspace board dialog must not share that class,
// or board.css (flex column) turns the screen's cards into 2x29 px slivers once it loads.
import { expect, test } from "vitest";

// Vitest returns "" for a .css import, so the stylesheets are read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const boardCss = nodeFs.readFileSync(new URL("../board.css", import.meta.url), "utf8");
const screenCss = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const boardTsx = nodeFs.readFileSync(new URL("../WorkspaceBoard.tsx", import.meta.url), "utf8");

const selectors = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|})\s*([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));

test("board.css has no rule on the bare .board class (it belongs to the Board screen in styles.css)", () => {
  const bare = selectors(boardCss).filter((s) => /^\.board(?![\w-])/.test(s));
  expect(bare).toEqual([]);
  expect(selectors(screenCss).some((s) => /^\.board(?![\w-])/.test(s))).toBe(true);
});

// The board is a src/ui Dialog, drawn in a portal only once it is open, so its class is read from the call site here;
// WorkspaceBoard.dom.test.tsx opens it on a real DOM and reads the same class there.
test("the workspace board dialog is ws-board, not board", () => {
  const site = /<Dialog\b[^>]*label="Workspace statuses"[^>]*>/.exec(boardTsx)?.[0] ?? "";
  const cls = /className="([^"]*)"/.exec(site)?.[1].split(/\s+/) ?? [];
  expect(cls).toContain("ws-board");
  expect(cls).not.toContain("board");
  expect(selectors(boardCss)).toContain(".ws-board");
});
