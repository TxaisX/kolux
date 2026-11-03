// The keymap: chord parsing, the built-in defaults per platform (SET-013), and how the file's
// overrides apply (SET-011, COMPAT.md 4.1 and 4.2).
import { expect, test } from "vitest";
import { actions, defaultsFor } from "./actions";
import { chordMatches, chordsOf, labelOf, labelParts, matchEvent, parseChord, resolve, type KeyLike } from "./keymap";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

test("the table registers the 138 carried commands (UX lane C added view.automations and focus.chrome, TERM-053 added tab.search, VIEW-053 added one, T-546 added view.tower, T-246-c added the three ui.zoom keys, T-548 added the two account switches, T-146-e added view.space, T-611 dropped sidebar.ports.toggle); 56 ship unbound (UX lane C: view.automations added unbound, floatingWorkspace.minimize now bound; T-239 bound Reopen closed tab again; the two T-548 account switches ship unbound) and only New agent tab (TERM-041) and workspace rename have a macOS chord only (UX lane C gave three Ctrl+Shift chords)", () => {
  expect(actions.length).toBe(138);
  const ids = new Set(actions.map((a) => a.id));
  expect(ids.size).toBe(138);
  expect(ids.has("sidebar.sourceControl.toggle")).toBe(false); // T-644
  expect(ids.has("tab.newSimulator")).toBe(false);
  expect(ids.has("tab.openQuickCommandsMenu")).toBe(false);
  expect(ids.has("sidebar.ports.toggle")).toBe(false); // T-611: VIEW-079's Ports tab is dropped
  expect(actions.filter((a) => a.win32.length === 0 && !a.darwin).length).toBe(56);
  expect(actions.filter((a) => a.win32.length === 0 && a.darwin).map((a) => a.id).sort()).toEqual(["tab.newAgent", "workspace.rename"]);
  expect(actions.filter((a) => a.id.startsWith("tab.newAgent.")).length).toBe(36);
});

test("chords parse, normalise their spelling and refuse Mod mixed with Ctrl", () => {
  expect(parseChord("Mod+Shift+J")).toEqual({ mod: true, ctrl: false, meta: false, alt: false, shift: true, key: "J" });
  expect(parseChord("ctrl+shift+arrowup")).toEqual({ mod: false, ctrl: true, meta: false, alt: false, shift: true, key: "ArrowUp" });
  expect(parseChord("Mod+Shift+Plus")).toMatchObject({ key: "Plus" });
  expect(parseChord("Mod+Shift++")).toMatchObject({ key: "Plus" });
  expect(parseChord("F7")).toMatchObject({ key: "F7", mod: false });
  expect(parseChord("Mod+Ctrl+J")).toHaveProperty("error");
  expect(parseChord("Mod+Shift")).toHaveProperty("error");
  expect(parseChord("Super+J")).toHaveProperty("error");
  expect(parseChord("")).toHaveProperty("error");
});

test("fresh Windows profile: Ctrl+Shift+J opens the palette, Alt+1 selects tab 1, Ctrl+Shift+D splits right, Ctrl+J is next-needs-you", () => {
  const map = resolve(null, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Shift+J"]);
  expect(chordsOf(map, "terminals.focusNextNeedsYou")).toEqual(["Mod+J"]);
  expect(matchEvent(map, key({ key: "J", code: "KeyJ", ctrlKey: true, shiftKey: true }), ["global"])).toEqual({ id: "worktree.palette" });
  expect(matchEvent(map, key({ key: "j", code: "KeyJ", ctrlKey: true }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
  expect(matchEvent(map, key({ key: "3", code: "Digit3", altKey: true }), ["tabs"])).toEqual({ id: "tab.selectByIndex", index: 3 });
  expect(matchEvent(map, key({ key: "D", code: "KeyD", ctrlKey: true, shiftKey: true }), ["terminal"])).toEqual({ id: "terminal.splitRight" });
  expect(matchEvent(map, key({ key: "D", code: "KeyD", altKey: true, shiftKey: true }), ["terminal"])).toEqual({ id: "terminal.splitDown" });
  expect(matchEvent(map, key({ key: "b", code: "KeyB", ctrlKey: true }), ["global"])).toEqual({ id: "sidebar.left.toggle" });
  // Scope: Mod+F finds in the browser, the editor, settings and the terminal, never globally.
  expect(matchEvent(map, key({ key: "f", code: "KeyF", ctrlKey: true }), ["global"])).toBeNull();
  expect(matchEvent(map, key({ key: "f", code: "KeyF", ctrlKey: true }), ["terminal"])).toEqual({ id: "terminal.search" });
  // The unassigned set from SET-013's second check.
  for (const id of ["workspace.openBoard", "dashboard.toggle", "view.tasks", "view.inbox", "view.floor"]) expect(chordsOf(map, id)).toEqual([]);
});

test("macOS differs where SET-013 says so, and Mod means Cmd there", () => {
  const map = resolve(null, "darwin");
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+J"]);
  expect(chordsOf(map, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+J"]);
  expect(chordsOf(map, "tab.selectByIndex")).toEqual(["Ctrl+1"]);
  expect(chordsOf(map, "terminal.splitRight")).toEqual(["Mod+D"]);
  expect(chordsOf(map, "workspace.rename")).toEqual(["Mod+Alt+R"]);
  expect(chordMatches("Mod+J", key({ key: "j", code: "KeyJ", metaKey: true }), "darwin")).toEqual({});
  expect(chordMatches("Mod+J", key({ key: "j", code: "KeyJ", ctrlKey: true }), "darwin")).toBeNull();
  expect(labelParts("Mod+Shift+J", "darwin")).toEqual(["Shift", "Cmd", "J"]);
});

test("labels read as the keys on the keyboard", () => {
  expect(labelParts("Mod+Shift+J", "win32")).toEqual(["Ctrl", "Shift", "J"]);
  expect(labelParts("Mod+Comma", "win32")).toEqual(["Ctrl", ","]);
  expect(labelParts("Mod+Shift+ArrowUp", "linux")).toEqual(["Ctrl", "Shift", "Up"]);
  expect(labelOf(resolve(null, "win32"), "view.tasks")).toEqual([]);
});

test("null unbinds, a win32 section beats the shared map, and the older top-level form still loads", () => {
  const map = resolve({ version: 1, keybindings: { "terminal.clear": null, "worktree.palette": "Mod+Shift+P", "zoom.in": ["Mod+Shift+Equal", "Mod+NumpadAdd"] }, platforms: { win32: { "worktree.palette": "Mod+Alt+P" }, darwin: { "terminal.clear": "Mod+L" } } }, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "terminal.clear")).toEqual([]);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Alt+P"]);
  expect(chordsOf(map, "zoom.in")).toEqual(["Mod+Shift+Equal", "Mod+NumpadAdd"]);
  expect(labelOf(map, "worktree.palette")).toEqual(["Ctrl", "Alt", "P"]);
  const mac = resolve({ keybindings: { "terminal.clear": null }, platforms: { darwin: { "terminal.clear": "Mod+L" } } }, "darwin");
  expect(chordsOf(mac, "terminal.clear")).toEqual(["Mod+L"]);
  const old = resolve({ "$schema": "x", version: 1, "sidebar.left.toggle": false, "terminals.focusNextNeedsYou": "Mod+Shift+Y" }, "win32");
  expect(old.errors).toEqual([]);
  expect(chordsOf(old, "sidebar.left.toggle")).toEqual([]);
  expect(chordsOf(old, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+Y"]);
  // Index actions: a chord ending in another digit is rewritten to 1.
  expect(chordsOf(resolve({ keybindings: { "tab.selectByIndex": "Mod+Alt+4" } }, "win32"), "tab.selectByIndex")).toEqual(["Mod+Alt+1"]);
});

test("a bad chord, an unknown id or an unknown platform is reported for that entry only", () => {
  const map = resolve({ keybindings: { "terminal.clear": "Mod+Ctrl+K", "voice.dictation": "Mod+Shift+V", "tab.openQuickCommandsMenu": "Mod+Shift+P", "zoom.in": 7 }, platforms: { win64: { "zoom.out": null } } }, "win32");
  expect(chordsOf(map, "terminal.clear")).toEqual(["Mod+K"]);
  expect(chordsOf(map, "zoom.in")).toEqual(["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"]);
  expect(map.errors.length).toBe(2);
  expect(map.errors[0]).toContain("terminal.clear");
  expect(map.errors[1]).toContain("zoom.in");
  expect(map.warnings.length).toBe(3);
  expect(map.warnings.join(" ")).toContain("voice.dictation");
  expect(map.warnings.join(" ")).toContain("tab.openQuickCommandsMenu");
  expect(map.warnings.join(" ")).toContain("win64");
});

test("a file that is not an object keeps the defaults and says so", () => {
  const map = resolve([1, 2], "win32");
  expect(map.errors.length).toBe(1);
  expect(chordsOf(map, "worktree.palette")).toEqual(["Mod+Shift+J"]);
});

test("two custom chords that clash inside their scope are dropped and the defaults stay; defaults may overlap", () => {
  const map = resolve({ keybindings: { "sidebar.right.toggle": "Mod+Alt+Q", "sidebar.left.toggle": "Mod+Alt+Q" } }, "win32");
  expect(chordsOf(map, "sidebar.right.toggle")).toEqual(["Mod+L"]);
  expect(chordsOf(map, "sidebar.left.toggle")).toEqual(["Mod+B"]);
  expect(map.errors.length).toBe(1);
  expect(map.errors[0]).toContain("Toggle Right Sidebar");
  // Different scopes may share a chord (Mod+W closes a tab and a pane).
  const apart = resolve({ keybindings: { "terminal.closePane": "Mod+W" } }, "win32");
  expect(apart.errors).toEqual([]);
  // The conflict groups bite across scopes: tab.rename (tabs) and workspace.rename (global) share "workspace-shell".
  const grouped = resolve({ keybindings: { "tab.rename": "Mod+Alt+R", "workspace.rename": "Mod+Alt+R" } }, "win32");
  expect(chordsOf(grouped, "tab.rename"), "the clashing custom chord drops; the default stays").toEqual(["Mod+Shift+G"]);
  expect(grouped.errors[0]).toContain("Rename active tab");
});

test("SET-010: a clash names every command on the chord, scope by scope; agents switched off never count", () => {
  const map = resolve({ keybindings: { "view.tasks": "Mod+Alt+Q", "worktree.quickOpen": "Mod+Alt+Q" } }, "win32");
  expect(map.clashes).toEqual([{ chord: "Mod+Alt+Q", ids: ["worktree.quickOpen", "view.tasks"] }]);
  expect(chordsOf(map, "view.tasks"), "the override is ignored").toEqual([]);
  expect(resolve({ keybindings: { "view.tasks": "Mod+K" } }, "win32").clashes, "terminal scope is apart").toEqual([]);
  expect(resolve({ keybindings: { "view.tasks": null } }, "win32").clashes, "no chord never clashes").toEqual([]);
  const agent = { keybindings: { "tab.newTerminal": "Mod+Alt+Q", "tab.newAgent.aider": "Mod+Alt+Q" } };
  expect(resolve(agent, "win32").clashes[0].ids).toEqual(["tab.newTerminal", "tab.newAgent.aider"]);
  const off = resolve(agent, "win32", ["tab.newAgent.aider"]);
  expect([off.clashes, off.errors, chordsOf(off, "tab.newAgent.aider")]).toEqual([[], [], ["Mod+Alt+Q"]]);
});

test("FIX-1 AltGr: Ctrl+Alt with a typed character that is not the chord's own key is a typed symbol, never a command (Windows and Linux)", () => {
  const ctrlAlt = { ctrlKey: true, altKey: true };
  const map = resolve(null, "win32");
  const hits = (e: Partial<KeyLike>, platform: "win32" | "linux" | "darwin" = "win32") => matchEvent(platform === "win32" ? map : resolve(null, platform), key(e), ["global", "tabs"])?.id ?? null;
  // German AltGr+0 types }, AltGr+Minus (the sz key) types a backslash: neither is zoom
  expect(chordMatches("Mod+Alt+0", key({ ...ctrlAlt, code: "Digit0", key: "}" }), "win32")).toBeNull();
  expect(chordMatches("Mod+Alt+Minus", key({ ...ctrlAlt, code: "Minus", key: "\\" }), "win32")).toBeNull();
  expect(hits({ ...ctrlAlt, code: "Digit0", key: "}" })).not.toBe("ui.zoomReset");
  expect(hits({ ...ctrlAlt, code: "Minus", key: "\\" })).not.toBe("ui.zoomOut");
  // the older chords: Polish AltGr+A types a-ogonek, German AltGr+plus types a tilde
  expect(chordMatches("Mod+Alt+A", key({ ...ctrlAlt, code: "KeyA", key: "ą" }), "win32")).toBeNull();
  expect(chordMatches("Mod+Alt+BracketRight", key({ ...ctrlAlt, code: "BracketRight", key: "~" }), "win32")).toBeNull();
  expect(hits({ ...ctrlAlt, code: "KeyA", key: "ą" })).not.toBe("floatingTerminal.toggle");
  expect(hits({ ...ctrlAlt, code: "BracketRight", key: "~" })).not.toBe("tab.nextSameType");
  // Linux is the same
  expect(chordMatches("Mod+Alt+0", key({ ...ctrlAlt, code: "Digit0", key: "}" }), "linux")).toBeNull();
  // the browser's own AltGraph flag blocks the match even when the key looks right
  const gr = (k: string) => (m: string) => m === k;
  expect(chordMatches("Mod+Alt+0", { ...key({ ...ctrlAlt, code: "Digit0", key: "0" }), getModifierState: gr("AltGraph") }, "win32")).toBeNull();
  expect(chordMatches("Mod+Alt+0", { ...key({ ...ctrlAlt, code: "Digit0", key: "0" }), getModifierState: () => false }, "win32")).toEqual({});
  // an index chord is guarded the same way (AltGr+1 types a pipe on some layouts)
  expect(chordMatches("Mod+Alt+1", key({ ...ctrlAlt, code: "Digit1", key: "|" }), "win32", true)).toBeNull();
  expect(chordMatches("Mod+Alt+1", key({ ...ctrlAlt, code: "Digit3", key: "3" }), "win32", true)).toEqual({ index: 3 });
});

test("FIX-1 AltGr: a real Ctrl+Alt chord still fires, and so does Option on a Mac (it types characters by design)", () => {
  const ctrlAlt = { ctrlKey: true, altKey: true };
  expect(chordMatches("Mod+Alt+0", key({ ...ctrlAlt, code: "Digit0", key: "0" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+Equal", key({ ...ctrlAlt, code: "Equal", key: "=" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+Minus", key({ ...ctrlAlt, code: "Minus", key: "-" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+A", key({ ...ctrlAlt, code: "KeyA", key: "a" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+BracketRight", key({ ...ctrlAlt, code: "BracketRight", key: "]" }), "linux")).toEqual({});
  expect(chordMatches("Mod+Alt+Shift+Equal", key({ ...ctrlAlt, shiftKey: true, code: "Equal", key: "+" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+NumpadAdd", key({ ...ctrlAlt, code: "NumpadAdd", key: "+" }), "win32")).toEqual({});
  expect(chordMatches("Mod+Alt+Left", key({ ...ctrlAlt, code: "Left", key: "Left" }), "win32")).toEqual({});
  // macOS: Option+0 types a degree-like symbol, and the chord is still the zoom reset
  expect(chordMatches("Mod+Alt+0", key({ metaKey: true, altKey: true, code: "Digit0", key: "º" }), "darwin")).toEqual({});
});

test("FIX-2 AltGr: Ctrl+Alt+letter still fires on a non-Latin layout (no AltGr layer), and darwin never reads AltGraph", () => {
  const ctrlAlt = { ctrlKey: true, altKey: true };
  const gr = (m: string) => m === "AltGraph";
  // Russian, Greek, Hebrew, Arabic layouts report the layout letter in key; the physical key still decides
  for (const k of ["ф", "α", "ש", "ش"]) {
    expect(chordMatches("Mod+Alt+A", key({ ...ctrlAlt, code: "KeyA", key: k }), "win32"), k).toEqual({});
    expect(chordMatches("Mod+Alt+A", key({ ...ctrlAlt, code: "KeyA", key: k }), "linux"), k).toEqual({});
  }
  expect(matchEvent(resolve(null, "win32"), key({ ...ctrlAlt, code: "KeyA", key: "ф" }), ["global", "tabs"])?.id).toBe("floatingTerminal.toggle");
  // the AltGraph flag still wins on a non-Latin layout, and a Latin letter that is not the chord's own is still typed text
  expect(chordMatches("Mod+Alt+A", { ...key({ ...ctrlAlt, code: "KeyA", key: "ф" }), getModifierState: gr }, "win32")).toBeNull();
  expect(chordMatches("Mod+Alt+A", key({ ...ctrlAlt, code: "KeyA", key: "ą" }), "win32")).toBeNull();
  // macOS: even if the engine reports AltGraph while Option is held, the chord still fires
  expect(chordMatches("Mod+Alt+0", { ...key({ metaKey: true, altKey: true, code: "Digit0", key: "º" }), getModifierState: gr }, "darwin")).toEqual({});
});

test("TERM-067: select all in a terminal is Cmd+A on macOS and Ctrl+Shift+A elsewhere, so a bare Ctrl+A stays with the shell", () => {
  const a = actions.find((x) => x.id === "terminal.selectAll")!;
  expect(defaultsFor(a, "darwin")).toEqual(["Mod+A"]);
  expect(defaultsFor(a, "win32")).toEqual(["Ctrl+Shift+A"]);
  expect(defaultsFor(a, "linux")).toEqual(["Ctrl+Shift+A"]);
  expect(chordMatches("Ctrl+Shift+A", key({ ctrlKey: true, code: "KeyA", key: "a" }), "linux")).toBeNull();
});

test("TERM-053: Search open tabs is a tab command with its own chord, bound where a terminal has focus, shared with no other command", () => {
  const a = actions.find((x) => x.id === "tab.search")!;
  expect(a.title).toBe("Search open tabs");
  expect(a.scope).toBe("tabs");
  expect(a.terminalSafe).toBe(true);
  const [chord] = defaultsFor(a, "win32");
  expect(chord).toBe("Mod+Shift+K");
  expect(chordMatches(chord, key({ ctrlKey: true, shiftKey: true, code: "KeyK", key: "K" }), "win32")).not.toBeNull();
  const others = actions.filter((x) => x.id !== "tab.search").flatMap((x) => [...defaultsFor(x, "win32"), ...defaultsFor(x, "darwin")]);
  expect(others).not.toContain(chord);
});

test("UX lane C: no two default chords clash in a shared scope on any platform", () => {
  for (const p of ["win32", "linux", "darwin"] as const) expect(resolve({}, p).clashes, p).toEqual([]);
});
