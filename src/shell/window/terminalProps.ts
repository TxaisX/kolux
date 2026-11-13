// PKG-2 (narrow the redraw): when a terminal pane may skip a render. Every prop is named with how it is compared;
// one nobody listed redraws (stable.ts sameProps). Functions are compared by identity: Pane.tsx hands over callers
// with a fixed identity (useStableFns) for the ones TerminalPane runs from handlers and effects, and TerminalPane
// calls none of its function props while it draws (it only tests whether one is there, which presence covers).
import type { ComponentProps } from "react";
import type TerminalPane from "../../terminal/TerminalPane";
import { LAYOUT_FIELD } from "../../terminal/layout";
import { LAST_SCREEN_FIELD } from "../../settings/general";
import { sameData, sameProps } from "./stable";

export type TerminalProps = ComponentProps<typeof TerminalPane>;
type Card = NonNullable<TerminalProps["card"]>;
type Notice = NonNullable<TerminalProps["notice"]>;

/** The Board card: its chip and meter by value (they are made fresh each render). */
export const sameCard = sameProps<Card>({ expanded: "same", onToggle: "same", chip: "data", onAnswer: "same", onReview: "same", column: "same", meter: "data" });
/** ACCT-064: the question over the terminal. */
export const sameNotice = sameProps<Notice>({ title: "same", body: "same", primary: "same", onPrimary: "same", secondary: "same", onSecondary: "same" });
const sameExpand = sameProps<NonNullable<TerminalProps["expand"]>>({ on: "same", can: "same", toggle: "same" });
const sameDrag = sameProps<NonNullable<TerminalProps["dragCell"]>>({ onStart: "same", onEnd: "same" });

/** The settings fields the window rewrites as the user works (every focus and tab change saves the layout, every
 *  screen switch the screen, and the save comes back as a new settings object), which a pane never reads. */
const WINDOW_STATE = new Set<string>([LAYOUT_FIELD, LAST_SCREEN_FIELD]);
let lastPair: [unknown, unknown, boolean] | null = null;

/** The settings by value, leaving out the window's own saved state; any other field that changes redraws. A terminal
 *  pane's key policy reads them (keys/terminalPolicy.ts), and so does the project list (ProjectsMemo.tsx); neither
 *  reads the saved layout or screen. One answer per pair, however many panes ask. */
export function sameSettings(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (lastPair && lastPair[0] === a && lastPair[1] === b) return lastPair[2];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let same = true;
  for (const k of keys) if (!WINDOW_STATE.has(k) && !sameData(a[k], b[k])) same = false;
  lastPair = [a, b, same];
  return same;
}

/** True when a terminal pane would draw the same: React.memo's comparator for TerminalPane. */
export const sameTerminal = sameProps<TerminalProps>({
  hidden: "same",
  gpu: "same",
  name: "same",
  plan: "same",
  usage: "data", // readoutOf makes a new object each render
  cwd: "same",
  branch: "same",
  worktree: "data", // made fresh each render from the project list
  onWorktree: "same",
  focused: "same",
  agent: "same",
  program: "same",
  args: "data",
  env: "data",
  onRunning: "same",
  onNeedsYou: "same",
  onIdentity: "same",
  onGuess: "same",
  hook: "same",
  pendingTool: "same",
  keySettings: sameSettings, // read through a ref by the key handler, never while drawing
  crew: "data",
  stop: "data",
  onBell: "same",
  unread: "same",
  onPty: "same",
  onFailed: "same",
  onRestoreFailed: "same",
  title: "same",
  typed: "same",
  shellName: "same",
  custom: "same",
  onRename: "same",
  renameAsk: "same",
  sessionKnown: "same",
  onCopyId: "same",
  findHandle: "same",
  number: "same",
  onFocus: "same",
  onClose: "same",
  onReviewPlan: "same",
  session: "same",
  onSessionLaunch: "same",
  entryTabs: "data", // the plus menu's open tabs, rebuilt each render
  onEntry: "same",
  shells: "data", // read again after every settings save
  onShell: "same",
  agents: "same",
  launching: "same",
  onLaunch: "same",
  defaultId: "same",
  onSetDefault: "same",
  onChoose: "same",
  onSplit: "same",
  dragCell: sameDrag,
  onEqualize: "same",
  onMoveToTab: "same",
  expand: sameExpand,
  card: sameCard,
  account: "same",
  notice: sameNotice,
  restored: "same",
  identityBefore: "data", // read once, at mount; compared anyway so no prop is left out
  clipboardFromPrograms: "same",
  linksOpenInKolux: "same",
  onOpenLink: "same",
  onOpenFile: "same",
  resumed: "same",
}, "terminal");
