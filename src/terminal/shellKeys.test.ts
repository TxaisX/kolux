import { describe, expect, it } from "vitest";
import { resolve } from "../keys/keymap";
import { heldByTerminal } from "../keys/terminalPolicy";
import { answersPrompt, newlineAgent, routeKey, type RoutedKey } from "./shellKeys";

const key = (code: string, k: string, mods: Partial<RoutedKey> = {}): RoutedKey => ({ code, key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const win = resolve(null, "win32");
const mac = resolve(null, "darwin");

describe("TERM-080 Shift+Enter is a newline in an agent pane, plain Enter in a shell", () => {
  it("sends the encoding the agent reads; a shell and a composing key are untouched; Mod+Shift+Enter stays Kolux", () => {
    const shiftEnter = key("Enter", "Enter", { shiftKey: true });
    const ctrlEnter = key("Enter", "Enter", { ctrlKey: true });
    expect(routeKey(win, shiftEnter, false, "claude")).toEqual({ kind: "send", data: "\x1b\r" });
    expect(routeKey(win, ctrlEnter, false, "claude")).toEqual({ kind: "send", data: "\x1b\r" });
    expect(routeKey(win, shiftEnter, false, "codex")).toEqual({ kind: "send", data: "\n" });
    expect(routeKey(win, shiftEnter, false, "shell")).toEqual({ kind: "shell" });
    expect(routeKey(win, shiftEnter, false)).toEqual({ kind: "shell" });
    expect(routeKey(win, key("Enter", "Enter"), false, "claude")).toEqual({ kind: "shell" }); // plain Enter sends
    expect(routeKey(win, key("Enter", "Enter", { ctrlKey: true, shiftKey: true }), false, "claude")).toEqual({ kind: "kolux", id: "terminal.expandPane" });
    expect(routeKey(win, key("Enter", "Enter", { shiftKey: true, isComposing: true }), false, "claude")).toEqual({ kind: "ime" }); // TERM-083
  });
});

describe("TERM-079 Kolux shortcuts versus shell keys", () => {
  it("Ctrl+R and Ctrl+Arrow reach the shell on Windows; a Kolux chord never does", () => {
    expect(routeKey(win, key("KeyR", "r", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(win, key("ArrowRight", "ArrowRight", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(win, key("KeyA", "a"), false)).toEqual({ kind: "shell" });
    // Mod+K is Clear active pane, Mod+F is Search, Mod+W is Close pane, Ctrl+Tab the recent tab: all Kolux's
    expect(routeKey(win, key("KeyK", "k", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
    expect(routeKey(win, key("KeyF", "f", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.search" });
    expect(routeKey(win, key("KeyW", "w", { ctrlKey: true }), false).kind).toBe("kolux");
    expect(routeKey(win, key("Tab", "Tab", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "tab.previousRecent" });
  });

  it("Ctrl+C is the program's interrupt with nothing selected and Kolux's copy with a selection", () => {
    const c = key("KeyC", "c", { ctrlKey: true });
    expect(routeKey(win, c, false)).toEqual({ kind: "shell" });
    expect(routeKey(win, c, true)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
    expect(routeKey(win, key("KeyC", "C", { ctrlKey: true, shiftKey: true }), false).kind).toBe("kolux");
  });

  it("honours a custom pane keybinding from the user's file", () => {
    const custom = resolve({ keybindings: { "terminal.clear": ["Ctrl+Shift+L"] } }, "win32");
    expect(custom.bindings.get("terminal.clear")?.chords).toEqual(["Ctrl+Shift+L"]);
    expect(routeKey(custom, key("KeyL", "L", { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
    expect(routeKey(custom, key("KeyK", "k", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
  });

  it("Alt+Arrow moves by word on every platform: ESC b/f on macOS, the Ctrl+Arrow encoding on Windows", () => {
    expect(routeKey(mac, key("ArrowLeft", "ArrowLeft", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1bb" });
    expect(routeKey(mac, key("ArrowRight", "ArrowRight", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1bf" });
    expect(routeKey(win, key("ArrowLeft", "ArrowLeft", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1b[1;5D" });
    expect(routeKey(win, key("ArrowRight", "ArrowRight", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1b[1;5C" });
  });

  it("on macOS the shell's Ctrl chords stay the shell's, Cmd+Left jumps to column one, Cmd+Up to the top", () => {
    // Ctrl+1 is Select Tab 1 on macOS; Ctrl+A is the shell's line start even though the chord table could claim letters
    expect(routeKey(mac, key("KeyA", "a", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(mac, key("KeyR", "r", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(mac, key("ArrowLeft", "ArrowLeft", { metaKey: true }), false)).toEqual({ kind: "send", data: "\x01" });
    expect(routeKey(mac, key("ArrowRight", "ArrowRight", { metaKey: true }), false)).toEqual({ kind: "send", data: "\x05" });
    expect(routeKey(mac, key("ArrowUp", "ArrowUp", { metaKey: true }), false)).toEqual({ kind: "scroll", to: "top" });
    expect(routeKey(mac, key("ArrowDown", "ArrowDown", { metaKey: true }), false)).toEqual({ kind: "scroll", to: "bottom" });
    // Cmd+K is still Kolux's clear on macOS
    expect(routeKey(mac, key("KeyK", "k", { metaKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
  });

  it("a composing key (IME) is left to the terminal's composition handling", () => {
    expect(routeKey(win, key("KeyK", "ㅏ", { ctrlKey: true, isComposing: true }), false)).toEqual({ kind: "ime" });
    expect(routeKey(win, key("", "Process", { keyCode: 229 }), false)).toEqual({ kind: "ime" });
  });
});

describe("T-151-b a key that reaches the program answers the prompt; a Kolux chord, a scroll or a modifier does not", () => {
  it("council D2 MERGE 47 S2", () => {
    expect(answersPrompt({ kind: "shell" }, "y")).toBe(true);
    expect(answersPrompt({ kind: "send", data: "\x1b\r" }, "Enter")).toBe(true);
    expect(answersPrompt({ kind: "ime" }, "Process")).toBe(true);
    expect(answersPrompt({ kind: "shell" }, "Shift")).toBe(false);
    expect(answersPrompt({ kind: "shell" }, "Control")).toBe(false);
    expect(answersPrompt({ kind: "kolux", id: "terminal.search" }, "f")).toBe(false);
    expect(answersPrompt({ kind: "scroll", to: "top" }, "ArrowUp")).toBe(false);
  });
});

describe("council D2 MERGE 47 FB1 and FS1", () => {
  it("a chord held by the terminal (Terminal first) reaches the program", () => {
    const p = key("KeyP", "p", { ctrlKey: true });
    const k = key("KeyK", "k", { ctrlKey: true });
    expect(routeKey(win, p, false).kind).toBe("kolux");
    expect(routeKey(win, k, false)).toEqual({ kind: "kolux", id: "terminal.clear" });
    const pRoute = routeKey(win, p, false);
    const held = (id: string) => id === "terminal.clear" || (pRoute.kind === "kolux" && id === pRoute.id);
    expect(routeKey(win, p, false, "shell", held)).toEqual({ kind: "shell" });
    expect(routeKey(win, k, false, "shell", held)).toEqual({ kind: "shell" });
    // a chord nobody held stays Kolux's
    expect(routeKey(win, key("KeyF", "f", { ctrlKey: true }), false, "shell", held)).toEqual({ kind: "kolux", id: "terminal.search" });
  });

  it("Shift+Enter's newline follows the program that started, not the pane's agent", () => {
    expect(newlineAgent("codex", "codex")).toBe("codex");
    expect(newlineAgent("C:/tools/claude.exe", "claude")).toBe("claude");
    // Codex missing, bash started in its place: a shell, so Shift+Enter never sends a running newline
    expect(newlineAgent("bash", "codex")).toBe("shell");
    expect(newlineAgent("pwsh.exe", "codex")).toBe("shell");
    expect(newlineAgent(null, "codex")).toBe("codex");
    const shiftEnter = key("Enter", "Enter", { shiftKey: true });
    expect(routeKey(win, shiftEnter, false, newlineAgent("bash", "codex"))).toEqual(routeKey(win, shiftEnter, false, "shell"));
  });
});

describe("T-692 (E3) focus.chrome from inside a terminal", () => {
  it("Mod+Shift+P leaves the terminal for the top bar even with Terminal first on; a held chord does not", () => {
    const inXterm = { closest: (sel: string) => (sel === ".xterm" ? {} : null) } as unknown as Element;
    const held = (id: string) => heldByTerminal(id, { terminalShortcuts: "terminal" }, inXterm);
    expect(routeKey(win, key("KeyP", "P", { ctrlKey: true, shiftKey: true }), false, "shell", held)).toEqual({ kind: "kolux", id: "focus.chrome" });
    expect(routeKey(win, key("KeyK", "k", { ctrlKey: true }), false, "shell", held)).toEqual({ kind: "shell" });
  });
});
