// TERM-002 / VIEW-036: sessions.add and sessions.remove ship unbound; with keys assigned in the user's
// keybindings.json the window presses them. The file is a fixture in a temp dir (never the real ~/.kolux),
// read the way the Rust side hands it over: parsed JSON, then resolve().
// src has no node types; the builtin modules come through process.getBuiltinModule (as chat/railWidth.test.ts does).
const builtin = (globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }).process.getBuiltinModule;
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = builtin("node:fs") as {
  mkdirSync(p: string, o: { recursive: boolean }): void;
  mkdtempSync(prefix: string): string;
  readFileSync(p: string, enc: string): string;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  writeFileSync(p: string, data: string): void;
};
const { tmpdir } = builtin("node:os") as { tmpdir(): string };
const { join } = builtin("node:path") as { join(...p: string[]): string };
import { afterAll, expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "./keymap";
import { actions } from "./actions";

const home = mkdtempSync(join(tmpdir(), "kolux-sessionkeys-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
const load = (name: string, body: object) => {
  const dir = join(home, name, ".kolux");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "keybindings.json");
  writeFileSync(path, JSON.stringify(body));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};
const press = (k: string, code: string) => key({ key: k, code, ctrlKey: true, altKey: true, shiftKey: true });

test("the two commands exist and ship with no key", () => {
  expect(actions.find((a) => a.id === "sessions.add")?.win32).toEqual([]);
  expect(actions.find((a) => a.id === "sessions.remove")?.win32).toEqual([]);
  const map = resolve(null, "win32");
  expect(chordsOf(map, "sessions.add")).toEqual([]);
  expect(chordsOf(map, "sessions.remove")).toEqual([]);
  expect(matchEvent(map, press("J", "KeyJ"), ["global", "terminal"])).toBeNull();
});

test("keys assigned in the shared section of the file reach both commands", () => {
  const map = resolve(load("shared", { version: 1, keybindings: { "sessions.add": "Mod+Alt+Shift+J", "sessions.remove": "Mod+Alt+Shift+K" } }), "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "sessions.add")).toEqual(["Mod+Alt+Shift+J"]);
  expect(chordsOf(map, "sessions.remove")).toEqual(["Mod+Alt+Shift+K"]);
  expect(matchEvent(map, press("J", "KeyJ"), ["global", "terminal"])?.id).toBe("sessions.add");
  expect(matchEvent(map, press("K", "KeyK"), ["global", "terminal"])?.id).toBe("sessions.remove");
});

test("keys assigned in this platform's section win, and another platform's section is ignored", () => {
  const file = load("platform", { version: 1, keybindings: {}, platforms: { win32: { "sessions.add": "Mod+Alt+Shift+J" }, darwin: { "sessions.remove": "Mod+Alt+Shift+K" } } });
  const win = resolve(file, "win32");
  expect(chordsOf(win, "sessions.add")).toEqual(["Mod+Alt+Shift+J"]);
  expect(chordsOf(win, "sessions.remove")).toEqual([]);
  expect(chordsOf(resolve(file, "darwin"), "sessions.remove")).toEqual(["Mod+Alt+Shift+K"]);
});

test("the proof chords collide with no built-in key, so the press reaches the command", () => {
  const map = resolve(load("clean", { keybindings: { "sessions.add": "Mod+Alt+Shift+J", "sessions.remove": "Mod+Alt+Shift+K" } }), "win32");
  expect(map.warnings).toEqual([]);
  expect(map.clashes).toEqual([]);
  // the same chords work while the terminal has focus (the terminal scope asks for terminal-safe keys)
  expect(matchEvent(map, press("J", "KeyJ"), ["terminal", "global"])?.id).toBe("sessions.add");
});

test("a file with no entry for them leaves both unbound and a press does nothing", () => {
  const map = resolve(load("none", { version: 1, keybindings: { "terminal.clear": null }, platforms: { win32: {} } }), "win32");
  expect(chordsOf(map, "sessions.add")).toEqual([]);
  expect(matchEvent(map, press("J", "KeyJ"), ["global", "terminal"])).toBeNull();
});
