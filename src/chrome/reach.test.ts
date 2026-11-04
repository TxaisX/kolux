// T-610 (brief "Path to an A", Phase 0): no screen is unreachable. Every Screen id is reached from the top
// bar's switcher or from the palette (a command that shows it, or a row of its own), or it is not in the
// union; and the two Boards no longer share a name.
// T-708 (DT-C144): the reachability matrix pinned. Every screen has a palette row of its own, every dialog and
// sheet closes on Escape (the table below), and a hand-built palette row for a command shows the command's keys.
import { expect, test } from "vitest";
import { SCREEN_IDS, screens } from "./TopBar";
import { SCREEN_OF, screenRows } from "./reach";
import { menuScreen } from "./chromeItems";
import { actionById } from "../keys/actions";
import { commandRows } from "../keys/commands";
import { labelOf, resolve } from "../keys/keymap";
import { actions } from "../keys/actions";
import paneActions from "../terminal/paneActions.ts?raw";

/** Every way the palette shows a screen: its Commands rows (the commands SCREEN_OF names) and the screens' own rows. */
function palette(): Set<string> {
  const reached = new Set<string>();
  for (const r of commandRows(resolve(null, "win32"), [], undefined, (id) => SCREEN_OF[id] && reached.add(SCREEN_OF[id]))) r.run();
  for (const r of screenRows((s) => void reached.add(s))) r.run();
  return reached;
}

test("T-610: every Screen id is reachable from the switcher or the palette", () => {
  const switcher = new Set<string>(screens.map((s) => s.id));
  const fromPalette = palette();
  expect(SCREEN_IDS.filter((id) => !switcher.has(id) && !fromPalette.has(id))).toEqual([]);
});

test("T-610: Floor and Space are reached by their own commands, so the palette shows them; the switcher keeps VIEW-002's four", () => {
  expect(SCREEN_OF["view.floor"]).toBe("floor"); // VIEW-013, DT-08: from the palette, no sidebar item
  expect(SCREEN_OF["view.space"]).toBe("space"); // VIEW-014 / PROJ-083
  expect(screens.map((s) => s.id)).toEqual(["agents", "board", "terminals", "tower"]);
  // Each command SCREEN_OF names is a registered command (its row is in the palette's Commands section).
  for (const id of Object.keys(SCREEN_OF)) expect(actionById.has(id), id).toBe(true);
});

test("T-610: the workspace board is reached by its command and is no longer a second Board", () => {
  const title = actionById.get("workspace.openBoard")!.title; // the id stays (COMPAT 4.5, PROJ-085)
  expect(title).toBe("Show Workspace Statuses");
  expect(screens.find((s) => s.id === "board")!.label).toBe("Board"); // VIEW-001's Board keeps its name
  expect(title).not.toMatch(/board/i);
});

test("T-610: Floor is in the View menu too (DT-08), so a Workspace View click on it shows the screen the palette's command shows", () => {
  expect(menuScreen("screen.floor")).toBe(SCREEN_OF["view.floor"]);
  // The switcher's four are there as well, Tower included, so the menu mirrors the top bar.
  for (const s of screens) expect(menuScreen(`screen.${s.id}`), s.id).toBe(s.id);
});

test("T-610 / DT-C68: the palette's Show Floor row prints view.floor's keys once bound; the menu's Floor item prints none", () => {
  const bound = resolve({ version: 1, keybindings: { "view.floor": "Mod+Alt+F" } }, "win32");
  const row = commandRows(bound, [], undefined, () => {}).find((r) => r.label === "Show Floor")!;
  expect(row.hint).toBe("Ctrl+Alt+F");
  expect(commandRows(resolve(null, "win32"), [], undefined, () => {}).find((r) => r.label === "Show Floor")!.hint).toBeUndefined(); // shipped unbound (COMPAT 4.3)
});

test("T-708: every Screen id has a palette row of its own, the switcher's four too", () => {
  const fromPalette = palette();
  expect(SCREEN_IDS.filter((id) => !fromPalette.has(id))).toEqual([]);
});

test("T-708: no hand-built palette row repeats a command; its Commands row, with its keys, is the one", () => {
  const map = resolve(null, "win32");
  const bound = actions.filter((a) => labelOf(map, a.id).length > 0);
  // No hand-built row repeats a bound command by name: its Commands row is the one (New terminal tab, Search open tabs).
  expect(bound.filter((a) => paneActions.includes(`label: "${a.title}"`)).map((a) => a.id)).toEqual([]);
  expect(paneActions).not.toMatch(/tabSearchCommand|section: "Quick actions", label: "(New terminal tab|Search open tabs)"/);
  // Its key works only where tabs are (scope "tabs"); the palette row opens the box from any screen, as the old row did.
  expect(paneActions).toMatch(/commandRows\([^\n]*id === TAB_SEARCH_ACTION \? openTabSearch\(\)/);
});

// Every dialog in the app (an element with role="dialog" or role="alertdialog" in src/**/*.tsx) and how its Escape
// closes it. A new dialog fails the test until it is listed; a listed one fails when its way out is gone.
//   tag:     its own onKeyDown, and focus goes inside when it opens (autoFocus or .focus()), so the key reaches it
//   hook:    its ref is handed to useDialogFocus / trapDialog / useDismiss, which catch Escape on the window
//   inner:   a field inside it takes focus and handles the key
//   parent:  it sits inside another listed dialog, whose Escape closes it
//   wrapper: the element right around it handles the key
//   window:  a keydown listener on the window handles Escape
//   exempt:  why Escape is not this dialog's to take
const DIALOGS: [file: string, label: string, how: string][] = [
  ["agentstart/AgentStartHost.tsx", "Continue in an agent", "hook"],
  ["automations/AutomationDialog.tsx", "editing ? `Edit ${editing.name}` : \"New Automation\"", "tag"],
  ["board/WorkspaceBoard.tsx", "Workspace statuses", "tag"],
  ["browser/BrowserPane.tsx", "Import from Google Chrome", "tag"],
  ["browser/BrowserPane.tsx", "Open an outside address?", "tag"],
  ["browser/BrowserPane.tsx", "leaveText(leave).question", "tag"],
  ["browser/DrawCanvas.tsx", "Draw on the page", "tag"],
  ["browser/GrabSheet.tsx", "Grabbed element", "tag"],
  ["chat/PermissionCard.tsx", "askTitle(card.tool)", "exempt: a card in the chat, its Escape interrupts the agent"],
  ["chat/QuestionCard.tsx", "Question from the agent", "exempt: a card in the chat, its Escape interrupts the agent"],
  ["chrome/Ask.tsx", "title", "hook"],
  ["editor/CloseDialog.tsx", "Save changes before closing?", "tag"],
  ["editor/DiffPane.tsx", "pop.note ? \"Edit review note\" : \"Add review note\"", "inner"],
  ["editor/FilePicker.tsx", "Open a ${what}", "inner"],
  ["editor/NamePrompt.tsx", "Name this note", "tag"],
  ["editor/ReviewNotes.tsx", "Add review note", "inner"],
  ["editor/TemplatePicker.tsx", "Start a note from a template", "inner"],
  ["feedback/FeedbackDialog.tsx", "Send feedback", "tag"],
  ["floating/FloatingLayer.tsx", "label", "tag"],
  ["floating/FloatingLayer.tsx", "Floating workspace panel", "inner"],
  ["onboarding/Guides.tsx", "Getting Started with Kolux", "tag"],
  ["onboarding/Guides.tsx", "Explore Kolux", "hook"],
  ["onboarding/Guides.tsx", "Tip", "window"],
  ["onboarding/Guides.tsx", "Agent status hooks", "exempt: a docked tip, not modal; Not now closes it"],
  ["onboarding/Tours.tsx", "${tour.name} tour", "window"],
  ["onboarding/Wizard.tsx", "Get started with Kolux", "window"],
  ["ports/PortsItem.tsx", "Ports", "window"],
  ["projects/AddProject.tsx", "Add project", "tag"],
  ["projects/AddProject.tsx", "Stop copying?", "parent"],
  ["projects/CleanupDialog.tsx", "Clean up workspaces in ${project.name}", "tag"],
  ["projects/CleanupDialog.tsx", "Confirm removal", "parent"],
  ["projects/ImportSetup.tsx", "Import setup commands", "tag"],
  ["projects/ScanRepos.tsx", "Scan a folder for repositories", "tag"],
  ["projects/StartGit.tsx", "Start Git in this folder", "tag"],
  ["projects/WorktreePalette.tsx", "Switch worktree", "inner"],
  ["recovery/CrashReportDialog.tsx", "Report a crash", "hook"],
  ["recovery/RecoveryMount.tsx", "Graphics", "exempt: the graphics fallback needs one of its two answers"],
  ["scm/PrStart.tsx", "Create pull request", "tag"],
  ["scm/SourceControlPanel.tsx", "Create pull request", "tag"],
  ["scm/SourceControlPanel.tsx", "asking.title ?? \"Resolve conflicts with an agent\"", "tag"],
  ["scm/StackMap.tsx", "Confirm the stack merge", "tag"],
  ["settings/GrokCard.tsx", "Use an xAI API key", "wrapper"],
  ["settings/SettingsPage.tsx", "Settings", "window"],
  ["shell/AboutPanel.tsx", "About Kolux RS", "tag"],
  ["shell/LinkAskDialog.tsx", "w.title", "tag"],
  ["shell/TabSearch.tsx", "Search open tabs", "inner"],
  ["skills/SkillsPage.tsx", "Skill folders", "window"],
  ["skills/SkillUpdate.tsx", "Update Kolux skills", "tag"],
  ["status/manage.tsx", "End ${name}", "exempt: inside the Resource Manager, whose Escape closes it first (T-692)"],
  ["status/manage.tsx", "End ${what}", "exempt: inside the Resource Manager, whose Escape closes it first (T-692)"],
  ["status/ResourceManager.tsx", "Resource Manager", "hook"],
  ["status/ResourceManager.tsx", "bulkQ.label", "parent"],
  ["tasks/NewIssueDialog.tsx", "New issue", "tag"],
  ["tasks/TaskDialog.tsx", "${taskKind(task)} ${task.title}", "tag"],
  ["terminal/BackgroundSessions.tsx", "End ${what}", "exempt: inside the Resource Manager, whose Escape closes it first (T-692)"],
  ["terminal/ForkDialog.tsx", "Fork Agent Session", "tag"],
  ["terminal/PlanSheet.tsx", "Review the plan for ${title}", "inner"],
  ["terminal/TerminalPane.tsx", "notice.title", "tag"],
  ["terminal/TerminalPane.tsx", "Paste ${pasteAsk.lines} lines?", "tag"],
  ["terminal/TerminalPane.tsx", "The shell ended", "tag"],
  ["update/UpdateCenterView.tsx", "Updates", "tag"],
  ["usage/ShareCard.tsx", "Share ${card.providerName} usage", "hook"],
];

const SRC = import.meta.glob(["/src/**/*.tsx", "!/src/**/*.test.tsx", "!/src/**/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Where the open tag starting at `i` ends (braces and quotes skipped, so an arrow's > does not end it). */
function openEnd(s: string, i: number): number {
  let depth = 0;
  let quote = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === quote) quote = "";
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return j + 1;
  }
  return s.length;
}

/** The element's whole source: its open tag through the matching close tag. */
function element(s: string, i: number): string {
  const name = /^<([\w.]+)/.exec(s.slice(i))![1];
  const re = new RegExp(`<(/?)${name.replace(".", "\\.")}\\b`, "g");
  re.lastIndex = i;
  let depth = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[1]) {
      if (--depth === 0) return s.slice(i, s.indexOf(">", m.index) + 1);
      continue;
    }
    const end = openEnd(s, m.index);
    if (s[end - 2] === "/") {
      if (depth === 0) return s.slice(i, end);
      continue;
    }
    depth++;
  }
  return s.slice(i);
}

/** The aria-label as written: the text of a "..." value, or the expression inside {...} (backticks dropped). */
function ariaLabel(tag: string): string {
  const k = tag.indexOf("aria-label=");
  if (k < 0) return "";
  const j = k + "aria-label=".length;
  if (tag[j] === '"') return tag.slice(j + 1, tag.indexOf('"', j + 1));
  for (let e = j, depth = 0; e < tag.length; e++) {
    if (tag[e] === "{") depth++;
    else if (tag[e] === "}" && --depth === 0) return tag.slice(j + 1, e).replace(/^`|`$/g, "");
  }
  return "";
}

type Found = { file: string; src: string; at: number; tag: string; body: string; label: string };
function dialogs(): Found[] {
  const out: Found[] = [];
  for (const [path, src] of Object.entries(SRC)) {
    for (const m of src.matchAll(/(?<=\s)role="(alert)?dialog"/g)) {
      const at = src.lastIndexOf("<", m.index);
      if (!/^<[A-Za-z]/.test(src.slice(at, at + 2))) continue; // a comment or a selector string, not an element
      const tag = src.slice(at, openEnd(src, at));
      out.push({ file: path.replace("/src/", ""), src, at, tag, body: element(src, at), label: ariaLabel(tag) });
    }
  }
  return out;
}

const FOCUS = /autoFocus|\.focus\(\)/;
const ESCAPE = /"Escape"|leavesGrab|escapeClosesForm|dialogStep|leaveKey|escapeLeaves|watchEscape|askKey|nameKey/; // the shared key helpers name it for them
/** The dialog's own key handler: its onKeyDown, or the function it names (onKeyDown={keys} → const keys = ...). */
function handler(d: Found): string {
  const named = /onKeyDown=\{(\w+)\}/.exec(d.tag)?.[1];
  if (!named) return d.tag;
  // the nearest definition above the dialog (two components may use the same name), up to the next definition
  const defs = [...d.src.matchAll(new RegExp(`(const|function) ${named}\\b`, "g"))];
  const def = defs.filter((m) => m.index < d.at).pop() ?? defs[0];
  if (!def) return "";
  const indent = /[ \t]*$/.exec(d.src.slice(0, def.index))![0];
  const rest = d.src.slice(def.index + 1);
  const end = rest.search(new RegExp(`\\n${indent}(const|function|let|useEffect|return) `));
  return d.src.slice(def.index, def.index + 1 + (end < 0 ? 800 : end));
}
/** It takes focus when it opens: autoFocus on it or inside it, .focus() inside it (not its own Escape handler, which
 *  hands focus back on the way out), or a ref inside it that is focused. */
function focuses(d: Found): boolean {
  if (/autoFocus/.test(d.tag) || FOCUS.test(d.body.slice(d.tag.length))) return true;
  // r.current?.focus(), or const el = r.current; ... el.focus()
  return [...d.body.matchAll(/\bref=\{(\w+)\}/g)].some(([, r]) => new RegExp(`\\b${r}\\.current\\??\\.focus\\(|= ${r}\\.current;[^]{0,200}?\\.focus\\(`).test(d.src));
}
function closes(d: Found, how: string, all: Found[]): boolean {
  const ref = /\bref=\{(\w+)\}/.exec(d.tag)?.[1];
  switch (how) {
    case "tag":
      return /onKeyDown=/.test(d.tag) && ESCAPE.test(handler(d)) && focuses(d);
    case "hook":
      return !!ref && new RegExp(`(useDialogFocus|trapDialog|useDismiss)\\(${ref}\\b`).test(d.src);
    case "inner":
      return /onKeyDown=/.test(d.body) && FOCUS.test(d.body) && ESCAPE.test(d.src);
    case "parent":
      return all.some((p) => p !== d && p.file === d.file && p.at < d.at && p.at + p.body.length > d.at);
    case "wrapper":
      return /onKeyDown=[^]*?"Escape"/.test(d.src.slice(Math.max(0, d.at - 600), d.at));
    case "window":
      return /addEventListener\("keydown"|watchEscape\(window/.test(d.src) && ESCAPE.test(d.src);
    default:
      return how.startsWith("exempt: ");
  }
}

// T-714 (tasks.md:17, visual.md:18): how each aria-modal dialog keeps Tab inside it: the shared trapTab in its
// own onKeyDown, a focus hook (useDialogFocus / trapDialog) on its ref, or its own Tab code. A new aria-modal
// dialog fails until it is listed with its trap.
const TRAPS: [file: string, label: string, how: "trapTab" | "hook" | "own"][] = [
  ["agentstart/AgentStartHost.tsx", "Continue in an agent", "hook"],
  ["automations/AutomationDialog.tsx", "editing ? `Edit ${editing.name}` : \"New Automation\"", "trapTab"],
  ["board/WorkspaceBoard.tsx", "Workspace statuses", "trapTab"],
  ["chrome/Ask.tsx", "title", "hook"],
  ["editor/CloseDialog.tsx", "Save changes before closing?", "trapTab"],
  ["editor/NamePrompt.tsx", "Name this note", "trapTab"],
  ["feedback/FeedbackDialog.tsx", "Send feedback", "own"],
  ["floating/FloatingLayer.tsx", "label", "trapTab"],
  ["onboarding/Guides.tsx", "Getting Started with Kolux", "trapTab"],
  ["onboarding/Guides.tsx", "Explore Kolux", "hook"],
  ["onboarding/Wizard.tsx", "Get started with Kolux", "trapTab"],
  ["projects/AddProject.tsx", "Add project", "trapTab"],
  ["projects/ImportSetup.tsx", "Import setup commands", "trapTab"],
  ["projects/ScanRepos.tsx", "Scan a folder for repositories", "trapTab"],
  ["projects/StartGit.tsx", "Start Git in this folder", "trapTab"],
  ["recovery/CrashReportDialog.tsx", "Report a crash", "hook"],
  ["settings/GrokCard.tsx", "Use an xAI API key", "trapTab"],
  ["settings/SettingsPage.tsx", "Settings", "trapTab"], // T-732
  ["shell/LinkAskDialog.tsx", "w.title", "trapTab"],
  ["skills/SkillUpdate.tsx", "Update Kolux skills", "own"],
  ["tasks/NewIssueDialog.tsx", "New issue", "trapTab"],
  ["tasks/TaskDialog.tsx", "${taskKind(task)} ${task.title}", "trapTab"],
  ["terminal/ForkDialog.tsx", "Fork Agent Session", "trapTab"],
  ["terminal/TerminalPane.tsx", "notice.title", "trapTab"],
  ["terminal/TerminalPane.tsx", "Paste ${pasteAsk.lines} lines?", "trapTab"],
  ["terminal/TerminalPane.tsx", "The shell ended", "trapTab"],
  ["usage/ShareCard.tsx", "Share ${card.providerName} usage", "hook"],
];
function traps(d: Found, how: string): boolean {
  const ref = /\bref=\{(\w+)\}/.exec(d.tag)?.[1];
  if (how === "hook") return !!ref && new RegExp(`(useDialogFocus|trapDialog)\\(${ref}\\b`).test(d.src);
  if (how === "own") return /key === "Tab"\) \{|dialogStep\(/.test(handler(d));
  if (!/tabIndex=\{-1\}/.test(d.tag)) return false;
  if (/onKeyDown=\{trapTab\}/.test(d.tag)) return true;
  const h = handler(d);
  const keys = h.slice(Math.max(0, h.indexOf("onKeyDown=")));
  const at = keys.search(/\btrapTab\(e\)/);
  return at >= 0 && !/\breturn\b/.test(keys.slice(0, at));
}

test("T-714: every aria-modal dialog is in the table and keeps Tab inside it the way it says", () => {
  const modal = dialogs().filter((d) => /aria-modal="true"/.test(d.tag));
  const key = (file: string, label: string) => `${file} | ${label}`;
  expect(modal.map((d) => key(d.file, d.label)).sort()).toEqual(TRAPS.map(([f, l]) => key(f, l)).sort());
  const wrong = TRAPS.filter(([f, l, how]) => !traps(modal.find((d) => key(d.file, d.label) === key(f, l))!, how)).map(([f, l, how]) => `${key(f, l)}: ${how}`);
  expect(wrong).toEqual([]);
});

test("T-708: the browser's two asks take focus only in the focused pane (BROW-001)", () => {
  const browser = SRC["/src/browser/BrowserPane.tsx"];
  expect(browser.match(/onClick=\{\(\) => set(Outbound|Leave)\(null\)\}/g)).toHaveLength(2);
  for (const what of ["Outbound", "Leave"]) expect(browser).toMatch(new RegExp(`autoFocus=\\{focused\\} onClick=\\{\\(\\) => set${what}\\(null\\)\\}`));
});

test("T-708: every role=dialog / alertdialog element is in the table and closes on Escape the way it says", () => {
  const all = dialogs();
  const key = (file: string, label: string) => `${file} | ${label}`;
  expect(all.map((d) => key(d.file, d.label)).sort()).toEqual(DIALOGS.map(([f, l]) => key(f, l)).sort());
  const wrong = DIALOGS.filter(([f, l, how]) => !closes(all.find((d) => key(d.file, d.label) === key(f, l))!, how, all)).map(([f, l, how]) => `${key(f, l)}: ${how}`);
  expect(wrong).toEqual([]);
});
