// The sidebar's dialogs and the status bar's pop-ups are read when first opened, not at start (PKG-6): none of the
// first-load files may import them statically again, or the build's first load grows back by about 40 kB.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const heavy = [
  ["projects/ProjectsPanel.tsx", /from "\.\/(AddProject|ScanRepos|StartGit|ImportSetup|KeptBranches|IconPicker)"/],
  ["chrome/StatusBar.tsx", /from "\.\.\/status\/ResourceManager"/],
  ["chrome/LayoutStrip.tsx", /from "\.\.\/usage\/WorkspaceSpend"/],
  ["crash.tsx", /from "\.\/feedback\/FeedbackDialog"/],
  ["recovery/ScreenBoundary.tsx", /from "\.\.\/feedback\/FeedbackDialog"/],
] as const;

test.each(heavy)("%s does not import the code that opens on a click", (file, pattern) => {
  const src = read(file).split("\n").filter((l) => /^import [^t]/.test(l) || /^import \{/.test(l)).join("\n");
  expect(src).not.toMatch(pattern);
});

test("the dialogs in menus.tsx are the real ones", async () => {
  const m = await import("./menus");
  for (const n of ["AddProject", "ScanRepos", "StartGit", "ImportSetup", "KeptBranches", "IconPicker", "ResourceManager", "WorkspaceSpend"]) expect(typeof (m as Record<string, unknown>)[n]).toBe("function");
});
