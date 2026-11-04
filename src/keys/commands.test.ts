// T-611 (brief "Path to an A", Phase 0): every command is runnable and none does nothing. The palette's
// Commands section lists every action in actions.ts and runs each through the same code its shortcut
// runs; the commands that had no handler (the audit's five, plus Force Reload and Hard Reload, whose
// chords nothing in the window answered) now each do something, or are gone.
import { expect, test } from "vitest";
import { windowSource as app } from "../shell/windowSource";
import { actions, actionById, sameAs } from "./actions";
import { matchEvent, resolve, type KeyLike } from "./keymap";
import { commandRows, forceReload, reloadAsk, renameTarget, windowCommand } from "./commands";
import { runCommand } from "./runCommand";
import { heldByTerminal } from "./terminalPolicy";
import { SCREEN_OF } from "../chrome/reach";
import { paletteRows } from "../projects/WorktreePalette";
import keysSrc from "./useWindowKeys.ts?raw";
import panelSrc from "../projects/ProjectsPanel.tsx?raw";
import type { Page } from "../projects/ProjectsPanel";

/** Every source file of the window, as text (tests left out). */
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** Files that only list command ids (the table, the palette's rows, the menu's labels, the Shortcuts page's hidden set). */
const LISTS = new Set(["./actions.ts", "./commands.ts", "../chrome/chromeItems.ts", "../settings/shortcutRows.ts"]);
const named = (id: string) => Object.entries(SOURCES).some(([file, text]) => !LISTS.has(file) && text.includes(`"${id}"`));

/** What the window's key switch hands windowCommand (evidence/product-ux-App.patch). */
function spies() {
  const did: string[] = [];
  return { did, calls: { toggleRight: (tab: string) => void did.push(`right:${tab}`), renameWorkspace: () => void did.push("rename"), reload: () => void did.push("reload") } };
}

/** A command has a handler when the window's or a pane's key code names it, windowCommand runs it, it shows a
 *  screen (T-610: the window's key switch reads chrome/reach.ts SCREEN_OF), it is another command under an old id
 *  (sameAs), or it is one of the per-agent new-tab commands App.tsx runs by prefix. */
function handled(id: string): boolean {
  if (sameAs[id]) return handled(sameAs[id]);
  if (windowCommand(id, spies().calls) || SCREEN_OF[id]) return true;
  if (id.startsWith("tab.newAgent.")) return app.includes(`hit.id.startsWith("tab.newAgent.")`);
  return named(id);
}

test("T-611: every action id in actions.ts has a handler", () => {
  expect(actions.filter((a) => !handled(a.id)).map((a) => a.id)).toEqual([]);
});

test("T-611: the five the audit found, Force Reload and Hard Reload each do something (or are gone)", () => {
  // An old id kept for keybindings files that name it runs another command's code.
  expect(sameAs["sidebar.sleepingWorkspaces.toggle"]).toBe("sidebar.sleeping.toggle"); // PROJ-053 / VIEW-053
  expect(sameAs["dashboard.toggle"]).toBe("view.tower"); // VIEW-029 / HID-020: the drawer's always-on successor (OD-09)
  expect(sameAs["browser.hardReload"]).toBe("browser.reload"); // BROW-005, as the same chord already does inside a page
  const { did, calls } = spies();
  for (const id of ["sidebar.checks.toggle", "workspace.rename", "app.forceReload"]) expect(windowCommand(id, calls), id).toBe(true);
  expect(did).toEqual(["right:checks", "rename", "reload"]);
  expect(windowCommand("view.tower", calls)).toBe(false); // the rest stay with the window's own switch
  // VIEW-079 (dropped): the Ports tab is cut, so its command is not registered: a file naming it gets the unknown-id warning.
  expect(actionById.has("sidebar.ports.toggle")).toBe(false);
  expect(resolve({ keybindings: { "sidebar.ports.toggle": "Mod+Shift+I" } }, "darwin").warnings.join(" ")).toMatch(/"sidebar\.ports\.toggle" .* is not a command Kolux knows/);
});

test("T-611: a chord bound to an old id runs the command it stands for", () => {
  const map = resolve({ keybindings: { "dashboard.toggle": "Mod+Alt+9", "sidebar.sleepingWorkspaces.toggle": "Mod+Alt+8" } }, "win32");
  const key = (k: string, code: string): KeyLike => ({ key: k, code, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false });
  expect(matchEvent(map, key("9", "Digit9"), ["global"])).toEqual({ id: "view.tower" });
  expect(matchEvent(map, key("8", "Digit8"), ["global"])).toEqual({ id: "sidebar.sleeping.toggle" });
});

test("T-611: the palette's Commands section lists every command, the unbound ones included, with its keys when it has some", () => {
  const map = resolve(null, "win32");
  const ran: string[] = [];
  const all = actions.filter((a) => a.id.startsWith("tab.newAgent.")).map((a) => a.id.slice("tab.newAgent.".length));
  const rows = commandRows(map, all, undefined, (id, index) => void ran.push(index === undefined ? id : `${id}#${index}`));
  expect(new Set(rows.map((r) => r.section))).toEqual(new Set(["Commands"]));
  for (const r of rows) r.run();
  const ids = new Set(ran.map((x) => x.replace(/#\d$/, "")));
  expect(actions.filter((a) => !ids.has(a.id)).map((a) => a.id)).toEqual([]);
  // Each of the 58 unbound commands has its row; a bound one shows its keys.
  expect(actions.filter((a) => a.win32.length === 0 && !a.darwin).every((a) => ids.has(a.id))).toBe(true);
  expect(rows.find((r) => r.label === "Show Floor")).toMatchObject({ hint: undefined });
  expect(rows.find((r) => r.label === "Open Settings")).toMatchObject({ hint: "Ctrl+," });
  // The two 1 to 9 commands are nine rows each, each with its own digit.
  expect(rows.filter((r) => /^Select Tab \d$/.test(r.label)).map((r) => r.hint)).toEqual(["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8", "Alt+9"]);
  expect(ran).toContain("tab.selectByIndex#9");
  // TERM-041: a new-tab command per installed agent only; one that is not installed is not offered.
  ran.length = 0;
  for (const r of commandRows(map, ["claude"], undefined, (id) => void ran.push(id))) r.run();
  expect(ran.filter((id) => id.startsWith("tab.newAgent."))).toEqual(["tab.newAgent.claude"]);
});

test("T-611: a command picked in the palette runs the same code its shortcut runs, where the keyboard is", () => {
  const map = resolve(null, "win32");
  const target = new EventTarget();
  const heard: Array<string | null> = [];
  // Two key listeners as the window has them: one for the global scope, one for an editor's.
  target.addEventListener("keydown", (e) => heard.push(matchEvent(map, e as unknown as KeyLike, ["global"])?.id ?? null));
  target.addEventListener("keydown", (e) => heard.push(matchEvent(map, e as unknown as KeyLike, ["editor"])?.id ?? null));
  const now = { later: (f: () => void) => f(), target, event: () => new Event("keydown", { bubbles: true, cancelable: true }) };
  runCommand("view.floor", undefined, now); // unbound: no chord could ever have reached it
  expect(heard).toEqual(["view.floor", null]);
  heard.length = 0;
  runCommand("editor.find", undefined, now);
  expect(heard).toEqual([null, "editor.find"]);
  // The index commands carry their digit; a real key press afterwards is only a key press.
  heard.length = 0;
  let index: number | undefined;
  const t2 = new EventTarget();
  t2.addEventListener("keydown", (e) => void (index = matchEvent(map, e as unknown as KeyLike, ["tabs"])?.index));
  runCommand("tab.selectByIndex", 4, { ...now, target: t2 });
  expect(index).toBe(4);
  target.dispatchEvent(new Event("keydown"));
  expect(heard).toEqual([null, null]);
});

test("T-611: with Terminal first, a command picked in the palette is never left to the terminal program", () => {
  const settings = { terminalShortcuts: "terminal" };
  const xterm = { closest: (s: string) => (s === ".xterm" ? {} : null) } as unknown as Element;
  expect(heldByTerminal("view.floor", settings, xterm)).toBe(true); // a chord pressed in a terminal goes to its program
  const target = new EventTarget();
  let held: boolean | null = null;
  target.addEventListener("keydown", () => void (held = heldByTerminal("view.floor", settings, xterm)));
  runCommand("view.floor", undefined, { later: (f) => f(), target, event: () => new Event("keydown") });
  expect(held).toBe(false);
});

test("T-611: Rename worktree from the palette on the Board with the sidebar collapsed: the sidebar mounts with empty lists, the request waits for them, then renames the workspace in front", () => {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const projects = [{ id: "p1" }, { id: "p2" }];
  const row = { path: "C:/code/app-fix" };
  // The panel just mounted: no project and no list yet. Nothing to rename, and nothing to give up on.
  expect(renameTarget("C:/code/app-fix", [], {}, same)).toBe("wait");
  expect(renameTarget("C:/code/app-fix", projects, { p1: [] }, same)).toBe("wait");
  // The lists arrive: the row in front is renamed.
  expect(renameTarget("C:/code/app-fix", projects, { p1: [], p2: [{ path: "C:/code/other" }, row] }, same)).toBe(row);
  // Every list is in and none holds the workspace in front, or nothing is in front: say so (and drop the request).
  expect(renameTarget("C:/code/gone", projects, { p1: [], p2: [row] }, same)).toBe("none");
  expect(renameTarget(null, projects, {}, same)).toBe("none");
});

test("review of PR #16: a command whose place is not open says so instead of doing nothing, and stays listed", () => {
  const map = resolve({}, "win32");
  const target = new EventTarget();
  // Only the window's own listener is live: no browser pane, editor, explorer or Settings is open.
  target.addEventListener("keydown", (e) => void matchEvent(map, e as unknown as KeyLike, ["global", "tabs"]));
  const notes: string[] = [];
  const now = { later: (f: () => void) => f(), target, event: () => new Event("keydown", { bubbles: true, cancelable: true }), unanswered: (t: string) => void notes.push(t) };
  runCommand("browser.reload", undefined, { ...now, scope: "browser" });
  runCommand("editor.find", undefined, { ...now, scope: "editor" });
  runCommand("view.floor", undefined, { ...now, scope: "global" }); // the window took it: no note
  expect(notes).toEqual(["Open a browser pane first.", "Open a file in an editor tab first."]);
  // With a browser pane listening, the same command runs there and nothing is said.
  target.addEventListener("keydown", (e) => void matchEvent(map, e as unknown as KeyLike, ["browser"]));
  runCommand("browser.reload", undefined, { ...now, scope: "browser" });
  expect(notes).toHaveLength(2);
  // The palette passes the command's own scope and its note line; every command is still a row.
  const said: string[] = [];
  const rows = commandRows(map, [], (t) => void said.push(t));
  expect(rows.some((r) => r.label === actionById.get("browser.reload")!.title)).toBe(true);
});

test("review of PR #16: Force Reload asks first when an editor holds unsaved changes, and reloads at once when none does", () => {
  const asked: string[][] = [];
  let reloads = 0;
  const reload = () => void reloads++;
  // Nothing unsaved: no question, it reloads.
  expect(forceReload([], (files) => void asked.push(files), reload)).toBe(true);
  expect([asked.length, reloads]).toEqual([0, 1]);
  // Unsaved text: the app's own question opens and nothing reloads until its Reload button is pressed.
  expect(forceReload(["notes.md"], (files) => void asked.push(files), reload)).toBe(false);
  expect(asked).toEqual([["notes.md"]]);
  expect(reloads).toBe(1);
  expect(reloadAsk(["notes.md"])).toEqual({ title: "Reload with unsaved changes?", body: "Reload Kolux? Unsaved changes in notes.md will be lost.", confirm: "Reload without saving" });
  expect(reloadAsk(["a.ts", "b.ts", "c.ts", "d.ts"]).body).toBe("Reload Kolux? Unsaved changes in a.ts, b.ts, c.ts and 1 more will be lost.");
});

test("review of PR #16 (a): Force Reload's question is the app's own dialog (chrome/Ask), never the browser's confirm", () => {
  expect(app.includes("window.confirm("), "App.tsx asks nothing through window.confirm").toBe(false);
  expect(app).toMatch(/forceReload\(unsaved\.current, setReloadAsk,/);
  expect(app).toMatch(/<Ask \{\.\.\.reloadAsk\(reloadAsking\)\}/);
});

test("T-728: a command's keywords find it in the palette, after rows that match on their own words", () => {
  const rows = commandRows(resolve(null, "win32"), []);
  expect(paletteRows(rows, "cron").map((r) => r.label)).toContain("Open Automations");
  expect(paletteRows(rows, "preferences").map((r) => r.label)).toContain("Open Settings");
  const ranked = paletteRows([{ section: "Commands", label: "Run cron now", run: () => {} }, ...rows], "cron").map((r) => r.label);
  expect(ranked.indexOf("Run cron now")).toBeLessThan(ranked.indexOf("Open Automations"));
  expect(paletteRows(rows, "cron zzzz")).toEqual([]);
});

test("T-727: the palette finds Model Routing by routing, model or route, and running it opens the routing page", () => {
  const ran: string[] = [];
  const rows = commandRows(resolve(null, "win32"), [], undefined, (id) => void ran.push(id));
  for (const q of ["routing", "model", "route", "Model routing"]) {
    const hit = paletteRows(rows, q).find((r) => r.label === "Model Routing");
    expect(hit, `"${q}" shows it`).toBeTruthy();
    hit!.run();
  }
  expect(ran).toEqual(["view.routing", "view.routing", "view.routing", "view.routing"]);
  // every case of the window's page switch is a page: the id after "view." must be one of ProjectsPanel's pages
  const PAGES = { automations: 1, routing: 1, tasks: 1 } satisfies Record<Page, 1>;
  const group = keysSrc.match(/((?:case "view\.\w+":\s*)+)\{[^]*?hit\.id\.slice\(5\)/)?.[1] ?? "";
  const ids = [...group.matchAll(/"view\.(\w+)"/g)].map((m) => m[1]);
  expect(ids.sort()).toEqual(Object.keys(PAGES).sort());
  expect(panelSrc).toContain('onPage("routing")');
});
