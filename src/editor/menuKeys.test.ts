import { describe, expect, it, vi } from "vitest";
import { restoreIfLost, wireMenuKeys } from "./menuKeys";

const key = (name: string) => Object.assign(new Event("keydown", { cancelable: true }), { key: name });

function menu(rows = 3, at = 0, inside = true) {
  const focus = Array.from({ length: rows }, () => vi.fn());
  const state = { at, inside };
  const close = vi.fn();
  const restore = vi.fn();
  const win = new EventTarget();
  const stop = wireMenuKeys(win, { rows: () => focus.map((f) => ({ focus: f })), at: () => state.at, inside: () => state.inside, close, restore });
  return { win, stop, focus, state, close, restore };
}

describe("wireMenuKeys", () => {
  it("Escape closes the menu, then hands focus back after the close (deferred)", async () => {
    const m = menu();
    const e = key("Escape");
    m.win.dispatchEvent(e);
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(m.restore, "focus returns after the menu is gone, not during the key").not.toHaveBeenCalled();
    await Promise.resolve();
    expect(m.restore).toHaveBeenCalledTimes(1);
  });
  it("the arrow keys step through the rows, wrapping, and Home and End jump", () => {
    const m = menu(3, 0);
    m.win.dispatchEvent(key("ArrowDown"));
    expect(m.focus[1]).toHaveBeenCalled();
    m.state.at = 2;
    m.win.dispatchEvent(key("ArrowDown"));
    expect(m.focus[0]).toHaveBeenCalled();
    m.win.dispatchEvent(key("End"));
    expect(m.focus[2]).toHaveBeenCalled();
  });
  it("leaves the arrows alone when focus is outside the menu, and other keys always", () => {
    const m = menu(3, -1, false);
    const e = key("ArrowDown");
    m.win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    m.focus.forEach((f) => expect(f).not.toHaveBeenCalled());
    m.state.inside = true;
    m.win.dispatchEvent(key("a"));
    m.focus.forEach((f) => expect(f).not.toHaveBeenCalled());
  });
  it("takes its listeners off when stopped", () => {
    const m = menu();
    m.stop();
    m.win.dispatchEvent(key("Escape"));
    m.win.dispatchEvent(key("ArrowDown"));
    expect(m.close).not.toHaveBeenCalled();
    m.focus.forEach((f) => expect(f).not.toHaveBeenCalled());
  });
  it("listens in the capture phase, so a focused pane behind the menu never sees the Escape", () => {
    const calls: Array<{ type: string; capture: unknown }> = [];
    const win = { addEventListener: (type: string, _fn: unknown, o: unknown) => calls.push({ type, capture: (o as { capture?: boolean })?.capture }), removeEventListener: () => {} };
    wireMenuKeys(win, { rows: () => [], at: () => -1, inside: () => true, close: () => {}, restore: () => {} });
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.type === "keydown" && c.capture === true)).toBe(true);
  });
});

describe("restoreIfLost", () => {
  const body = {};
  it("gives focus back to the opener once focus has dropped to the body or nowhere (deferred)", async () => {
    for (const active of [body, null, undefined]) {
      const restore = vi.fn();
      restoreIfLost({ activeElement: active }, body, restore);
      expect(restore, "deferred, not during the close").not.toHaveBeenCalled();
      await Promise.resolve();
      expect(restore).toHaveBeenCalledTimes(1);
    }
  });
  it("leaves focus alone when an action already put it somewhere, such as a dialog it opened", async () => {
    const restore = vi.fn();
    restoreIfLost({ activeElement: {} }, body, restore);
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
  });
});
