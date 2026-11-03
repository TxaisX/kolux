// STAT-055 / SAFE-025 (T-715): before a workspace is removed, the page asks about its kolux.yaml
// archive script; Rust runs it during the removal only when trusted. Every removal caller asks first.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const calls: [string, Record<string, unknown>][] = [];
let need: unknown = null;
let broken = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (broken) throw new Error("no such worktree");
    return cmd === "script_trust_needed" ? need : null;
  },
}));

const { answerFirst, askArchive, hostMounted, waiting } = await import("./TrustPrompt");
const ASK = { kind: "archive", script: "make clean", changed: false, project: "web" };
let mounted = false;

afterEach(() => {
  if (mounted) hostMounted(false);
  mounted = false;
  calls.length = 0;
  need = null;
  broken = false;
});

test("T-715: an untrusted archive script is asked about, and Run once records it for Rust", async () => {
  need = ASK;
  hostMounted((mounted = true));
  const run = askArchive("C:/ws/a");
  await vi.waitFor(() => expect(waiting()).toBe(1));
  answerFirst("once");
  expect(await run).toBe(true);
  expect(calls).toEqual([
    ["script_trust_needed", { path: "C:/ws/a", kind: "archive" }],
    ["script_trust_grant", { path: "C:/ws/a", kind: "archive", script: "make clean", always: false, root: null }],
  ]);
});

test("T-715: with no prompt, or a question that fails, nothing is approved and the removal still goes on", async () => {
  need = ASK;
  expect(await askArchive("C:/ws/b")).toBe(false);
  expect(calls.map((c) => c[0])).toEqual(["script_trust_needed"]);
  broken = true;
  expect(await askArchive("C:/ws/c")).toBe(false);
});

test("T-715: every removal command the page sends is preceded by its own archive ask", () => {
  const src = join(__dirname, "..");
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|__cards__/.test(f));
  const remove = /"(workspace_remove|workspace_remove_many|cleanup_remove)"/g;
  const callers: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(src, f), "utf8");
    let from = 0;
    for (const m of text.matchAll(remove)) {
      callers.push(f.replace(/\\/g, "/"));
      // between the previous removal command and this one there is an ask
      expect(text.slice(from, m.index), `${f} at ${m.index}`).toContain("await askArchive(");
      from = m.index + m[0].length;
    }
  }
  // the panel's two (one workspace, a parent with its children), the picked bar, the cleanup dialog, Space
  expect(callers.sort()).toEqual(["projects/ProjectsPanel.tsx", "projects/ProjectsPanel.tsx", "projects/bulkRemove.ts", "shell/ProjectsExtras.tsx", "space/SpaceView.tsx"]);
});
