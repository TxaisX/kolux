// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useRef, useState } from "react";
import { branchChip, crewLabel, crewLine, foundAgent, headerOf, takesInband, type Crew } from "./status";
import { creditedLive, launchedAgent, titleGuess } from "../status/credit";
import { inbandTurn } from "../status/inbandSession";
import { followedTitle, Gate, IDLE, printsMarks, READY_WAIT_MS, reduceIdentity, Scanner, shownAgent, Startup, type Identity } from "./shellMarks";
import PaneMenu, { fromKeys, menuKey, paneMenuItems, withChord } from "./PaneMenu";
import { contextText, sessionMenuActions, type Launch } from "./sessionFork";
import ForkDialog from "./ForkDialog";
import ShellMark from "./ShellMark";
import { shellIconOf, type ShellEntry } from "./shellChoice";
import type { EntryTarget } from "../launch/newTabEntryRun";
import { bellGate } from "./bellNote";
import LinkActionMenu from "./LinkActionMenu";
import { copyTextOf, destinationOf, doorOfItem, linkMenuItems, openFailed, opensMenu, planClick, type Door, type LinkItemId } from "./linkMenu";
import type { Chip } from "../board/chip";
import { ChipRow } from "../board/ChipRow";
import type { AgentState } from "../projects/rows";
import { invoke } from "@tauri-apps/api/core";
import { withMilestones } from "../onboarding/milestoneNote";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { xtermLogger } from "./xtermLogger";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, watchResume, type RendererMode } from "./renderer";
import { copySelection } from "./copy";
import { killsOnUnmount, windowGeneration } from "./paneGeneration";
import { HeldKeys, screenLines, shouldRefocus, watchScale } from "./recover";
import { decodeOutput, endedLabel, forPane, type ExitEvent, type OutputEvent } from "./codec";
import { notePrinted } from "../browser/preview";
import { afterReplay, encodeHistory, replay, replayGate, viewTop } from "./history";
import { claimsClick } from "./linkClick";
import { modeView, resetAfterExit } from "./modeReset";
import { dragWantsHint, SHIFT_HINT, shownAgain, WheelDrain, type KeptView } from "./mouseFeel";
import { fromThisService, orphanOf, reattach, type Attach, type Reattached, type ServiceInfo } from "./reattach";
import { keepsTab } from "./restoreAsk";
import { batchAcks, memoryProfile } from "./flow";
import { frameOutputs, type FrameOutput } from "./frame";
import { explain as explainError, exitAdvice } from "./errors";
import { DIVIDER_DONE, dragging } from "./dividers";
import { currentDark, currentTerminal, TERMINAL_EVENT, termFont } from "../theme";
import { currentText, optionsOf, TEXT_EVENT } from "./text";
import { currentInput, INPUT_EVENT, inputOptions, loadLigatures, middlePastes, middleSource, probeGpu, watchPointer } from "./inputWire";
import { ligaturesOn, preferGpu, yenToBackslash } from "./inputPrefs";
import { hookColourMode } from "./colourMode";
import { hookQueries, isGrok, paletteIsDark } from "./queries";
import { applySnapshot, base64Bytes, resyncGate, type Snapshot } from "./resync";
import { folderName } from "../projects/model";
import { withoutRules } from "../launch/seats";
import { modelOf } from "../settings/routing";
import { openSettings } from "../settings/pages";
import { answerKeys, buttonsShown, canAnswer, nextPrompt } from "./permissionAnswer";
import { Close, Dots, Expand, Plus, SplitRight, StatusGlyph } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import { ContextGauge, HeaderUsage } from "./UsageReadout";
import type { Readout } from "./headerUsage";
import { meterText, shortTokens, tone as toneOf, type Meter } from "../usage/meter";
import PlusMenu, { programWord, shellWord, type AgentInfo } from "../launch/PlusMenu";
import { useKeymap } from "../keys/KeymapContext";
import { labelOf } from "../keys/keymap";
import { attachPaste, pasteFromClipboard } from "./paste";
import { attachScreenshotPaste, clipboardImage, pasteImage, type Deps as ShotDeps } from "./screenshotPaste";
import { answersPrompt, newlineAgent, routeKey } from "./shellKeys";
import { INPUT_SOURCE_ACTION, KittyKeyboard, latinControl } from "./kittyKeys";
import { heldByTerminal } from "../keys/terminalPolicy";
import { answeredElsewhere } from "../chat/ask";
import { allowed, clickTarget, handlesOn, hintFor, linkFor, linksIn, resolvePath, rowOf, safeLinks, type Found } from "./links";
import { dropSummary, dropText, overRect, shellKind } from "./drop";
import { decideOsc52, parseOsc52, sayOnce } from "./osc52";
import { findIn, linesOf, nearestFrom, placeMatches, searchLater, segments, stepIndex, type BufRow, type FindOptions, type Match, type Runner } from "./find";
import FindBar from "./FindBar";
import { stopLine, type StopInfo } from "./notify";
import NameField from "./NameField";
import { copyOnSelect } from "../shell/inputExtras";
import { askLink, linkState } from "../shell/linkAsk";
import { applyKoluxUnicode } from "../shell/unicodeWidth";
import { afterLigatures, importLigatures } from "../shell/ligatures";
import { markShell, runningOf, shellInAgentPane } from "./remove";
import { registerTurnSource, xtermSource } from "./turnRead";

// TERM-036: the pane menu's copy items; Copy Session ID shows only once the session is known.
const COPY_IDS = [["session", "Copy Session ID"], ["terminal", "Copy Terminal ID"], ["pane", "Copy Pane ID"]] as const;

type Status = { kind: "starting" } | { kind: "running"; id: number; account: string | null } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

/** council D2 MERGE 31 (3): the host element of a dev build carries its terminal for the evidence probes. */
type DevHost = HTMLDivElement & { __koluxTerm?: Terminal; __koluxLinks?: (y: number) => unknown[] };

/** APP-009 / T-248-a: the menu's Edit > Copy and Select All reach the focused terminal through this.
 * They are calls, never key presses: an empty selection copies nothing, and a rebound chord can't break it. */
export const focusedTerminalEdit: { current: ((op: "copy" | "selectAll") => void) | null } = { current: null };

/** ACCT-064: a centred question over the terminal; Enter takes the first button, Escape the second. */
export type PaneNotice = { title: string; body: string; primary: string; onPrimary: () => void; secondary?: string; onSecondary?: () => void };

type Props = {
  /** Kept mounted but not shown: another workspace is in front (PROJ-066). */
  hidden?: boolean;
  /** TERM-103: false draws plain; true tries the GPU path (six panes at most, the rest plain). */
  gpu?: boolean;
  /** VIEW-024: the saved agent's name, shown in the header in place of the program word. */
  name?: string;
  cwd?: string | null;
  branch?: string | null;
  focused?: boolean;
  agent?: Agent;
  /** The program to run instead of the shell (an agent's command), with its arguments. */
  program?: string | null;
  args?: string[];
  /** SET-027: the user's environment variables for this agent. */
  env?: [string, string][];
  /** T-151-c: undefined while the program is still starting, true while it runs, false once it ended or failed. */
  onRunning?: (running: boolean | undefined) => void;
  /** TERM-030: true while this pane waits on the user, so the window can cycle to it. */
  onNeedsYou?: (needs: boolean) => void;
  /** TERM-058: what the shell's marks say about the running program (title, agent), for the tab's name and icon. */
  onIdentity?: (live: Identity) => void;
  /** T-608: the title guess this header reads while no hook reports (STAT-033), so the Board, Tower, Inbox,
   *  needs strip and bell read the same state (board/chip.ts paneStatus). */
  onGuess?: (guess: AgentState | null) => void;
  /** STAT-001: the pane's last hook-fed state; wins over the title guess while the program runs. */
  hook?: AgentState | "background";
  /** The tool a hook PermissionRequest is waiting on (the hook status's `tool` while `hook` is "permission"): the
   *  Approve/Deny buttons show, and type, only while one is named, never on a title or OSC guess. */
  pendingTool?: string;
  /** Council D2 MERGE 47 FB1: the settings the key policy reads ("Terminal first" holds chords for the program). */
  keySettings?: Record<string, unknown> | null;
  /** STAT-026: the sub-agents and teammates under this session, shown beside the status word. */
  crew?: Crew;
  /** STAT-022: why the agent halted while `hook` is blocked; the header's tooltip says it. */
  stop?: StopInfo;
  /** STAT-040: how full the agent's context is, 0 to 100, from its last status-line report;
   * null or left out while no reading has come in yet (USAGE-001: a greyed 0%). */
  context?: number | null;
  /** USAGE-004: the agent's plan figures beside the gauge on the Agents screen. Shown only while `usage`
   * is left out; with it the header's full readout carries the plan figures on every screen. */
  plan?: string;
  /** USAGE-034: the pane's reading for the full usage readout (tokens against the effective window,
   * cost, used-or-left); left out for a shell, which shows the plain gauge. */
  usage?: Readout;
  /** TERM-118: the program rang the terminal bell. */
  onBell?: () => void;
  /** TERM-118: finished or rang while not in view; the pane carries the mark until viewed. */
  unread?: boolean;
  /** TERM-045: the session id once it runs, so the window can ask whether closing would stop a program;
   *  ACCT-023: with the Codex account it runs on (null: Codex's own sign-in). */
  onPty?: (id: number, account: string | null) => void;
  /** ACCT-023: the Codex account to resume on; a pane that must not quietly move to another one. */
  account?: string | null;
  /** ACCT-064: a question shown over the terminal (the Codex account changed); null for none. */
  notice?: PaneNotice | null;
  /** TERM-106: the pane came back from the saved layout; what it printed before is shown first. */
  restored?: boolean;
  /** TERM-075: the setting "Programs can copy to the clipboard" (OSC 52); on unless turned off. */
  clipboardFromPrograms?: boolean;
  /** TERM-107 (T-066-c): false when the restored agent's start line carries no resume form. */
  resumed?: boolean;
  /** The session failed to start (SESS-024: the window drops the pane rather than leaving it blank). */
  onFailed?: (error: string) => void;
  /** C24-R1-01: a restored tab could not take its terminal back; the window keeps it and stops
   *  treating it as a restore, so a later failure of the same tab drops it as usual. */
  onRestoreFailed?: () => void;
  /** A job title from the seat (SESS-024) wins over the workspace name. */
  title?: string;
  /** SESS-006: the shell picked in the create menu names itself in the header. */
  shellName?: string;
  /** TERM-027: the title is one the user (or a seat) set, so Clear Pane Title is offered. */
  custom?: boolean;
  /** TERM-027: saves a typed name; undefined gives the automatic title back. */
  onRename?: (name: string | undefined) => void;
  /** TERM-027: bumped by the Set Title shortcut to open the name field. */
  renameAsk?: number;
  /** TERM-036: the agent's session id is known, so Copy Session ID is offered. */
  sessionKnown?: boolean;
  /** TERM-036: copies one of the pane's ids; the window says whether it worked. */
  onCopyId?: (what: "session" | "terminal" | "pane") => void;
  /** TERM-096: the opener for a printed handle of an open terminal; undefined for anything else. */
  findHandle?: (handle: string) => (() => void) | undefined;
  /** TERM-092: Ctrl+click on a web link opens it in Kolux's own viewer through `onOpenLink` when this is on (off by
   *  default); Shift held, or no viewer, always means the system browser. */
  linksOpenInKolux?: boolean;
  onOpenLink?: (url: string) => void;
  /** TERM-093: Ctrl+click on a printed file path (resolved against the pane's folder) hands it here, with the line
   *  from a path:line suffix; absent, the system opens the file. */
  onOpenFile?: (path: string, line?: number) => void;
  /** An opening prompt typed in once the agent is ready (SESS-051 typed route). */
  typed?: string;
  /** Names a pane outside any workspace: "Terminal N". */
  number?: number;
  onFocus?: () => void;
  /** Close was asked for; the window decides (TERM-045) and drops the pane, which ends its program. */
  onClose?: () => void;
  /** SAFE-002: set while the agent waits on its plan; the header then offers Review plan. */
  onReviewPlan?: () => void;
  /** after-list #117 (TERM-037): the agent session id, and the window opening a second pane that continues or forks it. */
  session?: string;
  onSessionLaunch?: (launch: Launch, fork: boolean, name?: string) => void;
  /** TERM-042 / TERM-043: the plus menu's entry box (open tabs it can jump to, and what a row opens) and shell choice. */
  entryTabs?: { key: number; name: string }[];
  onEntry?: (target: EntryTarget) => void;
  shells?: ShellEntry[];
  onShell?: (shell: ShellEntry) => void;
  /** The plus menu behind the header's "+" button. */
  agents?: AgentInfo[];
  launching?: boolean;
  onLaunch?: (agent: AgentInfo) => void;
  defaultId?: string;
  onSetDefault?: (id: string) => void;
  onChoose?: () => void;
  /** TERM-006: the header split button opens a shell beside this pane, in the same folder. */
  onSplit?: (dir: "right" | "down") => void;
  /** TERM-015: the header's drag handle, given only when the workspace holds more than one pane. */
  dragCell?: { onStart: () => void; onEnd: () => void };
  /** TERM-035: Equalize in the pane menu; given only while the grid holds more than one pane. */
  onEqualize?: () => void;
  /** TERM-016: Move to Tab in the pane menu. */
  onMoveToTab?: () => void;
  /** TERM-013: the grid's expand: `on` while this pane's cell fills the grid; `can` is false for a lone classic pane. */
  expand?: { on: boolean; can: boolean; toggle: () => void };
  /** VIEW-026: on the Board this pane is a card; expanded shows the live terminal inside it. */
  card?: {
    expanded: boolean;
    onToggle: () => void;
    /** VIEW-023: the card's chip: the word, the line and the newest file written; null for a plain shell. */
    chip?: Chip | null;
    /** VIEW-025: approve or deny from the card. */
    onAnswer?: (approve: boolean) => void;
    /** T-609: Review changes on a Done card opens this pane's worktree in All Changes. */
    onReview?: () => void;
    /** VIEW-023: the Board column (status lane) this card sits in. */
    column?: number;
    /** USAGE-002: the compact session meter; null when there is nothing to measure. */
    meter?: Meter | null;
  };
};

// APP-052: the terminal service as the pane reaches it (reattach.ts is tested over a fake one).
const tauriService = {
  info: () => invoke<ServiceInfo>("terminal_service_info"),
  attach: (paneKey: number, generation: number) => invoke<Attach>("terminal_attach", { paneKey, generation }),
};

// TERM-113: panes that are not on screen at mount (background tabs of a restored layout) start one
// after another, a short beat apart, so the shown tab's programs get the first spawns and come up
// usable first. ponytail: a timer ladder, not a queue; the visible panes never wait.
let waiting = 0;
const stagger = () =>
  new Promise<void>((done) =>
    setTimeout(() => {
      waiting--;
      done();
    }, 150 + 60 * waiting++),
  );

// T-765: one byte budget for the whole window, so ten panes flooding cost the frame no more than one.
const outputFrames = frameOutputs();

export default function TerminalPane({ hidden = false, gpu = true, name, plan, usage, cwd = null, branch = null, focused = false, agent = "shell", program = null, args = [], env, onRunning, onNeedsYou, onIdentity, onGuess, hook, pendingTool, keySettings = null, crew, stop, context, onBell, unread = false, onPty, onFailed, onRestoreFailed, title: jobTitle, typed, shellName, custom = false, onRename, renameAsk = 0, sessionKnown = false, onCopyId, findHandle, number, onFocus, onClose, onReviewPlan, session, onSessionLaunch, entryTabs, onEntry, shells, onShell, agents = [], launching = false, onLaunch, defaultId, onSetDefault, onChoose, onSplit, dragCell, onEqualize, onMoveToTab, expand, card, account, notice = null, restored = false, clipboardFromPrograms = true, linksOpenInKolux = false, onOpenLink, onOpenFile, resumed }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const keySettingsRef = useRef(keySettings);
  keySettingsRef.current = keySettings;
  const clipboardOk = useRef(clipboardFromPrograms);
  clipboardOk.current = clipboardFromPrograms;
  // TERM-096: the link provider is set up once, so it reads the newest opener through a ref.
  const handleRef = useRef(findHandle);
  handleRef.current = findHandle;
  // TERM-092/093: the link provider and the key handler are set up once too; the newest openers, folder and agent
  // are read through refs.
  const openRef = useRef({ linksOpenInKolux, onOpenLink, onOpenFile, cwd });
  openRef.current = { linksOpenInKolux, onOpenLink, onOpenFile, cwd };
  const agentRef = useRef(agent);
  agentRef.current = agent;
  // SESS-040: the agent launched here (its own agent, else the one its program runs) owns the title's busy state and the icon.
  const launched = launchedAgent({ agent, program });
  const launchedRef = useRef(launched);
  launchedRef.current = launched;
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  // T-765: the pane's frame queue (a tab switch wakes it without waiting for the next chunk).
  const outputRef = useRef<FrameOutput | null>(null);
  // STAT-033: the state the program's own terminal title last stood for; only read while no hook reports.
  const [guess, setGuess] = useState<AgentState | null>(null);
  const box = useRef<HTMLElement>(null);
  // TERM-012: the pane Kolux focuses (a shortcut, a new session) takes the keyboard too, unless
  // the keyboard is already somewhere inside it (a click on its own header field).
  useEffect(() => {
    if (focused && !hidden && !box.current?.contains(document.activeElement)) termRef.current?.focus();
  }, [focused, hidden]);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [started, setStarted] = useState<string | null>(null); // ACCT-046: the shell that really started
  const startedRef = useRef(started);
  startedRef.current = started;
  // TERM-074: a file drag is over this pane (the box shows a focus outline until it drops or leaves).
  const [dropping, setDropping] = useState(false);
  // TERM-077: the find bar; the matches, their marks and the current one live in refs (the terminal draws them).
  const [finding, setFinding] = useState(false);
  // Find while the bar is already open: the field takes focus again instead of nothing happening.
  const [findTick, setFindTick] = useState(0);
  const [hits, setHits] = useState<{ count: number; current: number; slow?: boolean }>({ count: 0, current: -1 });
  const cancelFind = useRef<() => void>(() => {});
  useEffect(() => () => cancelFind.current(), []);
  const matches = useRef<Match[]>([]);
  const marks = useRef<{ dispose(): void }[]>([]);
  const lastFind = useRef<{ query: string; opts: FindOptions }>({ query: "", opts: { caseSensitive: false, regex: false } });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [glow, setGlow] = useState(false); // TERM-023: finished while not focused
  const [now, setNow] = useState(() => Date.now());
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  // TERM-065: a short line in the header when the clipboard refused a copy; the selection stays.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) return;
    const fn = (op: "copy" | "selectAll") => {
      const term = termRef.current;
      if (!term) return;
      if (op === "selectAll") term.selectAll();
      else void copySelection(term, (text) => navigator.clipboard.writeText(text), setFlash);
    };
    focusedTerminalEdit.current = fn;
    return () => {
      if (focusedTerminalEdit.current === fn) focusedTerminalEdit.current = null;
    };
  }, [focused]);
  // TERM-031: the prompt count (bumped below, once the hook state is known) and, T-151-b, the count of the
  // prompt the user already answered (click or keystroke): the Approve/Deny buttons hide for it and come
  // back when the next prompt bumps the count.
  const prompt = useRef<{ count: number; hook: AgentState | "background" | undefined }>({ count: 0, hook: undefined });
  const [answered, setAnswered] = useState(0);
  // T-151-b (TERM-069): "Paste N lines?" waiting for Paste or Cancel.
  const [pasteAsk, setPasteAsk] = useState<{ lines: number; go: () => void } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);
  // TERM-107: a restored pane wears a mark in its header until the first key or click in it; an agent
  // pane whose start line does not resume its conversation is marked as restored without resume.
  // T-566: decided from the props at the first paint, not after the restore's first IPC answers.
  const [restoredMark, setRestoredMark] = useState<string | null>(restored ? (resumed === false ? "restored without resume" : "restored") : null);
  // TERM-111: a shell that died (non-zero exit) stays with an overlay offering a restart in the same
  // pane; restart() re-runs the start line, or opens a plain shell, keeping the buffer.
  const [died, setDied] = useState<number | null>(null);
  const restart = useRef<(shell: boolean) => void>(() => {});
  // C24-R1-01: a tab that came back from the saved layout and could not take its terminal back keeps
  // its place, with the reason and a Try again; the layout keeps its key, so its saved output survives.
  const [restoreAsk, setRestoreAsk] = useState<string | null>(null);
  const retryRestore = useRef<() => void>(() => {});
  /** TERM-031: types into the program through the pane's ordered write chain (set once the terminal is up).
   *  TERM-074: with `only`, the text goes in only while that program is still the pane's (nothing after a restart). */
  const typeIn = useRef<(data: string, only?: number) => void>(() => {});
  /** TERM-076 / TERM-077: the pane's own actions behind a Kolux chord, reached from the key handler through refs. */
  const clearRef = useRef<() => void>(() => {});
  const findRef = useRef<() => void>(() => {});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [plusAt, setPlusAt] = useState<{ top: number; right: number } | null>(null);
  // ACCT-050: the agent the user started by hand in this shell, as Rust recognises it.
  const [found, setFound] = useState<Agent | null>(null);
  // TERM-058: the running program as the shell's marks describe it (shellMarks.ts); the tab follows it too.
  const [live, setLive] = useState<Identity>(IDLE);
  const identity = useRef(onIdentity);
  identity.current = onIdentity;
  useEffect(() => {
    identity.current?.(live);
  }, [live]);
  // STAT-034 (hooks FIX-3): in-band status is taken only in an agent pane; the OSC handler is set up once.
  const inbandRef = useRef(false);
  inbandRef.current = takesInband(agent, program, found);
  // TERM-025 / TERM-027: the pane menu, opened by "..." or a right-click on the header, and the inline name field.
  const [menuAt, setMenuAt] = useState<{ top: number; left: number; selected: boolean } | null>(null);
  /** TERM-035: the menu also opens from a right-click inside the pane (set with the terminal). */
  const menuRef = useRef<(x: number, y: number) => void>(() => {});
  // TERM-094 / VIEW-105: the link action menu (link modifier + right-click on a link) and the opener its rows use.
  const [linkMenu, setLinkMenu] = useState<{ f: Found; top: number; left: number } | null>(null);
  const linkOpenRef = useRef<(f: Found, door: Door) => void>(() => {});
  const pasteRef = useRef<() => void>(() => {});
  const [naming, setNaming] = useState(false);
  const [forkAsk, setForkAsk] = useState<Launch | null>(null); // TERM-037: the fork dialog, open for this launch
  useEffect(() => {
    if (renameAsk > 0 && onRename) setNaming(true);
  }, [renameAsk]); // eslint-disable-line react-hooks/exhaustive-deps
  // TERM-022: the branch (or detached commit) of the pane's folder, read when it shows and on focus.
  const [git, setGit] = useState<{ branch: string | null; head: string | null } | null | undefined>(undefined);
  useEffect(() => {
    if (!cwd || hidden) return;
    let live = true;
    invoke<{ branch: string | null; head: string | null } | null>("scm_head", { dir: cwd }).then(
      (h) => live && setGit(h),
      () => live && setGit(null),
    );
    return () => {
      live = false;
    };
  }, [cwd, hidden, focused]);
  const idRef = useRef<number | null>(null);
  // APP-052: the run of the terminal service this pane's terminal belongs to; its typing carries it.
  const serviceRef = useRef<ServiceInfo | null>(null);
  const isHidden = useRef(hidden);
  isHidden.current = hidden;
  // T-765: a tab that comes back catches up at once, without waiting for the next output chunk.
  useEffect(() => {
    outputRef.current?.wake();
  }, [hidden]);
  // TERM-091: a tab switch hides the pane; it comes back at the row it showed (a marker follows the row as the
  // scrollback trims), or at the bottom if it was there. The return is read after the pane has its size again.
  const keptView = useRef<{ bottom: boolean; marker: { line: number; dispose(): void } | null } | null>(null);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    if (hidden) {
      const bottom = buf.viewportY >= buf.baseY;
      keptView.current = { bottom, marker: bottom ? null : (term.registerMarker(buf.viewportY - (buf.baseY + buf.cursorY)) ?? null) };
      return;
    }
    const kept = keptView.current;
    keptView.current = null;
    if (!kept) return;
    const frame = requestAnimationFrame(() => {
      const to = shownAgain({ bottom: kept.bottom, line: kept.marker ? kept.marker.line : null } satisfies KeptView, term.buffer.active.baseY);
      kept.marker?.dispose();
      if (to === "bottom") term.scrollToBottom();
      else if (to !== null) term.scrollToLine(to);
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden]);
  const keymap = useKeymap();
  const keys = useRef(keymap);
  keys.current = keymap;
  const report = useRef(onRunning);
  report.current = onRunning;
  const bell = useRef(onBell);
  bell.current = onBell;
  const pty = useRef(onPty);
  pty.current = onPty;
  const failed = useRef(onFailed);
  // SESS-030: a program that starts (a resumed session among them) takes the keyboard only in the focused pane.
  const isFocused = useRef(focused);
  isFocused.current = focused;
  failed.current = onFailed;
  const restoreFailed = useRef(onRestoreFailed);
  restoreFailed.current = onRestoreFailed;

  useEffect(() => {
    report.current?.(runningOf(status.kind));
    if (status.kind === "running") pty.current?.(status.id, status.account);
  }, [status.kind]);
  // FIX-1: the pane key leaves the "agent pane running a shell" set when the pane goes (restart.current sets it).
  useEffect(() => () => void (number !== undefined && shellInAgentPane.delete(number)), [number]);
  // ACCT-064: the question takes the keyboard only in the active, visible pane.
  const noticeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (notice && focused && !hidden) noticeButton.current?.focus();
  }, [notice !== null, focused, hidden]);
  // TERM-023: an agent that finished while this pane was not focused glows until it is; the age
  // next to Done refreshes each minute. The glow is static (no animation).
  useEffect(() => {
    if (status.kind !== "ended") return;
    setFinishedAt(Date.now());
    if (!focused && agent !== "shell" && !status.code) setGlow(true); // finished well, not stopped
  }, [status.kind]);
  useEffect(() => {
    if (focused) setGlow(false);
  }, [focused]);
  useEffect(() => {
    if (finishedAt === null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [finishedAt]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      ...optionsOf(currentText()),
      ...inputOptions(currentInput(), keys.current.platform, navigator.language, false, currentText().scroll), // T-247-d: Option as Meta, wheel speed
      ...termFont(number), // TERM-097 / TERM-078: saved font plus this pane's zoom (wins over the SET-022 text font fields)
      theme: currentTerminal(),
      allowProposedApi: true,
      logger: xtermLogger, // stress 802: a program's malformed escapes do not flood the console
      // TERM-013: ConPTY repaints the screen itself after a resize, so a taller pane gets blank rows
      // rather than history pulled down for ConPTY to paint over (expand then restore kept scrollback).
      ...(navigator.userAgent.includes("Windows") ? { windowsPty: { backend: "conpty" as const } } : {}),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    applyKoluxUnicode(term); // T-308 / TERM-104: Unicode 16 widths and emoji sequences (xterm alone knows Unicode 6)
    term.open(el);
    termRef.current = term;
    // TERM-107 (T-566): the first key or click from mount on clears the restored mark; no restore step runs first.
    const pane = box.current;
    const unmark = () => {
      setRestoredMark(null);
      unkey.dispose();
      pane?.removeEventListener("mousedown", unmark);
    };
    const unkey = term.onKey(unmark);
    pane?.addEventListener("mousedown", unmark);
    // T-325-c (CHAT-010/011): the chat reads the running turn's reply off this terminal.
    const unturn = number !== undefined ? registerTurnSource(number, xtermSource(term)) : () => {};
    // STAT-033: the title the program sets stands in for its state while no hook reports.
    // after-list #195: a title in replayed history belongs to the program that is gone; it never moves the guess.
    const replayed = replayGate();
    term.onTitleChange(replayed.live((t: string) => setGuess((g) => titleGuess(launchedRef.current, t) ?? g)));
    // STAT-034: a status printed in band (OSC 9999) goes to Rust; xterm never draws the sequence.
    // T-563: the pane's live terminal goes with it, for the activity lane. hooks FIX-3: a plain shell's
    // output never moves the dot; the sequence is still kept off the screen.
    term.parser.registerOscHandler(9999, (data) => {
      if (inbandRef.current) {
        invoke("status_inband", { paneKey: number, terminal: idRef.current, data }).catch(() => {});
        // STAT-034 rest (T-124-b): an in-band new turn drops the stored provider session; a completion keeps it.
        inbandTurn(number, data);
      }
      return true;
    });
    // council D2 MERGE 31 (3): in a dev build the pane's terminal is reachable from its host element, so the
    // evidence probes can read the scrollback cap and the buffer length (the way launchWarn.ts exposes
    // __koluxUsage). A release build has no handle.
    if (import.meta.env.DEV) (el as DevHost).__koluxTerm = term;
    // TERM-096: a printed handle of an open terminal (term-N) is a link that opens its pane.
    term.registerLinkProvider({
      provideLinks(y, done) {
        const links = safeLinks(() =>
          handlesOn(term.buffer.active, y - 1, term.cols).flatMap(({ handle, range }) => {
            const go = handleRef.current?.(handle);
            return go ? [{ range, text: handle, activate: go }] : [];
          }),
        );
        done(links.length > 0 ? links : undefined);
      },
    });
    // TERM-092 / TERM-093: web links and file paths are links (Ctrl+click; Cmd+click on macOS); a link wrapped over
    // rows is read as one; the hint under the pointer says where the click goes. The text work is in links.ts.
    // TERM-092: the link under the pointer, so a Ctrl+click on it is kept from a program that tracks the mouse.
    let hot: Found | null = null;
    const openFound = (f: Found, e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      // ACCT-061: every link is checked before it is opened; a disallowed scheme or an odd target is ignored.
      if (!allowed(f)) return;
      const o = openRef.current;
      const mac = keys.current.platform === "darwin";
      // TERM-094: the secondary button with the modifier is the menu's (opened on the press, below); a release
      // reaching here is ignored. TERM-135: a plain web click asks first, until that was answered.
      const plan = planClick(f, e, mac, o.linksOpenInKolux && !!o.onOpenLink, linkState(), currentText().linkMenu);
      if (plan === null || plan.kind === "menu") return;
      if (plan.kind === "ask" && askLink(f.target, false, (to) => openAt(f, to === "kolux" && o.onOpenLink ? "kolux" : "system"))) return;
      openAt(f, plan.kind === "open" ? plan.door : (clickTarget(f, e, mac, o.linksOpenInKolux && !!o.onOpenLink) ?? "system"));
    };
    // the one opener: a click's door, the question's answer, or a pick from the link menu (which names its door)
    const openAt = (f: Found, door: Door) => {
      if (!allowed(f)) return;
      const o = openRef.current;
      const said = (err: unknown) => setFlash(openFailed(f.target, explainError(String(err)))); // VIEW-105: a failed open says so
      if (door === "kolux" && o.onOpenLink) o.onOpenLink(f.target);
      else if (door === "kolux" || door === "system") invoke("open_external", { url: f.target }).catch(said);
      else {
        const path = resolvePath(f.target, o.cwd);
        if (!path) setFlash(`${f.target} is a relative path and this pane has no folder`);
        else if (o.onOpenFile) o.onOpenFile(path, f.line);
        else invoke("open_path", { path }).catch(said);
      }
    };
    const hintOf = (f: Found) => {
      const o = openRef.current;
      const where = f.kind === "file" ? (o.onOpenFile ? "editor" : "app") : o.linksOpenInKolux && o.onOpenLink ? "kolux" : "browser";
      return hintFor(f, keys.current.platform === "darwin", where, currentText().linkMenu);
    };
    // the hint and the underline clear when the window loses focus (the pointer may never "leave" the link)
    const blurLinks = () => {
      setLinkHint(null);
      term.element?.querySelector(".xterm-screen")?.dispatchEvent(new MouseEvent("mouseleave"));
    };
    window.addEventListener("blur", blurLinks);
    const linksOn = (y: number) =>
      linksIn(term.buffer.active, y - 1, term.cols).map(({ f, range }) => ({
        range,
        text: f.target,
        activate: (e: MouseEvent) => openFound(f, e),
        hover: () => ((hot = f), setLinkHint(hintOf(f))),
        leave: () => ((hot = null), setLinkHint(null)),
      }));
    term.registerLinkProvider({
      provideLinks(y, done) {
        // ACCT-061: a scan that trips over unusual output leaves this row without links; the pane keeps working.
        const links = safeLinks(() => linksOn(y), (err) => console.warn("link scan skipped a row", err));
        done(links.length > 0 ? links : undefined);
      },
    });
    if (import.meta.env.DEV) (el as DevHost).__koluxLinks = linksOn;
    // a program's own OSC 8 link (file:// allowed, other schemes are not links)
    term.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (e, uri) => {
        const f = safeLinks(() => [linkFor(uri)])[0];
        if (f) openFound(f, e);
      },
      hover: (_e, uri) => {
        const f = safeLinks(() => [linkFor(uri)])[0];
        if (f) (hot = f), setLinkHint(hintOf(f));
      },
      leave: () => ((hot = null), setLinkHint(null)),
    };
    // TERM-092: xterm sends every unshifted press to a program that tracks the mouse; the link click is Kolux's.
    linkOpenRef.current = openAt;
    const claim = (e: MouseEvent) => {
      // TERM-094: the link modifier with right-click on a link opens the link menu (a tracking program never sees it)
      if (hot && opensMenu(e, keys.current.platform === "darwin", currentText().linkMenu)) {
        e.preventDefault();
        e.stopPropagation();
        setLinkMenu({ f: hot, top: e.clientY, left: e.clientX });
        return;
      }
      if (!hot || !claimsClick(e, keys.current.platform === "darwin", term.modes.mouseTrackingMode)) return;
      e.preventDefault();
      e.stopPropagation();
      openFound(hot, e);
    };
    el.addEventListener("mousedown", claim, true);
    // TERM-094: the right-click that opened the link menu opens neither the pane menu nor right-click paste
    // (T-710: a keyboard contextmenu opened no link menu, so it goes on to the pane menu)
    const menuClick = (e: MouseEvent) => {
      if (fromKeys(e) || !hot || !opensMenu({ button: 2, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }, keys.current.platform === "darwin", currentText().linkMenu)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("contextmenu", menuClick, true);
    const choice = attachRenderer<WebglAddon>(term, () => new WebglAddon(), gpu && preferGpu(currentInput().gpu, probeGpu())); // SET-022: the GPU setting (automatic, on, off)
    setRenderer(choice.mode);
    choice.onFallback(() => setRenderer("dom"));
    fit.fit();

    let alive = true;
    // C26-R3-01: the drawing this pane belongs to, so an unmount that hands the terminals to the next drawing
    // (a re-draw of the window, not a closed tab) leaves them running.
    const gen = windowGeneration.current;
    // A late-loading font must not leave a live session drawn in the fallback face: once the chosen
    // font is ready, re-measure and rebuild the glyphs.
    if (document.fonts?.ready) {
      void document.fonts.ready
        .then(() => {
          if (!alive || termRef.current !== term) return;
          choice.clearGlyphs();
          term.refresh(0, Math.max(0, term.rows - 1));
          try {
            fit.fit();
          } catch {
            /* the pane is hidden */
          }
        })
        .catch(() => undefined);
    }
    // T-247-d: the input preferences. Wheel speed depends on the screen in use, so it is set again when the screen changes.
    const feel = () => Object.assign(term.options, inputOptions(currentInput(), keys.current.platform, navigator.language, term.buffer.active.type === "alternate", currentText().scroll));
    // SET-022: ligatures when the setting or the font asks for them and the addon is there; without it the text is drawn plain.
    let ligatures: ITerminalAddon | null = null;
    let asked = 0;
    const settleLigatures = () => {
      const ask = ++asked;
      if (!ligaturesOn(currentInput().ligatures, currentText().family)) {
        if (!ligatures) return;
        ligatures.dispose();
        ligatures = null;
        afterLigatures(choice, term); // T-267: plain arrows again on the GPU path too
        return;
      }
      if (ligatures) return;
      // T-267 / TERM-102: the addon is an approved dependency (MERGE 240), imported by its literal name so vite bundles it.
      void loadLigatures(importLigatures).then((a) => {
        if (!a) return;
        if (!alive || ask !== asked) return a.dispose();
        try {
          term.loadAddon(a);
          ligatures = a;
          afterLigatures(choice, term); // T-267: the GPU glyph cache is rebuilt so the joined arrows draw
        } catch {
          a.dispose();
        }
      });
    };
    settleLigatures();
    // A busy session changes the buffer on almost every line. The wheel speed only depends on the
    // screen, so compare that and leave the terminal's options alone on ordinary output.
    let screen = term.buffer.active.type;
    const screenChange = term.buffer.onBufferChange(() => {
      const type = term.buffer.active.type;
      if (type === screen) return;
      screen = type;
      feel();
    });
    // ACCT-059: scrollback sized to the machine's memory profile, the same every start.
    memoryProfile().then((p) => {
      if (alive) term.options.scrollback = p.scrollback;
    });
    // ACCT-054: output is acknowledged as drawn, in running totals, so the reader pauses the
    // program when this pane falls behind rather than letting the app fall behind with it.
    // ORCH-057: an acknowledgement answered with a snapshot means the reader went on without this pane;
    // it redraws from the snapshot and drops the queued output the snapshot already holds.
    const resync = resyncGate();
    const acks = batchAcks((bytes) => {
      const id = idRef.current;
      if (id !== null)
        invoke<Snapshot | null>("terminal_ack", { id, bytes })
          .then((snap) => {
            if (!snap || !alive || idRef.current !== id) return;
            resync.took(snap);
            // T-765: what is still queued and the snapshot holds goes; what came after it still draws.
            output.dropUpTo(snap.seq);
            applySnapshot(term, decodeOutput(snap.data));
          })
          .catch(() => {});
    });
    // T-765: output goes to xterm through the frame queue, one write a frame with the window's
    // others. The acknowledgement is still the write callback's: the reader's unacked window is
    // what pauses a program that runs ahead, so nothing is dropped and the order is the arrival order.
    const output = outputFrames.pane({
      write: (bytes, done) => term.write(bytes, done),
      ack: (bytes) => acks.drew(bytes),
      hidden: () => isHidden.current || document.hidden,
    });
    outputRef.current = output;
    let ended = false;
    // Output can arrive before terminal_spawn hands back this pane's id (several panes starting at
    // once); it is held and replayed, else the console's opening cursor query goes unanswered and
    // the program never starts.
    let early: { id: number; run: () => void }[] | null = [];
    const mine = (id: number, run: () => void) => {
      if (idRef.current === null) early?.push({ id, run });
      else if (id === idRef.current) run();
    };
    const unlisteners: UnlistenFn[] = [];
    // TERM-098: output drawn before terminal_spawn hands back the id can hold the console's
    // opening cursor query; the terminal's answer goes through write() like a key, so it is held
    // here and sent once the id is known, or the shell never starts.
    // TERM-115: keys typed while the shell is still starting are held and sent once it runs
    // (capped); a write the program side refuses is said out loud rather than lost in silence.
    const held = new HeldKeys();
    // TERM-071: writes go one after another (terminal_write is async, so two in flight could land out
    // of order); a chunked paste then reaches the program in order, and a key typed during it waits its turn.
    let chain: Promise<unknown> = Promise.resolve();
    const write = (data: string, only?: number): Promise<unknown> | void => {
      const id = idRef.current;
      if (only !== undefined && only !== id) return;
      // Council D2 MERGE 31 (2): Ctrl+C or Esc during a paste drops what has not gone yet; the key itself still goes.
      if (data === "\x03" || data === "\x1b") pasting.cancel();
      if (ended) {
        // TERM-111: after an agent's program ended, Enter leaves the pane with a working shell.
        if (data === "\r" && agent !== "shell") restart.current(true);
        return;
      }
      if (id === null) {
        if (!held.push(data)) setFlash("Keys typed before the shell started were dropped past 16 KB");
        return;
      }
      return (chain = chain
        .then(() => {
          // TERM-074: the terminal changed (a restart) while the drop waited its turn: nothing is pasted.
          if (only !== undefined && idRef.current !== only) {
            setFlash("The terminal changed before the drop landed; nothing was typed");
            return;
          }
          return invoke("terminal_write", { id, data, generation: serviceRef.current?.generation ?? null });
        })
        .catch((e) => setFlash(`Typing could not reach the program (${explainError(String(e))})`)));
    };
    term.onData((data) => {
      write(yenToBackslash(currentInput(), data)); // SET-025: a Japanese keyboard's Yen key types a backslash when asked
    });
    const bellOnce = bellGate(); // T-125-b: one note per burst of bells
    term.onBell(() => {
      if (bellOnce()) bell.current?.();
    });
    // TERM-082 / VIEW-109 (T-306): the enhanced keyboard protocol a program asks for (CSI > / < / = / ? u), per screen;
    // a terminal reset (ESC c) or the program ending turns it off again.
    const kitty = new KittyKeyboard();
    const onAlt = () => term.buffer.active.type === "alternate";
    for (const prefix of [">", "<", "=", "?"] as const)
      term.parser.registerCsiHandler({ prefix, final: "u" }, (params) => {
        const reply = kitty.apply(prefix, params.map((p) => (typeof p === "number" ? p : p[0])), onAlt());
        if (reply) void write(reply);
        return true;
      });
    term.parser.registerEscHandler({ final: "c" }, () => {
      kitty.reset();
      return false;
    });
    // TERM-075: a program's OSC 52 copy goes to the system clipboard (while the setting allows it); a
    // read-back query gets an empty answer so the program never sees the clipboard; each way it can be
    // refused is said once per session in the header.
    term.parser.registerOscHandler(52, (data) => {
      const d = decideOsc52(parseOsc52(data), clipboardOk.current && currentInput().osc52, !isHidden.current);
      if (d.reply) void write(d.reply);
      if (d.notice) sayOnce(d.notice.key, d.notice.text, setFlash);
      if (d.write !== undefined) navigator.clipboard.writeText(d.write).catch((e) => sayOnce("osc52-unconfirmed", `A program's copy to the clipboard could not be confirmed (${e instanceof Error ? e.message : String(e)})`, setFlash));
      return true;
    });
    // ACCT-047 / TERM-058 (shellMarks.ts, tested there): a wrapped shell prints OSC 133 marks. Output
    // before its first prompt is held so the banner and the prompt land together; the typed-route
    // command (SESS-051) goes in once, at that prompt; a title set between a command start and the
    // next prompt names the program (an agent started by hand). A shell without hooks is not held
    // and keeps the 1.5 s quiet timer. Replayed history (below) never reaches the scanner.
    const wrapped = agent === "shell" && printsMarks(shellName);
    const scanner = new Scanner();
    const gate = new Gate(wrapped);
    // SESS-032 (T-163): an agent pane's opening prompt is handed over by Rust exactly once
    // (agent_prompt_send, from App.tsx's onPty); only a shell pane types its startup command here.
    const startup = new Startup(agent === "shell" ? typed : undefined, wrapped);
    let identityNow: Identity = IDLE;
    const noteIdentity = (next: Identity) => {
      if (next === identityNow) return;
      identityNow = next;
      setLive(next);
    };
    let readyWait: ReturnType<typeof setTimeout> | undefined;
    const openGate = () => {
      clearTimeout(readyWait);
      // T-765: what the pane has already taken from the reader goes out first: the held banner, a
      // reset or an exit note is written after it, never before.
      output.flushNow();
      const heldOut = gate.release();
      if (heldOut) term.write(heldOut);
    };
    if (wrapped) readyWait = setTimeout(openGate, READY_WAIT_MS);
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const send = (text: string | null) => {
      if (text === null || !alive) return;
      write(text);
      pasting.flush();
    };
    const sawOutput = () => {
      if (!startup.pending) return;
      clearTimeout(quiet);
      quiet = setTimeout(() => send(startup.onQuiet()), 1500);
    };
    // TERM-068 lives in paste.ts (tested there); the paste chords are left to the browser instead of xterm.
    typeIn.current = (data, only) => void write(data, only);
    // TERM-070 (T-220): a clipboard that holds an image (and no text) saves it and pastes its path. Registered
    // before the text paste so an image paste is ours; a text paste falls through untouched.
    const shotDeps: ShotDeps = {
      save: (bytes, kind) => invoke<string>("paste_image_save", bytes, { headers: { "x-image-kind": kind } }),
      send: (data) => {
        if (term.options.scrollOnUserInput !== false) term.scrollToBottom();
        return write(data);
      },
      report: setFlash,
    };
    const shots = attachScreenshotPaste(term.textarea, shotDeps);
    const pasting = attachPaste(
      term.textarea,
      (text) => {
        // Council D2 MERGE 31 (2): the chunk goes straight to the program through the ordered write chain
        // (xterm's own paste would bracket every chunk and run ahead of the writes); paste.ts has already
        // rewritten the line ends and bracketed the whole paste once, and the next chunk waits for this
        // promise. The scroll-to-bottom mirrors what xterm does on user input.
        if (term.options.scrollOnUserInput !== false) term.scrollToBottom();
        const landed = write(text);
        // TERM-103: a paste burst fills the glyph atlas with one-off runs; start it fresh afterwards.
        if (text.length > 2048) choice.clearGlyphs();
        return landed;
      },
      () => startup.pending,
      setFlash, // TERM-071: a paste over the limit says so in the header; nothing is sent
      () => term.modes.bracketedPasteMode && term.options.ignoreBracketedPasteMode !== true,
      // TERM-069: on Windows a multi-line paste always goes bracketed (single-line keeps the fast path).
      () => navigator.userAgent.includes("Windows"),
      // T-151-b: 2+ lines into a program that has not turned on bracketed paste asks first.
      (lines, go) => setPasteAsk({ lines, go }),
    );
    // TERM-079: Kolux first. shellKeys.ts decides (tested there): a Kolux chord never reaches the
    // program, a shell key always does, the word and line moves are sent as the shell reads them.
    // TERM-065: the copy chord copies a selection and gives the keyboard back; Ctrl+C with nothing
    // selected is the program's interrupt and goes through untouched. Nothing selected under
    // Ctrl+Shift+C does nothing and says nothing.
    // TERM-082: while a program has the enhanced keyboard protocol on, the keys that reach it are encoded by
    // kittyKeys.ts (releases too when it asked for them); TERM-086: Ctrl+letter on a non-Latin layout sends the
    // Latin control byte. AltGr (Ctrl+Alt on Windows) still types its character.
    const keyFor = (e: KeyboardEvent) => ({ type: e.type, key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, isComposing: e.isComposing, keyCode: e.keyCode, altGraph: e.getModifierState?.("AltGraph") ?? false, capsLock: e.getModifierState?.("CapsLock") ?? false, numLock: e.getModifierState?.("NumLock") ?? false });
    term.attachCustomKeyEventHandler((e) => {
      if (menuKey(e)) return false; // T-710: left to the engine, which raises contextmenu: the pane menu (rightClick)
      if (e.type === "keyup") {
        const up = kitty.encode(keyFor(e), onAlt());
        if (up === null) return true;
        if (up) void write(up);
        return false;
      }
      if (e.type !== "keydown") return true;
      const route = routeKey(keys.current, e, term.hasSelection(), newlineAgent(startedRef.current, agentRef.current), (id) => heldByTerminal(id, keySettingsRef.current));
      // T-151-b (council D2 MERGE 47 S2): a real key that goes to the program answers the permission prompt as
      // far as the buttons are concerned; xterm's own focus / mouse / cursor replies (onData) no longer do.
      if (answersPrompt(route, e.key)) {
        setAnswered(prompt.current.count);
        if (number !== undefined) answeredElsewhere(number); // FIX-1: the chat card for this prompt goes too
      }
      if (route.kind === "ime") return true;
      // A program on the enhanced protocol reads Shift+Enter as its own encoded key, not the agent newline bytes.
      if (route.kind === "shell" || (route.kind === "send" && e.key === "Enter" && kitty.flags(onAlt()) !== 0)) {
        const k = keyFor(e);
        const out = kitty.encode(k, onAlt()) ?? (kitty.flags(onAlt()) ? null : latinControl(k));
        if (out === null) return true;
        e.preventDefault();
        if (out) void write(out);
        return false;
      }
      if (route.kind === "send") {
        e.preventDefault(); // Alt+Left is the webview's own "back" otherwise
        void write(route.data);
        return false;
      }
      if (route.kind === "scroll") {
        e.preventDefault();
        if (route.to === "top") term.scrollToTop();
        else term.scrollToBottom();
        return false;
      }
      const id = route.id;
      // The paste chord is left to the browser: its paste event is what attachPaste reads.
      if (id === "terminal.paste") return false;
      e.preventDefault();
      if (id === "terminal.selectAll") term.selectAll();
      else if (id === "terminal.copySelection") void copySelection(term, (text) => navigator.clipboard.writeText(text), setFlash);
      else if (id === "terminal.clear") clearRef.current();
      else if (id === "terminal.search") findRef.current();
      // TERM-085: the assigned switch-input-source chord changes the OS keyboard layout; the key stays out of the terminal.
      else if (id === INPUT_SOURCE_ACTION) void invoke("terminal_next_input_source").catch((err) => setFlash(`The input source could not be switched (${explainError(String(err))})`));
      // Any other Kolux chord (the window's own actions) is the window's; the shell never sees it.
      return false;
    });

    (async () => {
      // ux card 6: the four registrations are IPC round trips; asked together they cost one, not four.
      unlisteners.push(
        ...(await Promise.all([
        // TERM-098: a chunk tagged with this pane's key is drawn at once, before terminal_spawn answers;
        // anything else that arrives first is held until the id is known and replayed then.
        listen<OutputEvent>("terminal-output", (e) => {
          // APP-052: output from a replaced run of the terminal service is dropped, never drawn.
          if (!fromThisService(e.payload.generation, serviceRef.current)) return;
          // ORCH-057: already in the snapshot this pane redrew from; acknowledged unread so the reader's count stays true
          if (e.payload.id === idRef.current && !resync.accept(e.payload.seq)) return acks.drew(base64Bytes(e.payload.data));
          const draw = () => {
            const bytes = decodeOutput(e.payload.data);
            const marks = scanner.feed(bytes);
            for (const m of marks) noteIdentity(reduceIdentity(identityNow, m));
            const ready = marks.some((m) => m.kind === "prompt");
            const out = gate.push(bytes, ready);
            // Held bytes are acknowledged at once: flow control counts what the pane took, not what it shows yet.
            // T-765: drawn bytes go through the frame queue, which acknowledges them when xterm has parsed them.
            if (out) output.push(out, bytes.length, e.payload.seq);
            else acks.drew(bytes.length);
            if (ready) {
              clearTimeout(readyWait);
              send(startup.onPrompt());
            }
            notePrinted(openRef.current.cwd, bytes); // T-242 (BROW-067): printed dev-server addresses
            sawOutput();
          };
          if (idRef.current === null && forPane(e.payload, null, number)) draw();
          else mine(e.payload.id, draw);
        }),
        // CLI-024: the app asks for the frame as it looks now; the rows on screen go back by id.
        listen<{ id: number; request: string }>("terminal-screen-request", (e) => {
          if (e.payload.id !== idRef.current) return;
          const buf = term.buffer.active;
          const rows: string[] = [];
          for (let y = 0; y < term.rows; y++) rows.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? "");
          invoke("terminal_screen_reply", { request: e.payload.request, rows }).catch(() => {});
        }),
        listen<{ terminal: number; agent: string | null }>("pane-agent", (e) =>
          mine(e.payload.terminal, () => setFound(foundAgent(e.payload.agent))),
        ),
        listen<ExitEvent>("terminal-exit", (e) =>
          mine(e.payload.id, () => {
            ended = true;
            openGate(); // whatever a shell printed before dying is shown with its exit
            noteIdentity(IDLE);
            // VIEW-069 / SESS-051: a program that ends before its typed-in opening prompt could be
            // handed over is a launch that failed, not a session that ran.
            if (startup.exited()) failed.current?.("the program ended before its opening prompt could be typed in");
            // ACCT-060: the modes the program turned on (mouse, bracketed paste, hidden cursor, alt screen) are turned
            // off now that it is gone, so the shell that follows works normally; a program still running is never touched.
            term.write(resetAfterExit(modeView(term.modes), term.buffer.active.type === "alternate"));
            kitty.reset(); // VIEW-109: the key protocol resets cleanly after the program exits
          term.write(`\r\n\x1b[90m[process ${endedLabel(e.payload.code, e.payload.outcome)}]\x1b[0m\r\n`);
            setStatus({ kind: "ended", code: e.payload.code });
            // TERM-111: a shell that exited by itself closes its pane (its neighbours take the space and
            // the tab goes with its last pane); one that died stays, with the exit code and a Restart;
            // an agent pane keeps what its program printed and Enter starts a shell in it.
            const code = e.payload.code;
            if (agent !== "shell") term.write("\x1b[90mEnter starts a shell here\x1b[0m\r\n");
            else if (e.payload.outcome === "unverifiable") return; // ORCH-057: not known to have exited cleanly, so it stays
            else if (code === 0 || code === null) closeRef.current?.();
            else setDied(code);
          }),
        ),
        ])),
      );
      if (!alive) {
        // Unmounted while the listeners were registering (StrictMode's double mount): let them go,
        // or a disposed terminal keeps answering screen requests for this pane.
        unlisteners.forEach((u) => u());
        return;
      }
      // TERM-110: a failure to start is said in plain words (SESS-024 then drops the pane and says so).
      const fail = (err: unknown) => {
        early = null;
        const why = explainError(String(err), cwd ?? "no folder");
        setStatus({ kind: "failed", error: why });
        failed.current?.(why);
      };
      // TERM-111: start() also serves the overlay's Restart (the original start line) and the shell an
      // agent pane gets on Enter after its program ended; the buffer is kept both times.
      const start = async (prog: string | null, argv: readonly string[], keepInView: boolean, back: Reattached | null = null) => {
        try {
          // APP-052: a terminal this run of the service still runs for the pane (the window reloaded) is taken back, not started again.
          const { id, program: ran, account: used } = back?.kind === "attached" ? { id: back.id, program: prog, account: account ?? null } : await invoke<{ id: number; program: string | null; account: string | null }>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd, program: prog, args: argv, env: env ?? null, paneKey: number, account: account ?? null });
          setStarted(ran);
          // A shell taken back after a reload is past its prompt, and a fallback shell without hooks
          // (ACCT-046) prints no mark: neither is held.
          if (back !== null || !printsMarks(ran)) openGate();
          if (!alive) {
            if (killsOnUnmount(gen)) invoke("terminal_kill", { id }).catch(() => {});
            return;
          }
          idRef.current = id;
          if (keepInView) {
            const follow = term.onWriteParsed(() => term.scrollToLine(viewTop(term.buffer.active, term.rows)));
            const stop = term.onKey(() => {
              follow.dispose();
              stop.dispose();
            });
          }
          setStatus({ kind: "running", id, account: used });
          const queued = early ?? [];
          early = null;
          for (const h of queued) if (h.id === id) h.run();
          held.drain(write);
          if (held.dropped > 0) setFlash(`${held.dropped} characters typed before the shell started were dropped`);
          if (isFocused.current) term.focus();
        } catch (err) {
          fail(err);
        }
      };
      restart.current = (shell) => {
        if (!alive) return;
        ended = false;
        idRef.current = null;
        early = [];
        setDied(null);
        // FIX-1: an agent pane that got a shell on Enter is asked about as a shell (terminal/remove.ts classify).
        markShell(shellInAgentPane, number, shell, agent);
        setStatus({ kind: "starting" });
        void start(shell ? null : program, shell ? [] : args, false);
      };
      // C24-R1-01: Try again asks the service for the terminal once more and starts on the answer. The
      // saved output is already on screen, so nothing is replayed a second time.
      retryRestore.current = () => {
        if (!alive || number === undefined) return;
        setRestoreAsk(null);
        setStatus({ kind: "starting" });
        void (async () => {
          const back = await reattach(tauriService, number, serviceRef.current);
          if (!alive) return;
          if (back.kind === "refused" || back.kind === "timeout") {
            setStatus({ kind: "failed", error: back.reason });
            setRestoreAsk(back.reason);
            return;
          }
          serviceRef.current = back.service;
          await start(program, args, false, back);
        })();
      };
      try {
        // TERM-106: a pane back from a restart shows what it printed before, then a fresh shell. The
        // saved file is a transcript of everything this pane's terminal processed, so replaying it
        // draws the same screen; what the pane writes next (reset, note, screen pushed up, cursor at
        // the top) goes into the file too, before the shell starts, so the next restart replays true.
        // The view keeps the old output and the note above the new prompt until the user types: the
        // pty's first frames come after the spawn and move the prompt row, so the view follows each
        // of them (an idle shell writes nothing more) and lets go at the first key. A key, not
        // onData: the terminal's own answers to the shell's start-up questions go through onData.
        let keepInView = false;
        let replayedOld = false;
        if (restored) {
          // APP-052: read once the service linked, which first adds what a kept terminal printed with no window open.
          await tauriService.info().catch(() => null);
          if (!alive) return;
          const saved = await invoke<string>("terminal_history", { paneKey: number }).catch(() => "");
          if (!alive) return;
          const text = replay(saved);
          if (text) {
            await replayed.during(() => new Promise<void>((done) => term.write(text, done)));
            if (!alive) return;
            replayedOld = true;
          }
        }
        // TERM-113: a pane that is not on screen at mount lets the shown ones start first.
        if (el.clientWidth === 0 || el.clientHeight === 0) await stagger();
        if (!alive) return;
        // APP-052: the pane asks the terminal service for its terminal first and waits for the service
        // to answer, up to a hard limit; no answer or too old a service fails the pane in plain words.
        // A pane without a key (nothing saved for it) has no terminal to ask for.
        const back = number === undefined ? null : await reattach(tauriService, number, serviceRef.current);
        const orphan = orphanOf(back, alive);
        if (orphan !== null) invoke("terminal_kill", { id: orphan }).catch(() => {});
        if (!alive) return;
        if (back !== null) {
          if (back.kind === "refused" || back.kind === "timeout") {
            // C24-R1-01: a tab that came back from the saved layout keeps its place when the service
            // cannot hand its terminal back: it says why and offers Try again, and the layout keeps its
            // key, so the saved output is not pruned at the next start. A fresh tab with no terminal to
            // take back is still a session that failed to start (SESS-024).
            if (!keepsTab(back, restored)) {
              fail(back.reason);
              return;
            }
            setStatus({ kind: "failed", error: back.reason });
            setRestoreAsk(back.reason);
            restoreFailed.current?.();
            return;
          }
          serviceRef.current = back.service;
          if (back.kind === "replaced") setFlash("The terminal service was replaced; the pane starts again on the new one");
        }
        const tail = replayedOld ? afterReplay(term.buffer.normal, term.rows, back?.kind === "attached") : "";
        if (tail) {
          await replayed.during(() => new Promise<void>((done) => term.write(tail, done)));
          if (!alive) return;
          await invoke("terminal_history_append", { paneKey: number, data: encodeHistory(tail) }).catch(() => {});
          if (!alive) return;
          keepInView = true;
        }
        // TERM-088: the program whose history was just replayed is gone unless the service still runs it (attached);
        // what it left on (mouse capture first) is turned off, so a plain drag selects again in the new shell.
        if (keepInView && back?.kind !== "attached") term.write(resetAfterExit(modeView(term.modes), term.buffer.active.type === "alternate"));
        await start(program, args, keepInView, back);
      } catch (err) {
        fail(err);
      }
    })();

    const resize = () => {
      // A hidden pane has no size; fitting it would shrink the program's terminal to nothing.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      // TERM-010 (and the size rule of the full-screen card): while a divider is dragged the pane
      // redraws at each size but the program hears only the final one, when the drag ends.
      if (dragging()) return;
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    window.addEventListener(DIVIDER_DONE, resize);
    // SET-003: open terminals follow a theme change without being reopened.
    // ORCH-057: dark-or-light is the palette's own brightness (the app's mode only when it cannot be read);
    // capability queries get the Windows answer, and a hidden Grok pane holds back only its version answers.
    const mode = hookColourMode(term, write, () => paletteIsDark(term.options.theme?.background) ?? currentDark());
    const queries = hookQueries(term, write, { windows: navigator.userAgent.includes("Windows"), holdVersion: () => isHidden.current && isGrok(program) });
    const recolour = () => {
      term.options.theme = currentTerminal();
      Object.assign(term.options, termFont(number));
      resize();
      mode.changed();
    };
    window.addEventListener(TERMINAL_EVENT, recolour);
    // SET-022 / SET-025: open terminals follow the text, cursor and history settings.
    const retext = () => {
      Object.assign(term.options, optionsOf(currentText()), termFont(number));
      feel();
      settleLigatures();
      resize();
    };
    window.addEventListener(TEXT_EVENT, retext);
    const refeel = () => {
      feel();
      settleLigatures();
    };
    window.addEventListener(INPUT_EVENT, refeel);
    // SET-025: copy on select, and right-click paste (the menu stays away while it is on).
    // TERM-066: a clipboard that refuses says so once per drag, not once per movement.
    const copier = copyOnSelect((text) => navigator.clipboard?.writeText(text), setFlash);
    const selected = term.onSelectionChange(() => {
      if (currentText().copyOnSelect) copier(term.hasSelection() ? term.getSelection() : "");
    });
    // TERM-070: the menu and chord paste read the clipboard themselves; no text (or an unreadable clipboard) tries the image.
    // TERM-068 box 2: that read is asynchronous, so the paste goes in only while this pane is still the
    // focused one; switching to another pane while the clipboard is still being read cancels it instead of
    // typing into the pane the user switched to.
    const pasteApi = () =>
      void pasteFromClipboard({
        read: () => navigator.clipboard.readText(),
        image: clipboardImage,
        pasteText: pasting.paste,
        pasteImage: (f) => pasteImage(f, shotDeps),
        focused: () => isFocused.current,
        refused: (e) => sayOnce("paste-refused", `The clipboard could not be read (${e instanceof Error ? e.message : String(e)})`, setFlash),
      });
    pasteRef.current = pasteApi;
    const rightClick = (e: MouseEvent) => {
      e.preventDefault();
      // T-710: from the keyboard it is always the menu, at the cursor, whatever the right-click settings
      if (fromKeys(e)) return menuRef.current(e.clientX, e.clientY);
      if (!currentText().rightClickPaste) {
        // TERM-035: a program that tracks the mouse keeps its right-click (Shift takes it back for the menu).
        if (term.modes.mouseTrackingMode !== "none" && !e.shiftKey) return;
        menuRef.current(e.clientX, e.clientY);
        return;
      }
      if (term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
      } else pasteApi();
    };
    el.addEventListener("contextmenu", rightClick);
    // SET-025: middle-click paste (the selection, else the clipboard; a program tracking the mouse keeps its click),
    // focus follows the mouse, and the pointer that hides while typing.
    const middle = (e: MouseEvent) => {
      if (!middlePastes(currentInput(), e, term.modes.mouseTrackingMode)) return;
      e.preventDefault(); // also stops the web view's own middle-click scroll on press
      if (e.type !== "auxclick") return;
      const picked = term.getSelection();
      if (middleSource(picked) === "selection") pasting.paste(picked);
      else pasteApi();
    };
    el.addEventListener("mousedown", middle);
    el.addEventListener("auxclick", middle);
    const hover = () => {
      if (currentInput().focusFollowsMouse && !isFocused.current && !isHidden.current) {
        onFocus?.();
        term.focus();
      }
    };
    el.addEventListener("mouseenter", hover);
    // TERM-089: in a full-screen program the wheel is counted in notches, scaled by the full-screen setting and drained
    // per frame (mouseFeel.ts); the reports themselves are xterm's, one per event handed back to it.
    const ours = new WeakSet<WheelEvent>();
    let lastWheel: WheelEvent | null = null;
    const drain = new WheelDrain(
      (dir, n) => {
        const at = lastWheel;
        const host = term.element;
        if (!at || !host) return;
        for (let i = 0; i < n; i++) {
          const ev = new WheelEvent("wheel", { deltaMode: 1, deltaY: dir, clientX: at.clientX, clientY: at.clientY, ctrlKey: at.ctrlKey, altKey: at.altKey, bubbles: true, cancelable: true });
          ours.add(ev);
          host.dispatchEvent(ev);
        }
      },
      (f) => requestAnimationFrame(f),
    );
    term.attachCustomWheelEventHandler((e) => {
      if (ours.has(e) || e.shiftKey || e.deltaY === 0) return true;
      if (term.buffer.active.type !== "alternate" && term.modes.mouseTrackingMode === "none") return true; // scrollback: xterm's own
      lastWheel = e;
      e.preventDefault();
      drain.push(e, currentInput().fullScreenScroll, currentText().fastScroll, term.rows);
      return false;
    });
    // TERM-088: a plain drag over a program that takes the mouse goes to the program; say once that Shift selects.
    let dragFrom: { x: number; y: number } | null = null;
    const dragDown = (e: MouseEvent) => void (dragFrom = e.button === 0 ? { x: e.clientX, y: e.clientY } : null);
    const dragMove = (e: MouseEvent) => {
      if (!dragFrom || !(e.buttons & 1)) return void (dragFrom = null);
      if (!dragWantsHint(term.modes.mouseTrackingMode, e.shiftKey, e.clientX - dragFrom.x, e.clientY - dragFrom.y)) return;
      dragFrom = null;
      sayOnce("shift-select", SHIFT_HINT, setFlash);
    };
    el.addEventListener("mousedown", dragDown);
    el.addEventListener("mousemove", dragMove);
    const unwatchPointer = watchPointer(el, currentInput);
    // TERM-103 / TERM-114: after the machine slept the GPU's glyph atlas may be stale and the
    // program's size may be behind; a late heartbeat says so. A display scale change does the same.
    const wake = () => {
      choice.clearGlyphs();
      resize();
    };
    const sleep = watchResume(wake);
    const beat = setInterval(sleep.tick, 5000);
    const scale = watchScale(wake);
    // TERM-114: the window coming back puts typing in the pane that had it, unless the user
    // clicked somewhere else meanwhile.
    const refocus = () => {
      if (!isHidden.current && shouldRefocus(isFocused.current, document.activeElement)) term.focus();
    };
    window.addEventListener("focus", refocus);

    return () => {
      alive = false;
      window.removeEventListener(DIVIDER_DONE, resize);
      window.removeEventListener(TERMINAL_EVENT, recolour);
      window.removeEventListener(TEXT_EVENT, retext);
      window.removeEventListener(INPUT_EVENT, refeel);
      el.removeEventListener("contextmenu", rightClick);
      el.removeEventListener("mousedown", middle);
      el.removeEventListener("auxclick", middle);
      el.removeEventListener("mouseenter", hover);
      el.removeEventListener("mousedown", dragDown);
      el.removeEventListener("mousemove", dragMove);
      unwatchPointer();
      screenChange.dispose();
      ligatures?.dispose();
      selected.dispose();
      mode.dispose();
      queries.dispose();
      clearInterval(beat);
      scale.dispose();
      window.removeEventListener("focus", refocus);
      termRef.current = null;
      unturn();
      clearTimeout(quiet);
      observer.disconnect();
      unlisteners.forEach((u) => u());
      const id = idRef.current;
      if (id !== null && killsOnUnmount(gen)) invoke("terminal_kill", { id }).catch(() => {});
      choice.dispose();
      pasting.detach();
      shots();
      clearTimeout(readyWait);
      output.dispose();
      outputRef.current = null;
      acks.stop();
      term.dispose();
      delete (el as DevHost).__koluxTerm;
      delete (el as DevHost).__koluxLinks;
      window.removeEventListener("blur", blurLinks);
      el.removeEventListener("mousedown", claim, true);
      el.removeEventListener("contextmenu", menuClick, true);
      pane?.removeEventListener("mousedown", unmark);
    };
  }, []);

  // TERM-074: a file dropped on this pane's box is typed into this pane, quoted for its shell, no Enter,
  // whichever pane has the keyboard. The webview's drag events carry physical pixels; the hit test uses
  // the element under the pointer, so a drop on an overlay or a menu over the pane is not a drop on it.
  useEffect(() => {
    if (hidden) return;
    let live = true;
    let stop: UnlistenFn | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        const el = box.current;
        if (!el || p.type === "leave") {
          setDropping(false);
          return;
        }
        const scale = window.devicePixelRatio || 1;
        const x = p.position.x / scale;
        const y = p.position.y / scale;
        const under = document.elementFromPoint(x, y);
        const over = overRect(x, y, el.getBoundingClientRect()) && under !== null && el.contains(under);
        if (p.type !== "drop") {
          setDropping(over);
          return;
        }
        setDropping(false);
        if (!over) return;
        const term = termRef.current;
        const id = idRef.current;
        if (!term || id === null) {
          setFlash("Nothing is running in this pane to drop into");
          return;
        }
        const { text, typed, refused } = dropText(p.paths, shellKind(startedRef.current));
        const left = refused === 0 ? "" : `${refused === 1 ? "1 path was" : `${refused} paths were`} not typed: its name holds a control character, or $ \` % ! or a curly quote this program could expand`;
        if (!text) {
          if (left) setFlash(left);
          return;
        }
        typeIn.current(text, id);
        setFlash(left ? `${dropSummary(typed)}; ${left}` : dropSummary(typed));
        onFocus?.();
        term.focus();
      })
      .then((un) => {
        if (live) stop = un;
        else un();
      });
    return () => {
      live = false;
      stop?.();
    };
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // TERM-077: the search runs over every row the terminal holds (scrollback included); each match gets a
  // mark drawn under its text, the current one is selected and scrolled into view. The marks go when the
  // bar closes or the screen is cleared.
  const dropMarks = () => {
    marks.current.forEach((m) => m.dispose());
    marks.current = [];
  };
  const showMatch = (term: Terminal, i: number) => {
    const m = matches.current[i];
    if (!m) {
      term.clearSelection();
      return;
    }
    term.select(m.col, m.row, m.len);
    const top = term.buffer.active.viewportY;
    if (m.row < top || m.row >= top + term.rows) term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
  };
  // Every row of the buffer as cells (links.ts rowOf: wide characters keep their two cells).
  const bufferLines = (term: Terminal) => {
    const buf = term.buffer.active;
    const rows: BufRow[] = [];
    for (let y = 0; y < buf.length; y++) {
      const l = buf.getLine(y);
      rows.push(l ? { wrapped: l.isWrapped, cells: rowOf(l, term.cols) } : { wrapped: false, cells: "" });
    }
    return linesOf(rows, term.cols);
  };
  const spawnFind = (): Runner => {
    const w = new Worker(new URL("./findWorker.ts", import.meta.url), { type: "module" });
    return {
      run: (texts, query, opts, done) => {
        w.onmessage = (e: MessageEvent<Match[]>) => done(e.data);
        w.postMessage({ texts, query, opts });
      },
      stop: () => w.terminate(),
    };
  };
  const drawFind = (term: Terminal, found: Match[]) => {
    dropMarks();
    matches.current = found;
    const buf = term.buffer.active;
    const cursorRow = buf.baseY + buf.cursorY;
    for (const m of found)
      for (const s of segments(m, term.cols)) {
        const marker = term.registerMarker(s.row - cursorRow);
        if (!marker) continue;
        marks.current.push(marker);
        const mark = term.registerDecoration({ marker, x: s.col, width: s.len, backgroundColor: "#b8860b", layer: "bottom" });
        if (mark) marks.current.push(mark);
      }
    const i = nearestFrom(found, buf.viewportY);
    setHits({ count: found.length, current: i });
    showMatch(term, i);
  };
  const runFind = (query: string, opts: FindOptions) => {
    lastFind.current = { query, opts };
    cancelFind.current();
    const term = termRef.current;
    if (!term) return;
    if (!opts.regex || query === "") {
      const lines = bufferLines(term);
      drawFind(term, placeMatches(lines, findIn(lines.map((l) => l.text), query, opts), term.cols));
      return;
    }
    let lines: ReturnType<typeof bufferLines> = [];
    cancelFind.current = searchLater(
      () => (lines = bufferLines(term)).map((l) => l.text),
      query,
      opts,
      (found) => drawFind(term, placeMatches(lines, found, term.cols)),
      () => {
        dropMarks();
        matches.current = [];
        setHits({ count: 0, current: -1, slow: true });
        term.clearSelection();
      },
      spawnFind,
    );
  };
  const stepFind = (dir: 1 | -1) => {
    const term = termRef.current;
    if (!term) return;
    const i = stepIndex(matches.current.length, hits.current, dir);
    setHits({ count: matches.current.length, current: i });
    showMatch(term, i);
  };
  const closeFind = () => {
    cancelFind.current();
    dropMarks();
    matches.current = [];
    setHits({ count: 0, current: -1 });
    setFinding(false);
    termRef.current?.clearSelection();
    termRef.current?.focus();
  };
  findRef.current = () => (setFinding(true), setFindTick((n) => n + 1));
  // TERM-076: Clear Screen drops what is on screen and the scrollback; the marks and link ranges go with
  // the rows (links are read per row on demand). The saved transcript (TERM-106) is left as it is.
  clearRef.current = () => {
    const term = termRef.current;
    if (!term) return;
    dropMarks();
    term.clear();
    if (finding) runFind(lastFind.current.query, lastFind.current.opts);
  };

  // Close asks the window (TERM-045 may confirm first); dropping the pane ends its program
  // through the cleanup above (TERM-014).
  const close = () => onClose?.();

  // TERM-020/021: a plain shell reads as a terminal with a neutral status; an agent reads
  // Working (working tone) while its program is up, Done (done tone, with its age) after it
  // ends well or when its hook says the turn is over; what it needs comes from the hooks (T-025).
  useEffect(() => {
    if (hook === "done") setFinishedAt((t) => t ?? Date.now());
    else if (hook === "working") setFinishedAt(null);
  }, [hook]);
  // TERM-031: one count per prompt shown (each entry into "permission"); an Approve/Deny control
  // carries the count it was drawn with, so an answer to a prompt that has gone sends nothing.
  if (prompt.current.hook !== hook) prompt.current = { count: nextPrompt(prompt.current.count, prompt.current.hook, hook), hook };
  // TERM-058: a shell pane running an agent the user started by hand reads as that agent's session;
  // the hook's word (pane-agent) beats the title guess, and the title counts only while a command runs.
  const shown: Agent = agent === "shell" && found ? found : shownAgent(agent, creditedLive(launched, live));
  const header = headerOf(shown, status.kind, status.kind === "ended" ? status.code : undefined, false, finishedAt, now, hook ?? guess ?? undefined);
  const { word, tone, glyph, age, needsYou } = header;
  const explain = header.state === "blocked" && stop ? `${stopLine(stop)}.` : header.explain;
  const needs = useRef(onNeedsYou);
  needs.current = onNeedsYou;
  useEffect(() => {
    needs.current?.(needsYou);
  }, [needsYou]);
  // T-608: the window reads the same title guess this header does.
  const guessed = useRef(onGuess);
  guessed.current = onGuess;
  useEffect(() => {
    guessed.current?.(guess);
  }, [guess]);
  const drawing = renderer === "webgl" ? "GPU renderer" : renderer === "dom" ? "plain renderer" : "";
  // TERM-116: the last 60 lines on screen plus what Kolux knows, scrubbed on the Rust side, to the
  // clipboard; every way it can fail says so in the header.
  // after-list #117 (TERM-037): who and where plus the last lines on screen, to the clipboard.
  const copyContext = () => {
    const term = termRef.current;
    const text = contextText({ agent, session, program, args, cwd, branch, title: jobTitle }, { recent: term ? screenLines(term.buffer.active) : [] });
    navigator.clipboard.writeText(text).then(
      () => setFlash("Context copied"),
      (e) => setFlash(`Context could not be copied (${e instanceof Error ? e.message : String(e)})`),
    );
  };
  const copyDiagnostics = async () => {
    const term = termRef.current;
    const id = idRef.current;
    if (!term || id === null) {
      setFlash("No session to describe yet");
      return;
    }
    const screen = screenLines(term.buffer.active);
    let text: string;
    try {
      text = await invoke<string>("terminal_diagnostics", { id, cols: term.cols, rows: term.rows, renderer: drawing || "unknown", screen });
      text = await withMilestones(text); // ONB-011: when each first-run milestone happened
    } catch (e) {
      setFlash(`Diagnostics could not be built (${String(e)})`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Diagnostics copied");
    } catch (e) {
      setFlash(`Diagnostics could not be copied (${e instanceof Error ? e.message : String(e)})`);
    }
    term.focus();
  };
  // The seat's job title names the pane; else the running program's title (TERM-058); else the
  // workspace folder (an agent launch's creature name); else "Terminal N" (SESS-024).
  const title = followedTitle(jobTitle, live, cwd ? folderName(cwd) : `Terminal${number ? ` ${number}` : ""}`);
  // TERM-043: a plain Windows shell tab wears the icon of the shell it actually started.
  const shellIcon = shown === "shell" ? shellIconOf(started ?? program) : "shell";
  const agentLabel = name ?? (shown === "shell" ? "Plain shell" : programWord(shown));
  // SET-028: a pane started with a model (a seat's pick or a worker's tier) names it.
  const model = agent === "shell" ? null : modelOf(args);
  // TERM-022: before git answers, the branch the pane was opened on; a folder outside git has none.
  const chip = git === undefined ? (branch ? { text: branch, tip: branch } : null) : branchChip(git);
  // TERM-013 / TERM-025: on the Board, expand opens the card; in the grid it fills the grid.
  const onExpand = card ? card.onToggle : expand?.toggle;
  const expanded = card ? card.expanded : !!expand?.on;
  const canExpand = card ? true : !!expand?.can;
  const expandKey = labelOf(keymap, "terminal.expandPane").join("+") || "no shortcut";
  // UX audit terminal F4/F5: the header tooltips show the chords the keymap really has.
  // T-717 (DT-C153): tab.close owns Mod+W and closes the focused pane.
  const closeTip = withChord("Close pane", labelOf(keymap, "tab.close"));
  const splitRightKey = labelOf(keymap, "terminal.splitRight").join("+");
  const splitDownKey = labelOf(keymap, "terminal.splitDown").join("+");
  const splitTip = `Split right: a shell in the same folder${splitRightKey ? ` (${splitRightKey}${splitDownKey ? `; ${splitDownKey} splits down` : ""})` : ""}`;
  // PaneMenu moves itself back inside the window once it knows its own size.
  const openMenu = (x: number, y: number) => setMenuAt({ top: y, left: x, selected: !!termRef.current?.hasSelection() });
  menuRef.current = openMenu;

  return (
    <section ref={box} className={`pane${focused ? " focused" : ""}${glow || unread ? " glow" : ""}${unread ? " unread" : ""}${card ? " card" : ""}${card?.expanded ? " expanded" : ""}`} hidden={hidden} aria-label={`${title} pane`} onMouseDown={onFocus} data-agent={shown} data-key={number} data-dropping={dropping || undefined} style={{ ...(card?.column ? { gridColumn: card.column } : {}), ...(dropping ? { outline: "2px solid var(--line-focus)", outlineOffset: -2 } : {}) }}>
      <header
        className="pane-head"
        onContextMenu={(e) => {
          if ((e.target as Element).closest?.(".address")) return;
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
      >
        {dragCell && (
          <span
            className="pane-grip"
            role="img"
            aria-label="Drag to move this pane"
            title="Drag to move this pane"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", title);
              dragCell.onStart();
            }}
            onDragEnd={dragCell.onEnd}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="3" r="1" />
              <circle cx="8" cy="3" r="1" />
              <circle cx="4" cy="6" r="1" />
              <circle cx="8" cy="6" r="1" />
              <circle cx="4" cy="9" r="1" />
              <circle cx="8" cy="9" r="1" />
            </svg>
          </span>
        )}
        <span className={`st ${tone || "idle"}`} role="img" aria-label={`status: ${word}`} data-tip={[explain, drawing].filter(Boolean).join(" · ")}>
          <StatusGlyph glyph={glyph} size={glyph === "spinner" ? 11 : 12} />
        </span>
        <span className="agent-mark" title={agentLabel}>
          {shellIcon === "shell" ? <VendorMark agent={shown} size={13} /> : <ShellMark icon={shellIcon} />}
        </span>
        {naming && onRename ? (
          <NameField
            value={title}
            label="Pane title"
            onSave={(name) => {
              setNaming(false);
              onRename(name);
              termRef.current?.focus();
            }}
            onCancel={() => {
              setNaming(false);
              termRef.current?.focus();
            }}
          />
        ) : (
          <span className="title" title={cwd ?? undefined}>
            {title}
          </span>
        )}
        {chip && (
          <span className="chip" title={chip.tip}>
            {chip.text}
          </span>
        )}
        {/* SESS-025: the start line shown back leaves out the rules block of a side-by-side launch. */}
        <span className="word" title={program ? [program, ...args.map(withoutRules)].join(" ") : undefined}>
          {name ?? shellName ?? (shown === "shell" && !program && started ? shellWord(started) : programWord(shown))}
          {model && ` · ${model}`}
        </span>
        <span className={`status ${tone}`} data-tip={explain}>
          {word}
        </span>
        {header.state === "permission" && buttonsShown(shown, hook, answered, prompt.current.count, pendingTool) && (
          <span className="answer" role="group" aria-label="Answer the permission prompt">
            {(["approve", "deny"] as const).map((answer) => {
              const drawnAt = prompt.current.count;
              return (
                <button
                  key={answer}
                  className={`btn ${answer === "approve" ? "primary" : ""}`}
                  data-answer={answer}
                  title={answer === "approve" ? "Approve: answers Yes in this agent while its prompt is still showing" : "Deny: backs out of the prompt while it is still showing"}
                  onClick={() => {
                    const keys = answerKeys(shown, answer);
                    setAnswered(drawnAt); // T-151-b: the first click answers; the buttons go until the next prompt
                    if (number !== undefined) answeredElsewhere(number); // FIX-1: the chat card for this prompt goes too
                    if (keys !== null && canAnswer(shown, hook, drawnAt, prompt.current.count, pendingTool)) typeIn.current(keys);
                    else setFlash("The prompt has gone; nothing was sent");
                  }}
                >
                  {answer === "approve" ? "Approve" : "Deny"}
                </button>
              );
            })}
          </span>
        )}
        {flash && (
          <span className="status attention" role="status">
            {flash}
          </span>
        )}
        {linkHint && !flash && (
          <span className="status link-hint" role="status">
            {linkHint}
          </span>
        )}
        {restoredMark && (
          <span className="status attention restored" role="status" title="restored from saved history; a key or a click in the pane clears this">
            {restoredMark}
          </span>
        )}
        {crew && crew.length > 0 && (
          <span className="crew" title={crew.map(crewLine).join("\n")}>
            {crewLabel(crew)}
          </span>
        )}
        {age && (
          <span className="age" title="when the agent finished">
            {age}
          </span>
        )}
        <span className="right">
          {plan && !usage && (
            <span className="meter-plan" title="This agent's plan: its 5-hour and weekly windows">
              {plan}
            </span>
          )}
          {onReviewPlan && (
            <button className="btn plan-review-btn" onClick={onReviewPlan} title="Read the plan, comment on it, then approve or ask for changes">
              Review plan
            </button>
          )}
          {usage ? <HeaderUsage context={context} agent={agent} readout={usage} account={account} /> : <ContextGauge context={context} agent={agent} />}
          <button
            className="ib"
            title="Pane menu"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(r.left, r.bottom + 4);
            }}
          >
            <Dots size={12} />
          </button>
          <button
            className="ib"
            onClick={onExpand}
            disabled={!canExpand}
            aria-expanded={card ? card.expanded : undefined}
            aria-pressed={card ? undefined : expanded}
            title={card ? (card.expanded ? "Collapse: the terminal goes back to its grid slot" : "Expand: show this session's live terminal in the card") : !canExpand ? "Expand: the only pane already fills the grid" : expanded ? `Restore: the other panes come back (${expandKey})` : `Expand: this pane fills the grid (${expandKey})`}
          >
            <Expand size={12} />
          </button>
          {onSplit && (
            <button className="ib" onClick={() => onSplit("right")} title={splitTip}>
              <SplitRight size={12} />
            </button>
          )}
          <button
            className="ib"
            title="New session: start an agent in a new pane"
            aria-haspopup="menu"
            aria-expanded={plusAt !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPlusAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
            }}
          >
            <Plus size={12} />
          </button>
          <button className="ib" onClick={close} title={`${closeTip}: ends the program, after asking if one is running`}>
            <Close size={12} />
          </button>
        </span>
      </header>
      {linkMenu && (
        <LinkActionMenu
          at={{ top: linkMenu.top, left: linkMenu.left }}
          destination={destinationOf(linkMenu.f, openRef.current.cwd)}
          items={linkMenuItems(linkMenu.f, openRef.current.linksOpenInKolux === true, !!openRef.current.onOpenLink, !!openRef.current.onOpenFile)}
          onDismiss={() => setLinkMenu(null)}
          onPick={(id: LinkItemId) => {
            const f = linkMenu.f;
            const door = doorOfItem(id);
            if (door) return linkOpenRef.current(f, door);
            if (id === "settings") return openSettings("terminal", "links");
            return navigator.clipboard.writeText(copyTextOf(f, openRef.current.cwd)).then(
              () => true,
              () => false,
            );
          }}
        />
      )}
      {menuAt && (
        <PaneMenu
          style={{ top: menuAt.top, left: menuAt.left }}
          onDismiss={() => setMenuAt(null)}
          items={paneMenuItems({
            selected: menuAt.selected,
            expanded,
            canExpand,
            onCopy: () => {
              const term = termRef.current;
              if (term) void copySelection(term, (text) => navigator.clipboard.writeText(text), setFlash);
            },
            onSelectAll: () => {
              termRef.current?.selectAll();
              termRef.current?.focus();
            },
            onPaste: () => {
              pasteRef.current();
              termRef.current?.focus();
            },
            agentActions: [
              ...(onReviewPlan ? [{ id: "reviewPlan", name: "Review plan", title: "Read the plan, comment on it, then approve or ask for changes", run: onReviewPlan }] : []),
              ...sessionMenuActions({ agent, session, program, args, cwd, branch, title: jobTitle }, { launch: onSessionLaunch, askFork: setForkAsk, copy: copyContext }),
            ],
            onSplit,
            onEqualize,
            onMoveToTab,
            onExpand,
            onSetTitle: onRename && (() => setNaming(true)),
            hasTitle: custom,
            onClearTitle: onRename && (() => onRename(undefined)),
            copyIds: onCopyId ? COPY_IDS.filter(([what]) => sessionKnown || what !== "session").map(([what, label]) => ({ id: what, name: label, run: () => onCopyId(what) })) : [],
            onDiagnostics: () => void copyDiagnostics(),
            onClose: onClose && close,
            onClear: () => {
              clearRef.current();
              termRef.current?.focus();
            },
            onFind: () => findRef.current(),
          })}
        />
      )}
      {plusAt && (
        <PlusMenu
          agents={agents}
          dir={cwd ?? undefined}
          entry={onEntry && { tabs: entryTabs ?? [], onRun: (t) => (setPlusAt(null), onEntry(t)) }}
          shells={shells}
          onShell={
            onShell &&
            ((sh) => {
              setPlusAt(null);
              onShell(sh);
            })
          }
          defaultId={defaultId}
          onSetDefault={onSetDefault}
          busy={launching}
          style={{ top: plusAt.top, right: plusAt.right }}
          onChoose={
            onChoose &&
            (() => {
              setPlusAt(null);
              onChoose();
            })
          }
          onClose={() => setPlusAt(null)}
          onTerminal={
            onSplit &&
            (() => {
              setPlusAt(null);
              onSplit("right");
            })
          }
          onManage={() => {
            setPlusAt(null);
            openSettings("agents");
          }}
          onPick={(a) => {
            setPlusAt(null);
            onLaunch?.(a);
          }}
        />
      )}
      {forkAsk && (
        <ForkDialog
          onCancel={() => setForkAsk(null)}
          onCreate={(forkName) => {
            onSessionLaunch?.(forkAsk, true, forkName);
            setForkAsk(null);
          }}
        />
      )}
      {/* VIEW-023 / VIEW-025 / T-609: the Board card's chip row lives with the Board (board/ChipRow.tsx). */}
      {card?.chip && <ChipRow chip={card.chip} onAnswer={card.onAnswer} onReview={card.onReview} />}
      {card?.meter && (
        <div className="meter" title={meterText(card.meter)}>
          {card.meter.context && (
            <>
              <span className="meter-bar">
                <span className={`meter-fill ${toneOf(card.meter.context.percent)}`.trim()} style={{ width: `${card.meter.context.percent}%` }} />
              </span>
              <span className="meter-ctx">
                {shortTokens(card.meter.context.tokens)} / {shortTokens(card.meter.context.window)}
              </span>
            </>
          )}
          {card.meter.plan && <span className="meter-plan">{meterText({ plan: card.meter.plan })}</span>}
        </div>
      )}
      <div ref={host} className="pane-body" />
      {finding && <FindBar focusTick={findTick} count={hits.count} current={hits.current} slow={hits.slow} onSearch={runFind} onStep={stepFind} onClose={closeFind} />}
      {notice && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={notice.title}
            onKeyDown={(e) => {
              e.stopPropagation();
              trapTab(e);
              if (e.key === "Escape") notice.onSecondary?.();
            }}
          >
            <h2 className="ask-title">{notice.title}</h2>
            <p className="ask-body">{notice.body}</p>
            <div className="btn-row">
              {notice.secondary && (
                <button className="btn" onClick={notice.onSecondary}>
                  {notice.secondary}
                </button>
              )}
              <button ref={noticeButton} className="btn primary" onClick={notice.onPrimary}>
                {notice.primary}
              </button>
            </div>
          </div>
        </div>
      )}
      {pasteAsk && !notice && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={`Paste ${pasteAsk.lines} lines?`}
            onKeyDown={(e) => {
              e.stopPropagation();
              trapTab(e);
              if (e.key === "Escape") {
                setPasteAsk(null);
                termRef.current?.focus();
              }
            }}
          >
            <h2 className="ask-title">Paste {pasteAsk.lines} lines?</h2>
            <p className="ask-body">Each line runs as you paste it: this program takes pasted lines one by one.</p>
            <div className="btn-row">
              <button
                className="btn primary"
                data-paste="go"
                onClick={() => {
                  const { go } = pasteAsk;
                  setPasteAsk(null);
                  go();
                  termRef.current?.focus();
                }}
              >
                Paste
              </button>
              <button
                className="btn"
                data-paste="cancel"
                autoFocus
                onClick={() => {
                  setPasteAsk(null);
                  termRef.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {died !== null && !notice && !pasteAsk && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label="The shell ended"
            onKeyDown={(e) => {
              e.stopPropagation();
              trapTab(e);
              if (e.key === "Escape") closeRef.current?.();
            }}
          >
            <h2 className="ask-title">The shell ended with exit code {died}</h2>
            <p className="ask-body">{exitAdvice(died)}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => closeRef.current?.()}>
                Close pane
              </button>
              <button className="btn primary" autoFocus onClick={() => restart.current(false)}>
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
      {restoreAsk !== null && died === null && !notice && !pasteAsk && (
        <div className="pane-ask" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ask"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label="The terminal did not come back"
            onKeyDown={(e) => {
              e.stopPropagation();
              trapTab(e);
              if (e.key === "Escape") closeRef.current?.();
            }}
          >
            <h2 className="ask-title">This tab's terminal did not come back</h2>
            <p className="ask-body">{restoreAsk}. The tab and its saved output are kept.</p>
            <div className="btn-row">
              <button className="btn" onClick={() => closeRef.current?.()}>
                Close pane
              </button>
              <button className="btn primary" autoFocus onClick={() => retryRestore.current()}>
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// USAGE-001: the gauge lives with the rest of the header readout (UsageReadout.tsx); kept importable from here.
export { ContextGauge };
