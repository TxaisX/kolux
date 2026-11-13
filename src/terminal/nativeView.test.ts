import { expect, test, vi } from "vitest";
import { bindNative, colorref, nativeLook, overlayOver, rectOf, sameRect } from "./nativeView";

test("the pane body's spot goes to Rust in physical pixels; a zero-size body is nothing to show", () => {
  expect(rectOf({ left: 10, top: 20.4, width: 300, height: 200 }, 1.5)).toEqual({ x: 15, y: 31, w: 450, h: 300 });
  expect(rectOf({ left: 0, top: 0, width: 0, height: 200 }, 1)).toBeNull();
  expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true);
  expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, null)).toBe(false);
});

const body = (r = { left: 0, top: 0, width: 100, height: 50 }) => ({ getBoundingClientRect: () => r, dataset: {} }) as unknown as HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

test("attaches once the terminal has an id, moves on change, hides while hidden, detaches on stop", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const calls: [string, unknown][] = [];
  const call = async (cmd: string, args?: Record<string, unknown>) => void calls.push([cmd, args]);
  let id: number | null = null;
  let hidden = false;
  const box = { left: 0, top: 0, width: 100, height: 50 };
  const el = body(box);
  const stop = bindNative(el, () => id, () => hidden, call, 5);
  await flush();
  expect(calls).toEqual([]); // no terminal yet
  id = 7;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[0]).toEqual(["native_term_attach", { id: 7, rect: { x: 0, y: 0, w: 100, h: 50 }, look: null }]);
  expect(calls).toHaveLength(1); // unchanged spot: no more calls
  expect(el.dataset.native).toBe("on");
  box.left = 30;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[1]).toEqual(["native_term_place", { id: 7, rect: { x: 30, y: 0, w: 100, h: 50 }, look: null }]);
  hidden = true;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[2]).toEqual(["native_term_place", { id: 7, rect: null, look: null }]);
  stop();
  expect(calls[calls.length - 1]).toEqual(["native_term_detach", { id: 7 }]);
  expect(el.dataset.native).toBeUndefined();
  vi.unstubAllGlobals();
});

test("a failed attach (no engine) leaves the pane on xterm and stops trying", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let n = 0;
  const el = body();
  const stop = bindNative(el, () => 3, () => false, async () => { n++; throw new Error("no engine"); }, 5);
  await new Promise((r) => setTimeout(r, 30));
  expect(n).toBe(1);
  expect(el.dataset.native).toBe("off");
  stop();
  vi.unstubAllGlobals();
});

test("web UI over the pane moves the engine aside and back; the pane hears when the engine draws", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const calls: [string, unknown][] = [];
  const call = async (cmd: string, args?: Record<string, unknown>) => void calls.push([cmd, args]);
  const seen: boolean[] = [];
  let menu = false;
  const el = body();
  const stop = bindNative(el, () => 4, () => false, call, 5, { covered: () => menu, onShown: (on) => seen.push(on) });
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[0]).toEqual(["native_term_attach", { id: 4, rect: { x: 0, y: 0, w: 100, h: 50 }, look: null }]);
  expect(seen).toEqual([true]);
  menu = true;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[1]).toEqual(["native_term_place", { id: 4, rect: null, look: null }]);
  expect(el.dataset.native).toBe("under");
  expect(seen).toEqual([true, false]);
  menu = false;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[2]).toEqual(["native_term_place", { id: 4, rect: { x: 0, y: 0, w: 100, h: 50 }, look: null }]);
  expect(el.dataset.native).toBe("on");
  stop();
  expect(seen).toEqual([true, false, true, false]);
  vi.unstubAllGlobals();
});

test("overlayOver: an open menu over the pane counts, one elsewhere does not; so does a sheet over its middle", () => {
  const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const pane = { getBoundingClientRect: () => box(0, 0, 100, 100), contains: (n: unknown) => n === inside } as unknown as HTMLElement;
  const inside = {};
  let menus: { getBoundingClientRect: () => ReturnType<typeof box> }[] = [];
  let top: unknown = inside;
  const doc = { querySelectorAll: () => menus, elementFromPoint: () => top } as unknown as Document;
  expect(overlayOver(pane, doc)).toBe(false);
  menus = [{ getBoundingClientRect: () => box(200, 0, 50, 50) }];
  expect(overlayOver(pane, doc)).toBe(false);
  menus = [{ getBoundingClientRect: () => box(80, 80, 50, 50) }];
  expect(overlayOver(pane, doc)).toBe(true);
  menus = [];
  top = { contains: () => false }; // a sheet laid over the pane
  expect(overlayOver(pane, doc)).toBe(true);
  top = { contains: (n: unknown) => n === pane }; // the pane's own frame around the body
  expect(overlayOver(pane, doc)).toBe(false);
});

test("colorref: CSS colours become Windows COLORREFs; see-through ones are laid over the ground", () => {
  expect(colorref("#112233", 0)).toBe(0x332211);
  expect(colorref("#abc", 0)).toBe(0xccbbaa);
  expect(colorref("rgb(1, 2, 3)", 0)).toBe(0x030201);
  expect(colorref("#ffffff80", 0, "#000000")).toBe(0x808080);
  expect(colorref("rgba(255, 0, 0, 0.5)", 0, "#0000ff")).toBe(0x800080);
  expect(colorref("var(--x)", 42)).toBe(42);
  expect(colorref(undefined, 7)).toBe(7);
});

test("nativeLook: the pane's theme, first font family in points and cursor shape, in the engine's slots", () => {
  const theme = { background: "#101010", foreground: "#e0e0e0", selectionBackground: "#ffffff40", red: "#ff0000", brightWhite: "#fefefe" };
  const look = nativeLook(theme, '"Cascadia Mono", Consolas, monospace', 13, "bar", false);
  expect(look.background).toBe(0x101010);
  expect(look.foreground).toBe(0xe0e0e0);
  expect(look.selection).toBe(colorref("#ffffff40", 0, "#101010"));
  expect(look.table).toHaveLength(16);
  expect(look.table[1]).toBe(0x0000ff);
  expect(look.table[15]).toBe(0xfefefe);
  expect(look.table[0]).toBe(0x0c0c0c); // left out: Windows Terminal's own slot
  expect(look.font).toBe("Cascadia Mono");
  expect(look.size).toBe(10);
  expect(look.cursorStyle).toBe(6);
  // a blinking block is the engine's blinking block (1), not its own default (0)
  expect(nativeLook({}, "monospace", 16, "block", true)).toMatchObject({ font: "Cascadia Mono", size: 12, cursorStyle: 1 });
  expect(nativeLook({}, "Fira Code", 13, "block", undefined).cursorStyle).toBe(1);
  expect(nativeLook({}, "Fira Code", 13, "block", false).cursorStyle).toBe(2);
  expect(nativeLook({}, "Fira Code", 13, "underline", true).cursorStyle).toBe(3);
  expect(nativeLook({}, "Fira Code", 13, "underline", false).cursorStyle).toBe(4);
});

test("the look goes with the attach, again on a theme event, and the engine's grid reaches the pane", async () => {
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    addEventListener: (ev: string, f: () => void) => (listeners[ev] = f),
    removeEventListener: (ev: string) => delete listeners[ev],
  });
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const call = async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    return [120, 30];
  };
  let size = 13;
  const grids: [number, number][] = [];
  const stop = bindNative(body(), () => 3, () => false, call, 5, {
    covered: () => false,
    look: () => nativeLook({ background: "#000000" }, "Consolas", size, "block", true),
    lookEvents: ["kolux-terminal-theme"],
    onGrid: (c, r) => grids.push([c, r]),
  });
  await new Promise((r) => setTimeout(r, 15));
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("native_term_attach");
  expect(calls[0][1]?.look).toMatchObject({ font: "Consolas", size: 10 });
  expect(grids).toEqual([[120, 30]]);
  size = 20;
  listeners["kolux-terminal-theme"]();
  await new Promise((r) => setTimeout(r, 15));
  expect(calls).toHaveLength(2); // one restyle, then quiet again
  expect(calls[1][0]).toBe("native_term_place");
  expect(calls[1][1]?.look).toMatchObject({ size: 15 });
  stop();
  expect(listeners["kolux-terminal-theme"]).toBeUndefined();
  vi.unstubAllGlobals();
});
