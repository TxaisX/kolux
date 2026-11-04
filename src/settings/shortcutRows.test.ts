// SET-008 / SET-010 (T-096-a): the Shortcuts page rows, filters, badges and search.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ShortcutsPage from "./ShortcutsPage";
import { expect, test } from "vitest";
import { actions } from "../keys/actions";
import { resolve } from "../keys/keymap";
import { filterRows, MAX_QUERY, shortcutRows } from "./shortcutRows";

const rows = (file: unknown = null) => shortcutRows(resolve(file, "win32"));
const ids = (r: ReturnType<typeof rows>) => r.map((x) => x.id);

test("every command is listed under its area with its chords and badges", () => {
  const all = rows({ keybindings: { "zoom.reset": "Mod+Alt+9", "zoom.in": null, "view.tasks": "Mod+Alt+Q", "worktree.quickOpen": "Mod+Alt+Q" } });
  expect(all.length).toBe(139); // every command (view.routing added (T-727), Source Control toggle removed, T-644), OpenCode's new-tab command included (T-572), Reopen closed tab included again (T-239), view.space added (T-146-e), Grab Page Element routed (T-240), view.automations and focus.chrome added (UX lane C)
  expect(ids(all)).toContain("tab.reopenClosed");
  const by = (id: string) => all.find((r) => r.id === id)!;
  expect(by("terminal.clear")).toMatchObject({ area: "Terminal", labels: ["Ctrl+K"], badges: [] });
  expect(by("zoom.reset").badges).toEqual(["Modified"]);
  expect(by("zoom.in").badges).toEqual(["Unassigned"]);
  expect(by("view.code").badges).toEqual([]);
  expect(by("workspace.openBoard").badges).toEqual(["Unassigned"]);
  expect(by("view.tasks").badges).toEqual(["Unassigned", "Conflicts"]);
  // Both overrides were dropped (user against user), but the file still holds them, so the rows still offer Reset.
  expect([by("view.tasks").custom, by("worktree.quickOpen").custom]).toEqual([true, true]);
  expect(by("worktree.quickOpen").badges).toEqual(["Conflicts"]);
  expect(by("worktree.quickOpen").hint).toBe("Ctrl+Alt+Q is also used by Open Tasks here. Give one of them other keys.");
});

test("filters: all, modified, unassigned, conflicting", () => {
  const all = rows({ keybindings: { "zoom.reset": "Mod+Alt+9", "zoom.in": null, "view.tasks": "Mod+Alt+Q", "worktree.quickOpen": "Mod+Alt+Q" } });
  expect(filterRows(all, "all", "").length).toBe(139);
  expect(ids(filterRows(all, "modified", ""))).toEqual(["zoom.in", "zoom.reset"]);
  expect(filterRows(all, "unassigned", "").every((r) => r.labels.length === 0)).toBe(true);
  expect(ids(filterRows(all, "unassigned", ""))).toContain("zoom.in");
  expect(ids(filterRows(all, "conflicting", ""))).toEqual(["worktree.quickOpen", "view.tasks"]);
});

test("search: titles, areas, ids and chords for every platform, as written or as drawn", () => {
  const all = rows();
  for (const q of ["Mod+K", "ctrl+k", "Ctrl + K"]) expect(ids(filterRows(all, "all", q)), q).toContain("terminal.clear");
  expect(ids(filterRows(all, "all", "clear active"))).toEqual(["terminal.clear"]);
  expect(ids(filterRows(all, "all", "fileExplorer.copyPath"))).toEqual(["fileExplorer.copyPath"]);
  expect(filterRows(all, "all", "file explorer").length).toBe(5);
  // macOS chords count: Cmd+D splits right there.
  expect(ids(filterRows(all, "all", "Cmd+D"))).toContain("terminal.splitRight");
  expect(ids(filterRows(all, "all", "cls"))).toEqual(["terminal.clear"]);
  // An enormous paste is cut to MAX_QUERY characters, not searched whole.
  expect(filterRows(all, "all", "k".repeat(MAX_QUERY * 50))).toEqual([]);
});

test("groups the commands by area under the four filters and a capped search box", () => {
  const html = renderToString(createElement(ShortcutsPage));
  for (const f of ["All", "Modified", "Unassigned", "Conflicting"]) expect(html).toContain(`>${f}</button>`);
  expect(html).toContain(`maxLength="${MAX_QUERY}"`);
  for (const area of ["General", "Terminal", "File explorer"]) expect(html).toContain(`<h3 class="keys-area">${area}</h3>`);
  expect(html).toContain('data-id="terminal.clear"');
});

test("SET-010 (T-248-b): a global command on a chord the macOS menu owns conflicts with that menu item", () => {
  const quit = [{ chord: "Mod+Q", name: "Quit Kolux" }];
  const mac = (file: unknown, native = quit) => shortcutRows(resolve(file, "darwin"), native);
  const by = (r: ReturnType<typeof rows>, id: string) => r.find((x) => x.id === id)!;
  // Nothing bound there by default: no clash, with or without the menu's chords.
  expect(mac(null).filter((r) => r.badges.includes("Conflicts"))).toEqual([]);
  const hit = by(mac({ keybindings: { "view.tasks": "Mod+Q" } }), "view.tasks");
  expect(hit.badges).toContain("Conflicts");
  expect(hit.hint).toBe("Cmd+Q is also used by Quit Kolux in the menu here. Give one of them other keys.");
  expect(ids(filterRows(mac({ keybindings: { "view.tasks": "Mod+Q" } }), "conflicting", ""))).toEqual(["view.tasks"]);
  // Another spelling of the same chord still counts; a smaller scope is not shadowed by the menu.
  expect(by(mac({ keybindings: { "view.tasks": "Cmd+Q" } }), "view.tasks").badges).toContain("Conflicts");
  expect(by(mac({ keybindings: { "terminal.clear": "Mod+Q" } }), "terminal.clear").badges).not.toContain("Conflicts");
  // Windows and Linux report no native chords, so nothing changes there.
  expect(by(shortcutRows(resolve({ keybindings: { "view.tasks": "Mod+Q" } }, "win32"), []), "view.tasks").badges).not.toContain("Conflicts");
  // Two commands on the menu's chord clash with each other first (the keymap drops both), as before.
  expect(by(mac({ keybindings: { "view.tasks": "Mod+Q", "view.code": "Mod+Q" } }), "view.tasks").hint).toContain("is also used by Show Code here");
});

test("SET-019 (T-246-c): the interface zoom has its own keys, apart from the terminal zoom ones", () => {
  const all = rows();
  const by = (id: string) => all.find((r) => r.id === id)!;
  expect(by("ui.zoomIn")).toMatchObject({ title: "Zoom Interface In", area: "General", labels: ["Ctrl+Alt+="], badges: [] });
  expect(by("ui.zoomOut").labels).toEqual(["Ctrl+Alt+-"]);
  expect(by("ui.zoomReset").labels).toEqual(["Ctrl+Alt+0"]);
  // The terminal zoom keys stay as they were (TERM-078), and nothing in the table shares the new chords.
  expect(by("zoom.in").labels).toEqual(["Ctrl+=", "Ctrl+Shift++", "Ctrl+Numpad +"]);
  expect(by("zoom.reset").labels).toEqual(["Ctrl+0"]);
  expect(all.filter((r) => r.badges.includes("Conflicts"))).toEqual([]);
  expect(shortcutRows(resolve(null, "darwin")).find((r) => r.id === "ui.zoomOut")!.labels).toEqual(["Option+Cmd+-"]);
  // They stay live while a terminal has focus under the terminal-first policy, like the other zoom keys.
  for (const id of ["ui.zoomIn", "ui.zoomOut", "ui.zoomReset"]) expect(actions.find((a) => a.id === id)).toMatchObject({ scope: "global", terminalSafe: true, group: "menu" });
  expect(ids(filterRows(all, "all", "bigger"))).toContain("ui.zoomIn");
  expect(ids(filterRows(all, "all", "Reset Interface"))).toEqual(["ui.zoomReset"]);
});

// AFTER row 382 (T-164-b): a command nothing runs yet is not offered as a row to rebind.
test("commands with no handler yet are not listed, wired ones still are", () => {
  const ids = rows().map((r) => r.id);
  expect(ids).toContain("browser.hardReload"); // T-611: it runs as Reload (keys/actions.ts sameAs)
  expect(ids).toContain("browser.grabElement"); // T-240: the browser pane runs it
  expect(ids).toContain("browser.find");
  expect(ids).toContain("editor.replace");
  expect(ids).toContain("editor.toggleWordWrap");
});

test("SET-010 box 1: a custom chord on a default's chord flags both rows Conflicts and lists them under Conflicting", () => {
  const holder = rows().find((r) => r.chords.join() === "Mod+P")!; // the shipped holder of Mod+P
  expect(holder).toBeDefined();
  const all = rows({ keybindings: { "workspace.openBoard": "Mod+P" } });
  const by = (id: string) => all.find((r) => r.id === id)!;
  expect(by("workspace.openBoard").badges).toEqual(["Modified", "Conflicts"]);
  expect(by(holder.id).badges).toContain("Conflicts");
  expect(by(holder.id).hint).toContain("Ctrl+P is also used by Show Workspace Statuses"); // T-610: the workspace board's new name
  expect(ids(filterRows(all, "conflicting", "")).sort()).toEqual(["workspace.openBoard", holder.id].sort());
  // The custom binding still wins the chord (yieldToUser).
  expect(by("workspace.openBoard").chords).toEqual(["Mod+P"]);
  expect(by(holder.id).chords).not.toContain("Mod+P");
});

test("SET-010 box 1: a custom chord that shares nothing with a default raises no Conflicts", () => {
  const all = rows({ keybindings: { "workspace.openBoard": "Mod+Alt+9" } });
  expect(filterRows(all, "conflicting", "")).toEqual([]);
});

test("SET-011 box 1: a null entry shows Unassigned, not Disabled", () => {
  const row = rows({ keybindings: { "terminal.clear": null } }).find((r) => r.id === "terminal.clear")!;
  expect([row.labels, row.badges]).toEqual([[], ["Unassigned"]]);
});
