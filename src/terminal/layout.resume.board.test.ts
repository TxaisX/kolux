// START-02 (board test, hash-locked): a pane resumed with a saved conversation id that dies at once
// (non-zero exit, under 15 seconds, before any hook event) forgets that id and is marked
// "resume failed", so the next start is fresh instead of failing the same way for ever.
import { describe, expect, test } from "vitest";
import { RESUME_FAIL_MS, RESUME_FAILED_NOTE, isFailedResume, layoutOf, withoutFailedResume } from "./layout";
import paneRaw from "./TerminalPane.tsx?raw";
import windowRaw from "../shell/window/Pane.tsx?raw";
import propsRaw from "../shell/window/terminalProps.ts?raw";

const base = { resumed: true, reason: "exited" as const, code: 1 as number | null, aliveMs: 2_000, hookSeen: false };

describe("isFailedResume", () => {
  test("the window is fifteen seconds", () => {
    expect(RESUME_FAIL_MS).toBe(15_000);
  });

  test("a resumed pane that exits non-zero quickly before any hook is a failed resume", () => {
    expect(isFailedResume(base)).toBe(true);
    expect(isFailedResume({ ...base, code: 2 })).toBe(true);
    expect(isFailedResume({ ...base, code: -1 })).toBe(true);
    expect(isFailedResume({ ...base, aliveMs: 0 })).toBe(true);
    expect(isFailedResume({ ...base, aliveMs: 14_999 })).toBe(true);
    expect(isFailedResume({ ...base, outcome: "exited" })).toBe(true);
  });

  test("exactly fifteen seconds or more is not a failed resume", () => {
    expect(isFailedResume({ ...base, aliveMs: 15_000 })).toBe(false);
    expect(isFailedResume({ ...base, aliveMs: 15_001 })).toBe(false);
    expect(isFailedResume({ ...base, aliveMs: 600_000 })).toBe(false);
  });

  test("a clean or unknown exit code is not a failed resume", () => {
    expect(isFailedResume({ ...base, code: 0 })).toBe(false);
    expect(isFailedResume({ ...base, code: null })).toBe(false);
  });

  test("a hook event seen means the conversation was reached", () => {
    expect(isFailedResume({ ...base, hookSeen: true })).toBe(false);
  });

  test("a pane that was not resumed never counts", () => {
    expect(isFailedResume({ ...base, resumed: false })).toBe(false);
  });

  test("an exit Kolux could not verify is not a failed resume", () => {
    expect(isFailedResume({ ...base, outcome: "unverifiable" })).toBe(false);
  });

  test("a nonsense running time is not a failed resume", () => {
    expect(isFailedResume({ ...base, aliveMs: Number.NaN })).toBe(false);
    expect(isFailedResume({ ...base, aliveMs: -5 })).toBe(false);
  });
});

type P = {
  key: number;
  cwd: string | null;
  branch: string | null;
  agent: "claude";
  agentId?: string;
  program: string | null;
  args: string[];
  session?: string;
  sessionListed?: boolean;
  resumed?: boolean;
  resumeFailed?: true;
  group?: number;
  title?: string;
  account?: string | null;
  pinned?: boolean;
};
const pane = (key: number, extra: Partial<P> = {}): P => ({ key, cwd: "C:\\w\\a", branch: "main", agent: "claude", agentId: "claude", program: "claude", args: ["--resume", `s-${key}`], ...extra });

describe("withoutFailedResume", () => {
  test("clears the session and marks the pane", () => {
    const panes = [pane(1, { session: "s-1", group: 1, title: "Claude", account: "acct-1", resumed: true })];
    const out = withoutFailedResume(panes, 1);
    expect(out).toHaveLength(1);
    expect(out[0].session).toBeUndefined();
    expect("session" in out[0]).toBe(false);
    expect(out[0].resumeFailed).toBe(true);
    // everything else on the pane is kept as it was
    expect(out[0]).toMatchObject({ key: 1, cwd: "C:\\w\\a", branch: "main", agent: "claude", agentId: "claude", program: "claude", group: 1, title: "Claude", account: "acct-1" });
    // the input is not mutated
    expect(panes[0].session).toBe("s-1");
    expect("resumeFailed" in panes[0]).toBe(false);
  });

  test("a listed guess goes too", () => {
    const out = withoutFailedResume([pane(1, { session: "s-1", sessionListed: true })], 1);
    expect("session" in out[0]).toBe(false);
    expect(out[0].sessionListed).toBeFalsy();
    expect(out[0].resumeFailed).toBe(true);
  });

  test("only that pane changes: other panes, their order and their objects are untouched", () => {
    const a = pane(1, { session: "s-1", group: 1 });
    const b = pane(2, { session: "s-2", group: 1 });
    const c = pane(3, { session: "s-3", group: 3, pinned: true });
    const out = withoutFailedResume([a, b, c], 2);
    expect(out.map((p) => p.key)).toEqual([1, 2, 3]);
    expect(out[0]).toBe(a);
    expect(out[2]).toBe(c);
    expect(out[0].session).toBe("s-1");
    expect(out[2].session).toBe("s-3");
    expect(out[1].group).toBe(1);
  });

  test("is idempotent", () => {
    const once = withoutFailedResume([pane(1, { session: "s-1" }), pane(2, { session: "s-2" })], 1);
    const twice = withoutFailedResume(once, 1);
    expect(twice).toEqual(once);
    expect(twice[0]).toBe(once[0]);
  });

  test("an unknown key changes nothing", () => {
    const panes = [pane(1, { session: "s-1" })];
    const out = withoutFailedResume(panes, 9);
    expect(out).toEqual(panes);
    expect(out[0]).toBe(panes[0]);
  });

  test("the next save writes no session and no mark, so the next start is fresh", () => {
    const panes = withoutFailedResume([pane(1, { session: "s-1" }), pane(2, { session: "s-2" })], 1);
    const l = layoutOf(panes, { 1: 1 }, 1, "C:\\w\\a", {});
    expect(l.panes[0]).not.toHaveProperty("session");
    expect(l.panes[0]).not.toHaveProperty("resumeFailed");
    expect(l.panes[1].session).toBe("s-2");
  });
});

const code = (raw: string) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("START-02 wiring", () => {
  test("the pane decides with isFailedResume on exit and tells the window", () => {
    const pane = code(paneRaw);
    expect(pane).toMatch(/import\s*\{[^}]*\bisFailedResume\b[^}]*\}\s*from\s*"\.\/layout"/);
    expect(pane).toMatch(/onResumeFailed\?:\s*\(\)\s*=>\s*void/);
    expect(pane).toMatch(/isFailedResume\(/);
    expect(pane).toMatch(/RESUME_FAILED_NOTE/);
    // the decision sits in the exit listener
    const at = pane.indexOf("onTerminalExit<");
    expect(at).toBeGreaterThan(-1);
    expect(pane.slice(at, at + 6000)).toMatch(/isFailedResume\(/);
  });

  test("the window forgets the session with withoutFailedResume", () => {
    const win = code(windowRaw);
    expect(win).toMatch(/withoutFailedResume\(/);
    expect(win).toMatch(/onResumeFailed=\{/);
    expect(code(propsRaw)).toMatch(/onResumeFailed:\s*"same"/);
  });

  test("the note is plain words", () => {
    expect(RESUME_FAILED_NOTE).toBe("The saved conversation could not be reopened. The next start begins a fresh one.");
  });
});
