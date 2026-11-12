// PROJ-034 / COMPAT 5.6: kolux.yaml's `defaultTabs` open in every new workspace. Rust reads the file
// (limits, trimming, colours) and holds back the commands until the repository's "tabs" trust is
// given (SAFE-025); this side asks once, then hands back the tabs to open. It only reports what to
// open; openDefaultTabs (below) is what the workspace-creation flow calls to open them as shell tabs.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Pane } from "../App";
import { cellsOf } from "../terminal/grid";
import { TAB_COLORS, setTabColor, type TabColors } from "../terminal/tabColor";
import { panesIn, sameDir } from "../workspaces";
import { askTrust, trusted, type TrustAnswer, type TrustAsk } from "./TrustPrompt";

/** One default tab; a field the file left out or that failed its limits is null. */
export type SharedTab = { title: string | null; color: string | null; command: string | null };
/** What `workspace_default_tabs` returns: while `ask` is set the commands are already left out. */
export type DefaultTabsOut = { tabs: SharedTab[]; ask: TrustAsk | null; refused: string | null };
type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** The title a default tab shows when the file gave none. */
export const FALLBACK_TAB_TITLE = "Terminal";

/** The words a tab shows: its title, else its command's first word, else the fallback. */
export function tabTitle(t: SharedTab): string {
  return t.title ?? t.command?.trim().split(/\s+/)[0] ?? FALLBACK_TAB_TITLE;
}

/** The default tabs for the new workspace at `path` of the repository at `root`: asks for the
 *  tab commands' trust first when the shared file has any (once per text, or never when the whole
 *  kolux.yaml is trusted). A "Don't run" answer still opens the tabs, without their commands. A
 *  refused file (too big, aliases out of control) gives no tabs and says why. */
export async function defaultTabs(root: string, path: string, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<{ tabs: SharedTab[]; refused: string | null }> {
  await trusted(path, "tabs", { root }, invoke, ask);
  const out = await invoke<DefaultTabsOut>("workspace_default_tabs", { root, path });
  return { tabs: out.tabs, refused: out.refused };
}

/** The palette colour closest to a file colour (`#rgb` / `#rrggbb`), by distance in RGB; null for anything else. */
export function nearestTabColor(hex: string | null): string | null {
  const h = hex?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!h) return null;
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const rgb = (x: string) => [0, 2, 4].map((i) => parseInt(x.slice(1).slice(i, i + 2), 16));
  const want = rgb(`#${full}`);
  const dist = (css: string) => rgb(css).reduce((sum, v, i) => sum + (v - want[i]) ** 2, 0);
  return TAB_COLORS.reduce((best, c) => (dist(c.css) < dist(best.css) ? c : best)).id;
}

/** The shell panes for `tabs`, joining cell `group` as tabs: title as the file gave it (or tabTitle's words), the command typed once the shell is up. */
export function tabPanes(tabs: SharedTab[], dir: string, branch: string | null, nextKey: () => number, group?: number): { panes: Pane[]; colors: Record<number, string> } {
  const panes: Pane[] = [];
  const colors: Record<number, string> = {};
  for (const t of tabs) {
    const key = nextKey();
    const g = group ?? panes[0]?.key;
    panes.push({ key, cwd: dir, branch, agent: "shell", program: null, args: [], title: tabTitle(t), typed: t.command ?? undefined, group: g });
    const color = nearestTabColor(t.color);
    if (color) colors[key] = color;
  }
  return { panes, colors };
}

type OpenDeps = {
  nextKey: MutableRefObject<number>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setTabColors: Dispatch<SetStateAction<TabColors>>;
  /** Told when kolux.yaml was refused, so the user sees why no tabs opened. */
  say: (why: string) => void;
  invoke?: Invoke;
  ask?: (a: TrustAsk) => Promise<TrustAnswer>;
};

/** PROJ-034: opens kolux.yaml's default tabs in the new workspace `dir` of the repository at `root`, beside its first pane, without taking focus. Never throws: a failure is said, not raised.
 *  DT-C274: `view` is the grid a team worktree is shown in: the tabs run in `dir`, are shown there, and join the cell of
 *  the pane that runs in `dir` (its agent), so the team's grid gains tabs, not cells. */
export async function openDefaultTabs(root: string, dir: string, branch: string | null, deps: OpenDeps, view?: string | null): Promise<void> {
  try {
    const { tabs, refused } = await defaultTabs(root, dir, deps.invoke, deps.ask);
    if (refused) deps.say(refused);
    if (tabs.length === 0) return;
    const made = tabPanes(tabs, dir, branch, () => deps.nextKey.current++);
    deps.setPanes((ps) => {
      if (view !== undefined) {
        const mine = cellsOf(panesIn(ps, view)).find((c) => c.panes.some((p) => sameDir(p.cwd, dir)))?.group;
        return [...ps, ...made.panes.map((p) => ({ ...p, view, ...(mine === undefined ? {} : { group: mine }) }))];
      }
      const group = cellsOf(panesIn(ps, dir))[0]?.group;
      return [...ps, ...(group === undefined ? made.panes : made.panes.map((p) => ({ ...p, group })))];
    });
    deps.setTabColors((m) => Object.entries(made.colors).reduce((acc, [k, id]) => setTabColor(acc, Number(k), id), m));
  } catch (err) {
    deps.say(String(err));
  }
}
