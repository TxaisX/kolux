// LAG-01: the props one pane's terminal gets, built by one pure function. Pane.tsx used to write the whole
// <TerminalPane> element inline, so the element's props were rebuilt for every pane on every window render
// and the terminal's comparator (terminalProps.ts sameTerminal) could not skip a pane whose own readings had
// not moved. The builder reads only the pane and the window's readings, and puts every function in the
// returned props from the caller's `act`, so a pane with unchanged readings gets an equal prop set and skips
// its redraw. It creates no functions and holds no state: the same inputs always give the same props.
import type { Pane } from "../../App";
import type { TerminalProps } from "./terminalProps";
import type { WindowBag } from "../windowBag";
import { gpuOn } from "../../terminal/renderer";
import { showsDragHandle } from "../../terminal/rearrange";
import { showsReview } from "../../terminal/planReview";
import { canExpand, groupOf } from "../../terminal/grid";
import { moveToTab } from "../tidy";
import { nameOf } from "../../workspaces";
import { worktreeTag } from "../../projects/worktreeGrid";

/** The window readings the builder reads. A Pick so the test can hand a small object and the app its bag. */
export type PaneWindow = Pick<
  WindowBag,
  | "settings"
  | "projects"
  | "owner"
  | "names"
  | "savedName"
  | "turn"
  | "hook"
  | "crew"
  | "unreadPanes"
  | "focused"
  | "restoredKeys"
  | "liveRef"
  | "noticeFor"
  | "shown"
  | "terminals"
  | "gridCount"
  | "panes"
  | "zoomed"
  | "classic"
  | "askName"
  | "shells"
  | "agents"
  | "defaultId"
  | "launching"
>;

/** One row of the plus menu's tab list: the panes the window offers to jump to. */
export type EntryTab = { key: number; name: string };

/** The callers Pane.tsx hands the terminal. Each is the terminal prop it feeds; `act` from useStableFns. */
export type PaneActs = {
  openFile: NonNullable<TerminalProps["onOpenFile"]>;
  openLink: NonNullable<TerminalProps["onOpenLink"]>;
  worktree: NonNullable<TerminalProps["onWorktree"]>;
  focus: NonNullable<TerminalProps["onFocus"]>;
  running: NonNullable<TerminalProps["onRunning"]>;
  needsYou: NonNullable<TerminalProps["onNeedsYou"]>;
  identity: NonNullable<TerminalProps["onIdentity"]>;
  guess: NonNullable<TerminalProps["onGuess"]>;
  bell: NonNullable<TerminalProps["onBell"]>;
  pty: NonNullable<TerminalProps["onPty"]>;
  failed: NonNullable<TerminalProps["onFailed"]>;
  restoreFailed: NonNullable<TerminalProps["onRestoreFailed"]>;
  resumeFailed: NonNullable<TerminalProps["onResumeFailed"]>;
  split: NonNullable<TerminalProps["onSplit"]>;
  dragStart: () => void;
  dragEnd: () => void;
  equalize: NonNullable<TerminalProps["onEqualize"]>;
  moveToTab: NonNullable<TerminalProps["onMoveToTab"]>;
  expand: () => void;
  rename: NonNullable<TerminalProps["onRename"]>;
  sessionLaunch: NonNullable<TerminalProps["onSessionLaunch"]>;
  entry: NonNullable<TerminalProps["onEntry"]>;
  shell: NonNullable<TerminalProps["onShell"]>;
  copyId: NonNullable<TerminalProps["onCopyId"]>;
  findHandle: NonNullable<TerminalProps["findHandle"]>;
  close: NonNullable<TerminalProps["onClose"]>;
  reviewPlan: NonNullable<TerminalProps["onReviewPlan"]>;
  setDefault: NonNullable<TerminalProps["onSetDefault"]>;
  launch: NonNullable<TerminalProps["onLaunch"]>;
  choose: NonNullable<TerminalProps["onChoose"]>;
  newChat: NonNullable<TerminalProps["onChat"]>;
  noticePrimary: () => void;
  noticeSecondary: () => void;
};

/** Every prop the terminal element carried when Pane.tsx wrote it out, built from the pane and its readings. */
export function terminalPaneProps(p: Pane, w: PaneWindow, act: PaneActs, at: { hidden: boolean; tabs: EntryTab[] }): TerminalProps {
  const notice = w.noticeFor(p);
  return {
    hidden: at.hidden,
    restored: w.restoredKeys.current.has(p.key),
    identityBefore: w.liveRef.current[p.key],
    resumed: p.resumed,
    onOpenFile: act.openFile,
    onOpenLink: act.openLink,
    linksOpenInKolux: w.settings.linksOpenInKolux === true,
    gpu: gpuOn(w.settings),
    cwd: p.cwd,
    branch: p.branch,
    worktree: worktreeTag(p.cwd, p.branch ?? null, { projects: w.projects, owner: w.owner, names: w.names }),
    onWorktree: act.worktree,
    agent: p.agent,
    name: w.savedName(p),
    program: p.program,
    args: p.args,
    env: p.env,
    stop: w.turn[p.key]?.stop,
    focused: p.key === w.focused,
    onFocus: act.focus,
    onRunning: act.running,
    hook: w.hook[p.key] === "working" && w.turn[p.key]?.monitoring ? "background" : w.hook[p.key],
    pendingTool: w.hook[p.key] === "permission" ? w.turn[p.key]?.tool : undefined,
    keySettings: w.settings,
    crew: w.crew[p.key],
    onNeedsYou: act.needsYou,
    onIdentity: act.identity,
    onGuess: act.guess,
    onBell: act.bell,
    unread: w.unreadPanes.has(p.key),
    onPty: act.pty,
    account: p.account,
    notice: notice && { ...notice, onPrimary: act.noticePrimary, onSecondary: notice.onSecondary && act.noticeSecondary },
    onFailed: act.failed,
    onRestoreFailed: act.restoreFailed,
    onResumeFailed: act.resumeFailed,
    onSplit: act.split,
    dragCell: showsDragHandle(w.shown.length) ? { onStart: act.dragStart, onEnd: act.dragEnd } : undefined,
    onEqualize: w.terminals && w.gridCount > 1 ? act.equalize : undefined,
    onMoveToTab: w.terminals && w.gridCount > 1 && moveToTab(w.panes, p.key) ? act.moveToTab : undefined,
    expand: { on: w.zoomed === groupOf(p), can: canExpand(w.shown.length, w.classic), toggle: act.expand },
    title: p.title || nameOf(w.names, p.cwd),
    custom: !!p.title,
    onRename: act.rename,
    renameAsk: w.askName[p.key],
    sessionKnown: !!p.session,
    session: p.session,
    onSessionLaunch: act.sessionLaunch,
    entryTabs: at.tabs,
    onEntry: act.entry,
    shells: w.shells,
    onShell: act.shell,
    onCopyId: act.copyId,
    findHandle: act.findHandle,
    typed: p.typed,
    shellName: p.word,
    number: p.key,
    onClose: act.close,
    onReviewPlan: showsReview(w.hook[p.key], w.turn[p.key]) ? act.reviewPlan : undefined,
    agents: w.agents,
    defaultId: w.defaultId,
    onSetDefault: act.setDefault,
    launching: w.launching,
    onLaunch: act.launch,
    onChoose: act.choose,
    onChat: act.newChat,
  };
}
