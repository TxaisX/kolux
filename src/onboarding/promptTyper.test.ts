// ONB-017 (T-244-b): the typer that puts a setup command at a prompt without pressing Enter.
import { describe, expect, test } from "vitest";
import { CHECK_MS, createTyper, MAX_CHECKS, OPEN_WAIT_MS, plain, promptVisible, typable } from "./promptTyper";

describe("prompt reading", () => {
  test("colour and title codes are removed", () => {
    expect(plain("\u001b]0;title\u0007\u001b[32muser@host\u001b[0m:~$ ")).toBe("user@host:~$ ");
  });
  test("a shell prompt is recognised, program output is not", () => {
    for (const p of ["user@host:~$ ", "root# ", "PS C:\\Users\\a> ", "C:\\work>", "% "]) expect(promptVisible(p)).toBe(true);
    expect(promptVisible("Installing...")).toBe(false);
    expect(promptVisible("")).toBe(false);
  });
  test("a command with a line break or control key is not typable", () => {
    expect(typable("npx skills add x")).toBe(true);
    for (const bad of ["a\nb", "a\r", "\u0003", "", "  "]) expect(typable(bad)).toBe(false);
  });
});

function rig() {
  const written: string[] = [];
  let clock = 0;
  let tick: (() => void) | null = null;
  let stopped = 0;
  const t = createTyper({
    write: (d) => written.push(d),
    every: (fn) => ((tick = fn), () => ((tick = null), stopped++)),
    now: () => clock,
  });
  const advance = (ms: number) => {
    for (let i = 0; i < ms / CHECK_MS; i++) {
      clock += CHECK_MS;
      tick?.();
    }
  };
  return { t, written, advance, active: () => tick !== null, stopped: () => stopped };
}

describe("createTyper", () => {
  test("types the command once a prompt shows, with no Enter", () => {
    const r = rig();
    r.t.start();
    r.t.want("npx skills add kolux");
    r.advance(CHECK_MS * 3);
    expect(r.written).toEqual([]);
    r.t.output("Welcome\r\nuser@host:~$ ");
    r.advance(CHECK_MS);
    expect(r.written).toEqual(["npx skills add kolux"]);
    expect(r.written[0]).not.toMatch(/[\r\n]/);
    expect(r.t.state()).toBe("typed");
    expect(r.active()).toBe(false);
  });
  test("the same command is never typed twice into one terminal", () => {
    const r = rig();
    r.t.start();
    r.t.output("$ ");
    r.t.want("cmd one");
    r.advance(CHECK_MS);
    r.t.want("cmd one");
    r.advance(CHECK_MS * 3);
    expect(r.written).toEqual(["cmd one"]);
  });
  test("a different command (a changed tick set) is typed once the prompt is back", () => {
    const r = rig();
    r.t.start();
    r.t.output("$ ");
    r.t.want("cmd one");
    r.advance(CHECK_MS);
    r.t.want("cmd two");
    r.advance(CHECK_MS);
    expect(r.written).toEqual(["cmd one", "cmd two"]);
  });
  test("when no text can be read at all it types after the terminal has been open a short while", () => {
    const r = rig();
    r.t.start();
    r.t.want("cmd");
    r.advance(OPEN_WAIT_MS - CHECK_MS);
    expect(r.written).toEqual([]);
    r.advance(CHECK_MS);
    expect(r.written).toEqual(["cmd"]);
  });
  test("it stops waiting after the capped number of checks when a program keeps printing without a prompt", () => {
    const r = rig();
    r.t.start();
    r.t.want("cmd");
    r.t.output("Loading profile...");
    r.advance(CHECK_MS * (MAX_CHECKS - 1));
    expect(r.active()).toBe(true);
    r.advance(CHECK_MS);
    expect(r.active()).toBe(false);
    expect(r.t.state()).toBe("gave-up");
    expect(r.written).toEqual([]);
  });
  test("a command with a line break is refused outright", () => {
    const r = rig();
    r.t.start();
    r.t.output("$ ");
    r.t.want("a\nrm -rf x");
    r.advance(CHECK_MS * 3);
    expect(r.written).toEqual([]);
  });
  test("stop ends the watch", () => {
    const r = rig();
    r.t.start();
    r.t.want("cmd");
    r.t.stop();
    expect(r.active()).toBe(false);
    expect(r.written).toEqual([]);
  });
});
