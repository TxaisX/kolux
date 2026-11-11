// The sidebar's dialogs and the status bar's pop-ups are read when first opened, not at start (PKG-6): none of the
// first-load files may import them statically again, or the build's first load grows back by about 40 kB.
import { expect, test } from "vitest";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const read = (f: string) => nodeFs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const heavy = [
  ["projects/ProjectsPanel.tsx", /from "\.\/(AddProject|ScanRepos|StartGit|ImportSetup|KeptBranches|IconPicker|StatusEditorForm)"/],
  ["chrome/StatusBar.tsx", /from "\.\.\/status\/ResourceManager"/],
  ["chrome/LayoutStrip.tsx", /from "\.\.\/usage\/WorkspaceSpend"/],
  ["crash.tsx", /from "\.\/feedback\/FeedbackDialog"/],
  ["recovery/ScreenBoundary.tsx", /from "\.\.\/feedback\/FeedbackDialog"/],
] as const;

test.each(heavy)("%s does not import the code that opens on a click", (file, pattern) => {
  const src = read(file).split("\n").filter((l: string) => /^import [^t]/.test(l) || /^import \{/.test(l)).join("\n");
  expect(src).not.toMatch(pattern);
});

test("the dialogs in menus.tsx are the real ones", async () => {
  const m = await import("./menus");
  for (const n of ["AddProject", "ScanRepos", "StartGit", "ImportSetup", "KeptBranches", "IconPicker", "StatusEditor", "ResourceManager", "WorkspaceSpend"]) expect(typeof (m as Record<string, unknown>)[n]).toBe("function");
});
