// T-800 (P4B-13): "Go to / Run a command" with Ctrl+Shift+P and Ctrl+K, and the two places Ctrl+K keeps its own meaning.
import { describe, expect, it } from "vitest";
import { actionById } from "./actions";
import { chordsOf, labelParts, matchEvent, resolve, type KeyLike } from "./keymap";
import { kPalette, paletteHint } from "./paletteKey";
import { routeKey, type RoutedKey } from "../terminal/shellKeys";

const ev = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const win = resolve(null, "win32");
const mac = resolve(null, "darwin");
const inside = (sel: string) => ({ closest: (s: string) => (s === sel ? {} : null) }) as unknown as Element;
const ctrlK = ev("K", { ctrlKey: true });
const clear = { id: "terminal.clear" };
const palette = { id: "worktree.palette" };

describe("the dialog and its chords", () => {
  it("is named Go to / Run a command and keeps Ctrl+Shift+J (COMPAT.md) beside Ctrl+Shift+P", () => {
    expect(actionById.get("worktree.palette")?.title).toBe("Go to / Run a command");
    expect(chordsOf(win, "worktree.palette")).toEqual(["Mod+Shift+J", "Mod+Shift+P"]);
    expect(chordsOf(mac, "worktree.palette")).toEqual(["Mod+J", "Mod+Shift+P"]);
  });

  it("Ctrl+Shift+P and Ctrl+Shift+J each open it, from a terminal too", () => {
    for (const e of [ev("P", { ctrlKey: true, shiftKey: true }), ev("J", { ctrlKey: true, shiftKey: true })]) {
      expect(matchEvent(win, e, ["global", "terminal", "tabs"]), e.key).toEqual(palette);
      expect(routeKey(win, e as RoutedKey, false), e.key).toEqual({ kind: "kolux", id: "worktree.palette" });
    }
  });

  it("the top-bar escape moved to Ctrl+F6, so Ctrl+Shift+P is free and bare F6 still reaches terminal programs", () => {
    expect(chordsOf(win, "focus.chrome")).toEqual(["Mod+F6"]);
    expect(matchEvent(win, ev("F6", { code: "F6", ctrlKey: true }), ["global"])).toEqual({ id: "focus.chrome" });
    expect(matchEvent(win, ev("F6", { code: "F6" }), ["global"])).toBeFalsy();
  });
});

describe("Ctrl+K", () => {
  it("clears in a focused terminal: the window's rule leaves it, and the terminal's own route is still Clear active pane", () => {
    expect(kPalette(clear, win, ctrlK, inside(".xterm"))).toBe(clear);
    expect(routeKey(win, ctrlK as RoutedKey, false)).toEqual({ kind: "kolux", id: "terminal.clear" });
  });

  it("opens the Link box in a rich Markdown view, which no window action takes", () => {
    expect(kPalette(null, win, ctrlK, inside(".md-rich"))).toBeNull();
  });

  it("opens the palette everywhere else, whether the screen matched Clear active pane or nothing", () => {
    expect(kPalette(clear, win, ctrlK, inside(".sidebar"))).toEqual(palette);
    expect(kPalette(null, win, ctrlK, null)).toEqual(palette);
    expect(kPalette(false, win, ctrlK, inside(".cm-editor"))).toEqual(palette);
    expect(kPalette(null, mac, ev("K", { metaKey: true }), null)).toEqual(palette);
  });

  it("leaves other keys and other matches alone", () => {
    expect(kPalette(null, win, ev("J", { ctrlKey: true }), null)).toBeNull();
    expect(kPalette(null, win, ev("K", { ctrlKey: true, shiftKey: true }), null)).toBeNull();
    expect(kPalette(null, mac, ctrlK, null)).toBeNull(); // on a Mac the key is Cmd+K
    const other = { id: "app.settings" };
    expect(kPalette(other, win, ctrlK, null)).toBe(other);
  });

  it("follows Clear active pane: moved off Ctrl+K, the palette has no Ctrl+K either", () => {
    const moved = resolve({ keybindings: { "terminal.clear": "Mod+Alt+L" } }, "win32");
    expect(kPalette(null, moved, ctrlK, null)).toBeNull();
    expect(paletteHint(moved)).toEqual(["Ctrl", "Shift", "J"]);
  });

  it("a palette the user rebound or unbound keeps only the user's keys", () => {
    const mine = resolve({ keybindings: { "worktree.palette": "Mod+Alt+P" } }, "win32");
    expect(kPalette(null, mine, ctrlK, null)).toBeNull();
    expect(paletteHint(mine)).toEqual(["Ctrl", "Alt", "P"]);
    const none = resolve({ keybindings: { "worktree.palette": null } }, "win32");
    expect(kPalette(clear, none, ctrlK, null)).toBe(clear);
    expect(paletteHint(none)).toEqual([]);
  });

  it("the top-bar box shows Ctrl+K", () => {
    expect(paletteHint(win)).toEqual(labelParts("Mod+K", "win32"));
    expect(paletteHint(win)).toEqual(["Ctrl", "K"]);
    expect(paletteHint(mac)).toEqual(["Cmd", "K"]);
  });
});
