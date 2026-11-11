// The Explorer keeps its content search mounted and hides it until Search is on (Explorer.tsx hands it
// `hidden`). Its own `display: flex` beats the hidden attribute unless the stylesheet says otherwise; without
// that rule the search boxes and an empty results area took half the panel, above the file list.
import { expect, test } from "vitest";
import search from "./ContentSearch.tsx?raw";

// A stylesheet imported through the bundler comes back empty under the test runner, so it is read from disk (as look/glass.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./editor-extras.css", import.meta.url), "utf8");

test("the hidden content search is really hidden: the stylesheet lets the hidden attribute win", () => {
  expect(search).toMatch(/className="content-search" hidden=\{hidden\}/);
  expect(css).toMatch(/\.content-search\s*\{[^}]*display:\s*flex/);
  expect(css).toMatch(/\.content-search\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});
