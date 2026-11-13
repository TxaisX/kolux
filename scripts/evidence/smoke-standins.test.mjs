// The agent stand-ins smoke.mjs puts in front of the app's PATH: what the generated .cmd files must contain, so a
// stand-in that stops reading its pane (or stops posting Claude's hook events) fails here instead of in a smoke run
// that takes a build and 20 minutes to finish.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS, agentLog, standinFile, standinsOn, writeStandins } from "./smoke-standins.mjs";

// vitest locally, node:test in CI without it (same shape as scripts/stress/run-all.test.mjs).
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
const expect = (v) => ({ toContain: (x) => assert.ok(String(v).includes(x), `${JSON.stringify(String(v).slice(0, 120))} does not contain ${x}`), toBe: (x) => assert.equal(v, x), toEqual: (x) => assert.deepEqual(v, x), toThrow: (re) => assert.throws(v, re) });

const dir = () => mkdtempSync(join(tmpdir(), "smoke-standins-"));
const cmd = (folder, id) => readFileSync(join(folder, `${id}.cmd`), "utf8");

test("writes one .cmd per agent, all four the New session menu offers", () => {
  const folder = dir();
  try {
    const paths = writeStandins({ dir: folder, marks: join(folder, "marks"), repo: "C:/work/repo" });
    expect(Object.keys(paths).sort()).toEqual(["claude", "codex", "grok", "opencode"]);
    for (const a of AGENTS) expect(cmd(folder, a.id)).toContain(`Kolux smoke stand-in for ${a.label}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("every stand-in reads its pane line by line and logs what arrived", () => {
  const folder = dir();
  try {
    const marks = join(folder, "marks");
    for (const a of AGENTS) standinFile(a.id, { dir: folder, marks, repo: "C:/work/repo" });
    for (const a of AGENTS) {
      const text = cmd(folder, a.id);
      expect(text).toContain("set /p L=");
      expect(text).toContain(":loop");
      expect(text).toContain(`>>"${agentLog(marks, a.id)}" echo %L%`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("claude's stand-in posts the two hook events through the endpoint file, like the installed hook", () => {
  const folder = dir();
  try {
    standinFile("claude", { dir: folder, marks: join(folder, "marks"), repo: "C:/work/repo", });
    const text = cmd(folder, "claude");
    expect(text).toContain("KOLUX_HOOK_ENDPOINT");
    expect(text).toContain("X-Kolux-Token: %KT%");
    expect(text).toContain("%KP%/claude");
    expect(text).toContain("session-start.json");
    expect(text).toContain("prompt.json");
    const event = JSON.parse(readFileSync(join(folder, "prompt.json"), "utf8"));
    expect(event.hook_event_name).toBe("UserPromptSubmit");
    expect(event.cwd).toBe("C:/work/repo");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("refuses an agent it has no stand-in for", () => {
  const folder = dir();
  try {
    expect(() => standinFile("amp", { dir: folder, marks: join(folder, "marks"), repo: "C:/work/repo" })).toThrow(/no stand-in/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("standinsOn points the named agents' command at the stand-ins and puts the old settings back", async () => {
  const folder = dir();
  const calls = [];
  const invoke = async (cmdName, args) => {
    calls.push([cmdName, args]);
    if (cmdName === "get_settings") return { agentOptions: { claude: { args: "--verbose" }, codex: { command: "C:/real/codex.cmd" } }, needsStrip: true };
    return null;
  };
  try {
    const restore = await standinsOn(invoke, { dir: folder, marks: join(folder, "marks"), repo: "C:/work/repo" }, ["claude", "codex"]);
    const set = calls[1][1].set.agentOptions;
    expect(set.claude.command).toContain("claude.cmd");
    expect(set.claude.args).toBe("--verbose");
    expect(set.codex.command).toContain("codex.cmd");
    await restore();
    expect(calls[2][1].set.agentOptions).toEqual({ claude: { args: "--verbose" }, codex: { command: "C:/real/codex.cmd" } });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("standinsOn removes agentOptions it created when the profile had none", async () => {
  const folder = dir();
  const calls = [];
  const invoke = async (cmdName, args) => {
    calls.push([cmdName, args]);
    return cmdName === "get_settings" ? { needsStrip: true } : null;
  };
  try {
    const restore = await standinsOn(invoke, { dir: folder, marks: join(folder, "marks"), repo: "C:/work/repo" });
    expect(calls[1][1].set.agentOptions.claude.command).toContain("claude.cmd");
    await restore();
    expect(calls[2][1]).toEqual({ set: {}, remove: ["agentOptions"] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
