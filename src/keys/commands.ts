// T-611 (brief "Path to an A", Phase 0): every command is runnable and none does nothing. The palette's
// Commands section lists every command in actions.ts, the 56 unbound ones included, and runs each through
// the same code its shortcut runs (runCommand.ts). windowCommand is what the window's key switch does for
// the commands it had no case for (evidence/product-ux-App.patch).
import { actionById, actions, sameAs } from "./actions";
import { labelOf, type Keymap } from "./keymap";
import { runCommand } from "./runCommand";
import type { PaletteItem } from "../projects/WorktreePalette";

/** One palette row per command; the two 1 to 9 commands get a row per digit, and TERM-041's new-tab
 *  commands one per installed agent. The hint is the command's keys, when it has some. */
/** `note` shows the line the palette says when no open place takes a command (review of PR #16: never silent). */
export function commandRows(map: Keymap, installed: readonly string[], note?: (text: string) => void, run: (id: string, index?: number) => void = (id, index) => runCommand(id, index, { scope: actionById.get(id)?.scope, unanswered: note })): PaletteItem[] {
  return actions.flatMap((a): PaletteItem[] => {
    if (sameAs[a.id] || (a.id.startsWith("tab.newAgent.") && !installed.includes(a.id.slice("tab.newAgent.".length)))) return []; // T-760: an old id is not a second row
    const keys = labelOf(map, a.id);
    const keywords = a.keywords?.join(" "); // T-728: "cron" finds Open Automations
    if (!a.index) return [{ section: "Commands", label: a.title, hint: keys.join("+") || undefined, keywords, run: () => run(a.id) }];
    return Array.from({ length: 9 }, (_, i) => ({
      section: "Commands",
      label: a.title.replace(/1.9$/, String(i + 1)),
      hint: keys.length ? [...keys.slice(0, -1), String(i + 1)].join("+") : undefined,
      keywords,
      run: () => run(a.id, i + 1),
    }));
  });
}

/** What windowCommand asks the window to do. */
export type WindowCalls = { toggleRight: (tab: "checks") => void; renameWorkspace: () => void; reload: () => void };

/** T-611: the commands the window's key switch had no case for; true when `id` is one of them. */
export function windowCommand(id: string, w: WindowCalls): boolean {
  switch (id) {
    case "sidebar.checks.toggle": // VIEW-057 / GIT-029: the right sidebar's Checks tab, closed again when it is showing
      w.toggleRight("checks");
      return true;
    case "workspace.rename": // PROJ-059: the sidebar starts the inline rename of the workspace in front
      w.renameWorkspace();
      return true;
    case "app.forceReload": // APP-009: the same reload as the View menu's Force Reload (menu.rs sends it to the page, UX lane C)
      w.reload();
      return true;
  }
  return false;
}

/** T-611 (PROJ-059): what a pending workspace.rename does with the sidebar's lists: rename the row of the
 *  workspace in front, say there is none ("none"), or wait ("wait"): a sidebar the command just opened lists
 *  nothing until its first scan, so the request is held until it is served, never dropped on an empty list. */
export function renameTarget<W extends { path: string }>(activeDir: string | null, projects: readonly { id: string }[], lists: Record<string, readonly W[]>, same: (a: string, b: string) => boolean): W | "none" | "wait" {
  if (activeDir === null) return "none";
  const w = projects.flatMap((p) => lists[p.id] ?? []).find((x) => same(x.path, activeDir));
  if (w) return w;
  return projects.length > 0 && projects.every((p) => p.id in lists) ? "none" : "wait";
}

/** Review of PR #16 (APP-009): Force Reload throws away what the page holds, so with unsaved editor text it asks
 *  first and reloads only on yes; with none it reloads at once. `ask` opens the app's own question (chrome/Ask, as
 *  the close question does, reloadAsk below) and its Reload button reloads. True when it reloaded now. */
export function forceReload(unsaved: readonly string[], ask: (files: string[]) => void, reload: () => void): boolean {
  if (unsaved.length > 0) {
    ask([...unsaved]);
    return false;
  }
  reload();
  return true;
}

/** The sentence Force Reload's question says over unsaved text, naming up to three files. */
export function reloadQuestion(unsaved: readonly string[]): string {
  const names = unsaved.length > 3 ? `${unsaved.slice(0, 3).join(", ")} and ${unsaved.length - 3} more` : unsaved.join(", ");
  return `Reload Kolux? Unsaved changes in ${names} will be lost.`;
}

/** Review of PR #16 (a): Force Reload's question in the app's own dialog (chrome/Ask), worded like the close question. */
export function reloadAsk(unsaved: readonly string[]): { title: string; body: string; confirm: string } {
  return { title: "Reload with unsaved changes?", body: reloadQuestion(unsaved), confirm: "Reload without saving" };
}
