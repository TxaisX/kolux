// LAG-01 (board test, hash-locked): a change to one pane must not redraw the other panes' terminals.
// The window draws every pane on each of its renders; a terminal skips its draw only when React.memo's
// comparator (terminalProps.ts sameTerminal) says its props are the same. This test builds the props of
// 12 panes for two window renders in a row with the pure builder the pane uses (paneProps.ts) and COUNTS
// the terminals the comparator would redraw. No clock, no DOM: only counts.
import { describe, expect, test } from "vitest";
import type { Pane } from "../../App";
import { LAYOUT_FIELD } from "../../terminal/layout";
import { callers } from "./stable";
import { sameTerminal, type TerminalProps } from "./terminalProps";
import { terminalPaneProps, type PaneActs, type PaneWindow } from "./paneProps";
import paneRaw from "./Pane.tsx?raw";
import gridRaw from "./Grid.tsx?raw";

const N = 12;
const DIR = "C:/work/app";
const KEYS = Array.from({ length: N }, (_, i) => i + 1);

/** What the window keeps between renders (React state): the same object until someone changes it. */
type State = {
  panes: Pane[];
  settings: Record<string, unknown>;
  hook: Record<number, string>;
  turn: Record<number, Record<string, unknown>>;
  crew: Record<number, Record<string, unknown>>;
  unread: Set<number>;
  askName: Record<number, number>;
  focused: number;
  agents: unknown[];
  gridCount: number;
};

const panesOf = (): Pane[] =>
  KEYS.map((key) => ({ key, cwd: DIR, branch: "main", agent: "claude", agentId: "claude", program: "claude", args: ["--verbose"], group: key })) as unknown as Pane[];

const start = (): State => ({
  panes: panesOf(),
  settings: { theme: "dark" },
  hook: {},
  turn: {},
  crew: {},
  unread: new Set<number>(),
  askName: {},
  focused: 3,
  agents: [{ id: "claude", name: "Claude Code" }],
  gridCount: N,
});

const RESTORED = { current: new Set<number>([11]) };
const LIVE = { current: {} as Record<number, unknown> };

/** One window render: everything a render makes fresh IS made fresh here (the functions, the shown cells, the
 *  project list's tag input, the shell list, the notice), exactly as App.tsx rebuilds its bag each render. */
function windowOf(s: State): PaneWindow {
  return {
    settings: s.settings,
    projects: [{ id: "p1", path: DIR }],
    owner: { [DIR]: "p1" },
    names: {},
    savedName: () => undefined,
    turn: s.turn,
    hook: s.hook,
    crew: s.crew,
    unreadPanes: s.unread,
    focused: s.focused,
    restoredKeys: RESTORED,
    liveRef: LIVE,
    // Pane 4 always shows a question; its object and its two functions are new on every render.
    noticeFor: (p: Pane) =>
      p.key === 4 ? { title: "The Codex setup changed", body: "Restart to use the new one.", primary: "Restart", onPrimary: () => {}, secondary: "Keep this setup", onSecondary: () => {} } : null,
    shown: s.panes.slice(0, s.gridCount).map((p) => ({ group: p.key, panes: [p] })),
    terminals: true,
    gridCount: s.gridCount,
    panes: s.panes,
    zoomed: null,
    classic: false,
    askName: s.askName,
    shells: [{ id: "pwsh", name: "PowerShell" }],
    agents: s.agents,
    defaultId: "claude",
    launching: null,
  } as unknown as PaneWindow;
}

/** Each pane's callers: one object per pane, every name a function that keeps its identity for the pane's life,
 *  which is what useStableFns gives Pane.tsx. */
const ACTS = new Map<number, PaneActs>(KEYS.map((k) => [k, callers<Record<string, () => void>>(() => ({})) as unknown as PaneActs]));
const actOf = (key: number) => ACTS.get(key)!;

type Drawn = { props: Map<number, TerminalProps>; tabs: { key: number; name: string }[] };

/** The props of every terminal for one window render. The tab list is built once per render (Grid.tsx). */
function draw(s: State): Drawn {
  const w = windowOf(s);
  const tabs = s.panes.map((p) => ({ key: p.key, name: `tab ${p.key}` }));
  return { props: new Map(s.panes.map((p) => [p.key, terminalPaneProps(p, w, actOf(p.key), { hidden: false, tabs })])), tabs };
}

/** The panes whose terminal React would draw again between two renders. */
const redrawn = (a: Drawn, b: Drawn): number[] => KEYS.filter((k) => !sameTerminal(a.props.get(k)!, b.props.get(k)!));
const after = (s: State, change: Partial<State>): number[] => redrawn(draw(s), draw({ ...s, ...change }));

describe("LAG-01 one pane's change redraws one terminal", () => {
  test("a window render that changes nothing redraws none of 12 terminals", () => {
    const s = start();
    expect(draw(s).props.size).toBe(N);
    expect(after(s, {})).toEqual([]);
  });

  test("an agent state change in one pane redraws that terminal and not the other 11", () => {
    const s = start();
    expect(after(s, { hook: { ...s.hook, 5: "working" } })).toEqual([5]);
    const asking = { ...s, hook: { 5: "working" } };
    expect(after(asking, { hook: { 5: "permission" }, turn: { 5: { tool: "Bash" } } })).toEqual([5]);
  });

  test("a crew reading, an unread mark and a rename request each reach only their own pane", () => {
    const s = start();
    expect(after(s, { crew: { 7: { agents: 2, tasks: 1 } } })).toEqual([7]);
    expect(after(s, { unread: new Set([9]) })).toEqual([9]);
    expect(after(s, { askName: { 2: 1 } })).toEqual([2]);
  });

  test("focus moving from one pane to another redraws those two terminals only", () => {
    const s = start();
    expect(after(s, { focused: 8 })).toEqual([3, 8]);
  });

  test("readings rebuilt with equal values, and a settings save of the layout alone, redraw nothing", () => {
    const s = { ...start(), hook: { 5: "working" }, turn: { 5: { stop: { reason: "end_turn" } } }, crew: { 7: { agents: 2, tasks: 1 } }, unread: new Set([9]) };
    const again = { hook: { 5: "working" }, turn: { 5: { stop: { reason: "end_turn" } } }, crew: { 7: { agents: 2, tasks: 1 } }, unread: new Set([9]) };
    expect(after(s, again)).toEqual([]);
    expect(after(s, { settings: { ...s.settings, [LAYOUT_FIELD]: { saved: 1 } } })).toEqual([]);
  });

  test("a change every pane shows still reaches all 12 terminals", () => {
    const s = start();
    expect(after(s, { agents: [...s.agents] })).toEqual(KEYS);
    expect(after(s, { settings: { ...s.settings, theme: "light" } })).toEqual(KEYS);
  });

  test("every terminal gets the window's one tab list and a link opener that keeps its identity", () => {
    const s = start();
    const a = draw(s);
    const b = draw(s);
    for (const k of KEYS) {
      expect(a.props.get(k)!.entryTabs).toBe(a.tabs);
      expect(typeof a.props.get(k)!.onOpenLink).toBe("function");
      expect(b.props.get(k)!.onOpenLink).toBe(a.props.get(k)!.onOpenLink);
    }
  });
});

describe("LAG-01 the builder hands the terminal what the pane handed it before", () => {
  const s: State = {
    ...start(),
    panes: panesOf().map((p) => (p.key === 1 ? { ...p, title: "Mine", session: "abc" } : p)),
    hook: { 2: "waiting", 5: "working", 6: "permission" },
    turn: { 2: { tool: "ExitPlanMode", plan: "do it" }, 5: { monitoring: true }, 6: { tool: "Bash" } },
    unread: new Set([9]),
    askName: { 2: 4 },
  };
  const at = (key: number) => draw(s).props.get(key)!;

  test("the pane's own readings", () => {
    expect(at(3).focused).toBe(true);
    expect(at(1).focused).toBe(false);
    expect(at(5).hook).toBe("background");
    expect(at(5).pendingTool).toBeUndefined();
    expect(at(6).hook).toBe("permission");
    expect(at(6).pendingTool).toBe("Bash");
    expect(at(2).hook).toBe("waiting");
    expect(at(9).unread).toBe(true);
    expect(at(8).unread).toBe(false);
    expect(at(2).renameAsk).toBe(4);
    expect(at(11).restored).toBe(true);
    expect(at(1).restored).toBe(false);
    expect(at(1).title).toBe("Mine");
    expect(at(1).custom).toBe(true);
    expect(at(1).sessionKnown).toBe(true);
    expect(at(1).session).toBe("abc");
    expect(at(2).custom).toBe(false);
    expect(at(2).sessionKnown).toBe(false);
    expect(at(7).number).toBe(7);
    expect(at(7).cwd).toBe(DIR);
    expect(at(7).branch).toBe("main");
    expect(at(7).agent).toBe("claude");
    expect(at(7).program).toBe("claude");
    expect(at(7).args).toEqual(["--verbose"]);
    expect(at(7).worktree).toMatchObject({ path: DIR, label: "main" });
    expect(at(7).gpu).toBe(true);
    expect(at(7).linksOpenInKolux).toBe(false);
    expect(at(7).keySettings).toBe(s.settings);
    expect(at(7).agents).toBe(s.agents);
    expect(at(7).defaultId).toBe("claude");
    expect(at(7).hidden).toBe(false);
    expect(terminalPaneProps(s.panes[6], windowOf(s), actOf(7), { hidden: true, tabs: [] }).hidden).toBe(true);
  });

  test("the pane's callers, each on its own prop", () => {
    const p = at(7);
    const act = actOf(7);
    expect(p.onFocus).toBe(act.focus);
    expect(p.onClose).toBe(act.close);
    expect(p.onOpenFile).toBe(act.openFile);
    expect(p.onResumeFailed).toBe(act.resumeFailed);
    expect(p.onRestoreFailed).toBe(act.restoreFailed);
    expect(p.onFailed).toBe(act.failed);
    expect(p.onPty).toBe(act.pty);
    expect(p.onRunning).toBe(act.running);
    expect(p.onNeedsYou).toBe(act.needsYou);
    expect(p.onIdentity).toBe(act.identity);
    expect(p.onGuess).toBe(act.guess);
    expect(p.onBell).toBe(act.bell);
    expect(p.onWorktree).toBe(act.worktree);
    expect(p.onSplit).toBe(act.split);
    expect(p.onRename).toBe(act.rename);
    expect(p.onSessionLaunch).toBe(act.sessionLaunch);
    expect(p.onEntry).toBe(act.entry);
    expect(p.onShell).toBe(act.shell);
    expect(p.onCopyId).toBe(act.copyId);
    expect(p.findHandle).toBe(act.findHandle);
    expect(p.onSetDefault).toBe(act.setDefault);
    expect(p.onLaunch).toBe(act.launch);
    expect(p.onChoose).toBe(act.choose);
    expect(p.onChat).toBe(act.newChat);
    expect(p.expand).toEqual({ on: false, can: true, toggle: act.expand });
  });

  test("the callers that are only there when they apply", () => {
    expect(at(2).onReviewPlan).toBe(actOf(2).reviewPlan);
    expect(at(6).onReviewPlan).toBeUndefined();
    expect(at(7).onEqualize).toBe(actOf(7).equalize);
    expect(at(7).dragCell).toEqual({ onStart: actOf(7).dragStart, onEnd: actOf(7).dragEnd });
    const alone = draw({ ...s, panes: s.panes.slice(0, 1), gridCount: 1 }).props.get(1)!;
    expect(alone.onEqualize).toBeUndefined();
    expect(alone.onMoveToTab).toBeUndefined();
    expect(alone.dragCell).toBeUndefined();
  });

  test("a pane's question keeps its words and runs the pane's two callers", () => {
    const n = at(4).notice!;
    expect(n.title).toBe("The Codex setup changed");
    expect(n.primary).toBe("Restart");
    expect(n.secondary).toBe("Keep this setup");
    expect(n.onPrimary).toBe(actOf(4).noticePrimary);
    expect(n.onSecondary).toBe(actOf(4).noticeSecondary);
    expect(at(7).notice).toBeFalsy();
  });
});

/** The source without comments, so a comment cannot satisfy a check. */
const code = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("LAG-01 wiring", () => {
  test("Pane.tsx draws the terminal from terminalPaneProps and makes no link opener or tab list of its own", () => {
    const pane = code(paneRaw);
    expect(pane).toMatch(/import\s*\{[^}]*\bterminalPaneProps\b[^}]*\}\s*from\s*"\.\/paneProps"/);
    expect(pane).toMatch(/<TerminalPane\b[^<]*\{\.\.\.terminalPaneProps\(/);
    expect(pane).toMatch(/openLink:\s*\(/);
    expect(pane).not.toMatch(/onOpenLink=\{/);
    expect(pane).not.toMatch(/entryTabs=\{/);
    expect(pane).not.toMatch(/panes\s*\.filter\(/);
    expect(pane).not.toMatch(/\btabName\(/);
  });

  test("Grid.tsx builds the tab list once and hands it to every pane", () => {
    const grid = code(gridRaw);
    expect(grid).toMatch(/const tabs\s*=/);
    expect(grid).toMatch(/<Pane\b[^<]*\btabs=\{tabs\}/);
  });
});
