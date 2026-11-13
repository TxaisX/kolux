// One session per cell (PR #255): writes src/terminal/__fixtures__/layout-<ref>.json, the saved layout of one window
// written by the real layoutOf of an older Kolux, back when a grid cell could hold several tabs. Each fixture is made by
// that version's own code (its src/terminal/layout.ts and what it imports, read out of git and bundled by vite), so the
// migration test (src/terminal/layoutMigration.test.ts) reads layouts exactly as those versions wrote them, not a shape
// typed by hand. The window it saves is the same for every version: see SCENE below.
// Run from the repo root: node scripts/layout-fixtures.mjs   (needs git and tar on PATH; writes only the fixtures)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "terminal", "__fixtures__");

/** The versions: the first release, the last release before the change, and wave-1 as it stood before it. */
export const REFS = [
  { name: "v0.1.1", ref: "v0.1.1" },
  { name: "v0.1.14", ref: "v0.1.14" },
  { name: "wave-1", ref: "82f3643e" },
];

const APP = "C:/fixture/app";
const LIB = "C:/fixture/lib";
const TEAM_WT = "C:/fixture/app-wt-1";
const shell = { agent: "shell", program: null, args: [] };

/**
 * The live window, in the shape the old window kept its panes: tabs share a cell through `group` (the key of the
 * cell's first pane, which itself carries no group), `activeTab` names each cell's tab in front, `marks` holds the pins
 * and colours. Grid of the app folder: a cell of five tabs (two agents with sessions, a file, a staged diff, a named
 * shell; pins and colours on three of them), an empty chooser cell (never started), a lone coloured shell, and a cell of
 * a preview, a named shell and a check (a check is never saved, by every version). A team agent in a worktree shown in
 * the app grid, with a shell tab of its own. The lib folder (stacked) holds one cell of three tabs.
 */
export const SCENE = {
  panes: [
    { key: 1, cwd: APP, branch: "main", agent: "claude", agentId: "claude", program: "claude", args: ["--model", "x"], session: "11111111-aaaa-4bbb-8ccc-000000000001", account: null, title: "Fix login" },
    { key: 2, cwd: APP, branch: "main", ...shell, seats: [{ agent: "claude" }] },
    { key: 3, cwd: APP, branch: "main", ...shell, title: "logs" },
    { key: 4, cwd: APP, branch: "main", ...shell, kind: "preview", path: `${APP}/docs/guide.md`, group: 4 },
    { key: 5, cwd: APP, branch: "main", agent: "codex", agentId: "codex", program: "codex", args: [], session: "thr-5", account: "work", group: 1 },
    { key: 6, cwd: APP, branch: "main", ...shell, kind: "editor", path: `${APP}/README.md`, title: "README.md", group: 1 },
    { key: 7, cwd: APP, branch: "main", ...shell, kind: "diff", path: `${APP}/src/login.ts`, staged: true, group: 1 },
    { key: 8, cwd: APP, branch: "main", ...shell, title: "server", group: 1 },
    { key: 9, cwd: APP, branch: "main", ...shell, title: "tests", group: 4 },
    { key: 10, cwd: APP, branch: "main", ...shell, kind: "check", check: { name: "ci" }, group: 4 },
    { key: 11, cwd: LIB, branch: "dev", agent: "grok", agentId: "grok", program: "grok", args: [], title: "lib agent" },
    { key: 12, cwd: LIB, branch: "dev", ...shell, group: 11 },
    { key: 13, cwd: LIB, branch: "dev", ...shell, kind: "changes", group: 11 },
    { key: 14, cwd: TEAM_WT, view: APP, branch: "team-1", agent: "claude", agentId: "claude", program: "claude", args: [], session: "11111111-aaaa-4bbb-8ccc-000000000014" },
    { key: 15, cwd: TEAM_WT, view: APP, branch: "team-1", ...shell, group: 14 },
  ],
  activeTab: { 1: 6, 4: 9, 11: 13, 14: 15 },
  focused: 6,
  activeDir: APP,
  stacked: { [LIB]: true },
  pinned: [1, 8, 12],
  colors: { 1: "blue", 3: "purple", 5: "green", 8: "red", 12: "teal" },
};

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...opts });

/** The `layoutOf` of version `ref`: its src/ read out of git into a scratch folder and bundled. */
async function layoutOfAt(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolux-layout-"));
  try {
    run("tar", ["-x", "-C", dir], { input: run("git", ["archive", "--format=tar", ref, "src"]) });
    const out = await build({
      configFile: false,
      logLevel: "silent",
      root: dir,
      build: { write: false, minify: false, lib: { entry: path.join(dir, "src", "terminal", "layout.ts"), formats: ["es"], fileName: "layout" } },
    });
    const chunk = (Array.isArray(out) ? out[0] : out).output.find((o) => o.type === "chunk" && o.isEntry);
    const file = path.join(dir, "layout.mjs");
    fs.writeFileSync(file, chunk.code);
    return { layoutOf: (await import(pathToFileURL(file).href)).layoutOf, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const { name, ref } of REFS) {
    const commit = run("git", ["rev-parse", `${ref}^{commit}`]).toString().trim();
    const { layoutOf, cleanup } = await layoutOfAt(ref);
    try {
      const s = SCENE;
      const saved = layoutOf(structuredClone(s.panes), { ...s.activeTab }, s.focused, s.activeDir, { ...s.stacked }, { pinned: new Set(s.pinned), colors: { ...s.colors } });
      const doc = { note: "Written by scripts/layout-fixtures.mjs with the layoutOf of the commit below; do not edit by hand.", ref, commit, savedLayout: saved };
      fs.writeFileSync(path.join(OUT, `layout-${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
      console.log(`layout-fixtures: ${name} (${commit.slice(0, 8)}): ${saved.panes.length} panes`);
    } finally {
      cleanup();
    }
  }
}
