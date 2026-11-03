// UX live audit Wave 3 (T-693 / DT-C129): the sidebar's forms, its title, the Terminals switch and the palette's
// way into Skills. No DOM in this run, so the hook's rule is tested as a pure function and the wiring by source.
import { expect, test } from "vitest";
import { formsToClose } from "./oneForm";
import { screenRows } from "../chrome/reach";
import { commandRows } from "../keys/commands";
import { resolve } from "../keys/keymap";
import { paletteRows } from "../projects/WorktreePalette";
import { toggleSkills } from "../skills/nav";
import { heldByOverlay, OVERLAYS } from "../keys/useWindowKeys";
import type { Screen } from "../chrome/TopBar";
import panel from "../projects/ProjectsPanel.tsx?raw";
import topBar from "./window/TopBar.tsx?raw";
import windowKeys from "../keys/useWindowKeys.ts?raw";
import actions from "../terminal/paneActions.ts?raw";

const none = { filter: false, group: false, create: false, settings: false };

test("F2: opening a form closes the others that are open, and the last opened stays", () => {
  expect(formsToClose(none, { ...none, filter: true })).toEqual([]);
  expect(formsToClose({ ...none, filter: true }, { ...none, filter: true, create: true })).toEqual(["filter"]);
  expect(formsToClose({ ...none, filter: true, group: true }, { filter: true, group: true, create: false, settings: true })).toEqual(["filter", "group"]);
  // closing one, or nothing changing, closes nothing more
  expect(formsToClose({ ...none, filter: true, create: true }, { ...none, create: true })).toEqual([]);
  expect(formsToClose({ ...none, settings: true }, { ...none, settings: true })).toEqual([]);
});

test("F2 + F1: the sidebar wires the one-form rule to its five forms, and Jump hides while one is open", () => {
  expect(panel).toContain("const forms = { filter: filterOpen, group: groupFor !== null, create: creating !== null, settings: settingsFor !== null, add: showAdd };");
  expect(panel).toContain("useOneForm(forms, { filter: () => setFilterOpen(false), group: () => setGroupFor(null), create: () => setCreating(null), settings: () => setSettingsFor(null), add: () => setShowAdd(false) })");
  expect(panel).toContain("canJump={activeDir !== null && !anyForm}");
  expect(panel).toContain("topShown={top.shown && !anyForm}");
  // a create that fails in the background does not close a form opened since
  expect(panel).toContain("if (!formOpen.current) setCreating(project.id);");
});

test("F4: with one view the sidebar shows a Workspaces heading, not a lone tab", () => {
  expect(panel).toContain('<h2 className="sb-heading">Workspaces</h2>');
  expect(panel).toMatch(/NOT_BUILT \? \(\s*<div className="sb-tabs" role="tablist">/);
});

test("F3: the top bar's Terminals switch closes a full page first", () => {
  expect(topBar).toMatch(/onScreen=\{\(s\) => \{\s*if \(s === "terminals"\) setPage\(null\);/);
});

test("F11 (not reproduced): Ctrl+Shift+J opens the palette, 'Show Skills' is its first row, and Enter opens Skills", () => {
  expect(windowKeys).toMatch(/case "worktree\.palette":\s*setPalette\(true\);/);
  expect(actions).toContain('...screenRows((s) => (s === "skills" ? toggleSkills(screen, setScreen) : setScreen(s)))');
  let screen: Screen = "terminals";
  const setScreen = (s: Screen) => void (screen = s);
  const items = [
    ...commandRows(resolve(null, "win32"), [], undefined, () => {}),
    ...screenRows((s) => (s === "skills" ? toggleSkills(screen, setScreen) : setScreen(s))),
  ];
  const rows = paletteRows(items, "Show Skills");
  expect(rows[0].label).toBe("Show Skills");
  rows[0].run();
  expect(screen).toBe("skills");
});

test("F11: an open sidebar form does not hold the palette chord; a menu left open does", () => {
  // a class-only element matched against the real OVERLAYS and STAYS_OPEN lists, so the test follows them
  const sel = (list: string) => list.split(",").map((x) => x.trim());
  const el = (cls: string) => ({ cls, getClientRects: () => ({ length: 1 }), closest: () => null, matches: (s: string) => sel(s).includes(`.${cls}`) });
  const doc = (els: ReturnType<typeof el>[]) => ({ querySelector: () => null, querySelectorAll: (s: string) => els.filter((e) => sel(s).includes(`.${e.cls}`)) });
  expect(sel(OVERLAYS)).toContain(".menu");
  expect(heldByOverlay("worktree.palette", false, doc([]) as never)).toBe(false);
  expect(heldByOverlay("worktree.palette", false, doc([el("sb-form")]) as never), "an open sidebar form").toBe(false);
  expect(heldByOverlay("worktree.palette", false, doc([el("sb-form"), el("menu")]) as never), "a menu left open").toBe(true);
  // the five sidebar forms are .sb-form elements with no dialog or menu role
  for (const m of panel.matchAll(/className={?[`"]sb-form[^>]*>/g)) expect(m[0]).not.toMatch(/role="(dialog|menu|alertdialog)"|aria-modal="true"/);
});
