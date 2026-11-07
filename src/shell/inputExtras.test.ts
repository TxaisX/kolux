import { describe, expect, it, vi } from "vitest";
import { COPY_FAILED, copyOnSelect, installTapReset, latestOnly, searchTabs } from "./inputExtras";
import { windowTaps } from "../keys/tapHit";

describe("term-066 copy on select", () => {
  it("copies what is selected", () => {
    const write = vi.fn(() => Promise.resolve());
    copyOnSelect(write, () => {})("hello");
    expect(write).toHaveBeenCalledWith("hello");
  });
  it("one long drag on a failing clipboard says so once; a new drag says it again", async () => {
    const say = vi.fn();
    const on = copyOnSelect(() => Promise.reject(new Error("denied")), say);
    for (const s of ["a", "ab", "abc", "abcd", "abcde"]) on(s);
    await new Promise((r) => setTimeout(r, 0));
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(COPY_FAILED);
    on("");
    on("x");
    await new Promise((r) => setTimeout(r, 0));
    expect(say).toHaveBeenCalledTimes(2);
  });
  it("a clipboard that throws, or is missing, does not break the drag", () => {
    const say = vi.fn();
    copyOnSelect(() => { throw new Error("no"); }, say)("a");
    expect(say).toHaveBeenCalledTimes(1);
    expect(() => copyOnSelect(() => undefined, say)("a")).not.toThrow();
  });
});

describe("term-053 search open tabs", () => {
  const tabs = [{ key: 1, name: "build", cwd: "/w/feature-x" }, { key: 2, name: "Deploy logs", cwd: "/w/main" }];
  it("part of a tab name lists that tab, in any case", () => {
    expect(searchTabs("DEPL", tabs).map((t) => t.key)).toEqual([2]);
  });
  it("a query that only matches the worktree name finds no tabs; nothing typed finds nothing", () => {
    expect(searchTabs("feature", tabs)).toEqual([]);
    expect(searchTabs("  ", tabs)).toEqual([]);
  });
  it("a late answer to an old query is dropped", () => {
    const l = latestOnly();
    const a = l.next();
    const b = l.next();
    expect(l.isCurrent(a)).toBe(false);
    expect(l.isCurrent(b)).toBe(true);
  });
});

describe("term-062 a double tap does not survive a lost focus", () => {
  it("losing the window's focus forgets half a double tap", () => {
    const handlers: Record<string, () => void> = {};
    const target = { addEventListener: (n: string, f: () => void) => (handlers[n] = f), removeEventListener: (n: string) => delete handlers[n] } as unknown as Window;
    const key = { key: "Shift", code: "ShiftLeft", repeat: false, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };
    const off = installTapReset(target);
    expect(windowTaps.down(key, 100)).toBeNull();
    handlers.blur();
    expect(windowTaps.down(key, 200)).toBeNull(); // the first tap was forgotten, so this one starts over
    expect(windowTaps.down(key, 300)).toBe("Shift");
    off();
    expect(handlers.blur).toBeUndefined();
  });
});
