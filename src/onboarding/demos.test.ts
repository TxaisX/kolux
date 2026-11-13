// ONB-025 and the double-tap half of ONB-029 (T-322-b).
import { describe, expect, it } from "vitest";
import { createLoop, demoFor, framesOf, keysText, MAX_STEP_MS } from "./demos";
import { defaultsOnly, labelOf, resolve } from "../keys/keymap";
import { paletteKeys } from "./guide";

describe("a demo loop (ONB-025)", () => {
  it("steps through its frames in order and starts over after the last", () => {
    const l = createLoop(3, 1000);
    const seen: number[] = [];
    for (let t = 0; t <= 3500; t += 250) seen.push(l.tick(t, true));
    expect(seen.filter((v, i) => i === 0 || v !== seen[i - 1])).toEqual([0, 1, 2, 0]);
  });
  it("hidden time does not count: the same frame carries on when the window returns", () => {
    const l = createLoop(4, 1000);
    for (let t = 0; t <= 1500; t += 250) l.tick(t, true); // 1500 ms in: frame 1
    expect(l.frame()).toBe(1);
    expect(l.tick(2000, false)).toBe(1); // hidden
    expect(l.tick(60_000, false)).toBe(1); // still hidden a minute later
    expect(l.tick(60_250, true)).toBe(1); // back: the first reading only restarts the clock
    expect(l.tick(60_500, true)).toBe(1); // 250 ms on, same card
    expect(l.tick(61_000, true)).toBe(2); // and then it moves on
  });
  it("a stalled timer cannot jump the demo ahead", () => {
    const l = createLoop(4, 1000);
    l.tick(0, true);
    l.tick(30_000, true); // one reading 30 s later counts at most one step
    expect(l.frame()).toBe(Math.floor(MAX_STEP_MS / 1000));
  });
  it("a clock that goes backwards counts nothing", () => {
    const l = createLoop(2, 100);
    l.tick(1000, true);
    expect(l.tick(500, true)).toBe(0);
  });
});

describe("what the demos show (ONB-025)", () => {
  it("only the three demo stops carry one", () => {
    expect(["workspaces", "workbench", "statuses", "tasks", "terminal"].map(demoFor)).toEqual(["workspaces", "workbench", "statuses", null, null]);
  });
  it("on Windows the shortcuts read Ctrl, never a Cmd symbol", () => {
    for (const id of ["workspaces", "workbench", "statuses"] as const) {
      const text = framesOf(id, "win32").join(" ");
      expect(text).not.toMatch(/Cmd|⌘|⌥|⇧/);
    }
    expect(framesOf("workbench", "win32").join(" ")).toContain("Ctrl+Shift+J");
  });
  it("on a Mac the same demo reads Cmd", () => {
    expect(framesOf("workbench", "darwin").join(" ")).toContain("Cmd");
  });
  it("every demo has at least two frames to move between", () => {
    for (const id of ["workspaces", "workbench", "statuses"] as const) expect(framesOf(id, "win32").length).toBeGreaterThan(1);
  });
});

describe("double-tap bindings show without plus signs (ONB-029)", () => {
  const map = resolve({ keybindings: { "worktree.palette": "Double+Shift" } }, "win32");
  it("a double tap is one cap, so no plus sign sits between its parts", () => {
    expect(labelOf(map, "worktree.palette")).toEqual(["Shift Shift"]);
  });
  it("the palette tip takes that cap as the user's binding", () => {
    expect(paletteKeys(labelOf(map, "worktree.palette"), labelOf(defaultsOnly("win32"), "worktree.palette"))).toEqual(["Shift Shift"]);
  });
  it("an ordinary chord still reads with plus signs between its keys", () => {
    expect(keysText("worktree.palette", "win32")).toBe("Ctrl+Shift+J");
  });
});
