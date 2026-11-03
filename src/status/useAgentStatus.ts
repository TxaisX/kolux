// T-543: the agent status the window tracks per pane, moved out of App.tsx as it was. Two hooks,
// because the events need what the grid shows (`inView`), which the window works out later in its
// render: useAgentStatusState is called where the state used to sit, useAgentEvents where the
// listeners used to sit, so the window's hook and effect order is unchanged.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Pane } from "../App";
import type { AgentState } from "../projects/rows";
import type { Crew } from "../terminal/status";
import { noteTitle, turnNote, type StopInfo, type Turn } from "../terminal/notify";
import type { ContextReading } from "../usage/meter";
import { raiseNotification, suppressFocused, type KindKey } from "../settings/notifications";
import { marksUnread } from "../terminal/tabs";
import { folderName } from "../projects/model";
import { sameDir } from "../workspaces";
import { newPaceMemory, noteId, paced } from "../notify/pace";
import { badgeCount } from "../notify/badge";
import { toAcknowledge } from "../notify/seen";
import { admit, ledger } from "./gone";
import { claim } from "../sessions/ownership";
import { finished } from "./finished";
import { forgetSession, onInbandTurn } from "./inbandSession";

export type TurnInfo = { tool?: string; detail?: string; ask?: string; reply?: string; wrote?: string; stop?: StopInfo; plan?: string; planCut?: boolean; monitoring?: boolean };

/** USAGE-001: one status-line report as the hook server sends it. `session` and `at` (the
 * session's running time when the report was made) are optional: a report without them is
 * ordered by arrival, which the hook server's one-at-a-time loop keeps. `session` is the report's
 * clock, the session id with the terminal that ran it (evidence/marks-FIX-1-hooks.patch), so a
 * resume in a new terminal, which keeps the id but starts the running time over, is a new clock
 * and only ever compared for equality here. A resume in the same terminal keeps the clock; its
 * boundary is `fresh`, which forgets the reading without a floor (useAgentEvents). */
export type UsageEvent = { paneKey: number; contextTokens: number | null; contextWindow: number | null; session?: string | null; at?: number | null;
  /** USAGE-034: the session's total cost so far, in US dollars (the status line's cost.total_cost_usd). */
  costUsd?: number | null };
/** A pane's context reading with the stamp it came with, when it had one, and (USAGE-034) the
 * session's cost so far. */
export type Reading = ContextReading & { session?: string; at?: number; costUsd?: number };
/** The stamp of a reading a clear forgot, so a straggler from before the clear stays out. */
export type Floor = { session?: string; at?: number };

const sameClock = (a: { session?: string; at?: number } | undefined, b: Reading): a is { session: string; at: number } =>
  a !== undefined && a.session !== undefined && a.session === b.session && a.at !== undefined && b.at !== undefined;

/** After a fresh start, how long a report can still be one the old process had in flight. */
export const FRESH_WINDOW_MS = 30_000;
/** The margin on the new process's running time over the time since Kolux saw its start: the
 * start hook fires a little after the process begins. */
export const FRESH_MARGIN_MS = 10_000;

/** USAGE-001: true when report `e` is one the new process cannot have made: inside the window after a
 * fresh start (`sinceFresh`, ms, undefined when there was none) and stamped with more running time
 * than the process has existed. Such a report is the old process's, or the new process's first
 * word under a clock that kept counting or a start hook that fired late; the listener holds it as a
 * candidate (stand-in review of lane/marks c75f5900, FIX-SOON 1). */
export function heldByFresh(e: UsageEvent, sinceFresh: number | undefined): boolean {
  return sinceFresh !== undefined && sinceFresh >= 0 && sinceFresh < FRESH_WINDOW_MS && typeof e.at === "number" && e.at > sinceFresh + FRESH_MARGIN_MS;
}

/** USAGE-001: a second held report agrees with the held one: same clock, running time risen by about
 * the time that passed since the first arrived, so a live process is making them, not a straggler
 * (a dead process sends only the one in flight). */
export function sameRun(held: { e: UsageEvent; heldAt: number }, e: UsageEvent, now: number): boolean {
  if (!held.e.session || held.e.session !== e.session || typeof held.e.at !== "number" || typeof e.at !== "number") return false;
  const rose = e.at - held.e.at;
  const passed = now - held.heldAt;
  return rose >= 0 && Math.abs(rose - passed) <= FRESH_MARGIN_MS;
}

/** USAGE-001: the reading a pane should show after report `e`, or null to keep what it has. The
 * newest report wins, even a smaller figure (a compact shrinks context); a report of the same
 * session stamped earlier than the one on screen, or no later than a reading a clear forgot, is
 * a late one and is thrown away. `sinceFresh` is the time since the pane's last fresh start
 * (a Claude start or resume), while that is recent: a new process cannot have run longer than
 * that, so a report stamped with more running time is the old process's, still in flight across
 * the restart, and is thrown away too (stand-in review of lane/marks 54b27f5e, AFTER 1). */
export function takeReading(shown: Reading | undefined, floor: Floor | undefined, e: UsageEvent, sinceFresh?: number): Reading | null {
  if (e.contextTokens === null || e.contextWindow === null) return null;
  if (heldByFresh(e, sinceFresh)) return null;
  const next: Reading = { tokens: e.contextTokens, window: e.contextWindow };
  if (e.session) next.session = e.session;
  if (typeof e.at === "number") next.at = e.at;
  if (sameClock(shown, next) && (next.at as number) < shown.at) return null;
  if (sameClock(floor, next) && (next.at as number) <= floor.at) return null;
  // USAGE-034: the session's cost; a report that carries none leaves the last figure on the chip.
  if (typeof e.costUsd === "number" && Number.isFinite(e.costUsd) && e.costUsd >= 0) next.costUsd = e.costUsd;
  else if (shown?.costUsd !== undefined) next.costUsd = shown.costUsd;
  return next;
}

/** USAGE-001: closing a pane forgets its reading; the same object back when nothing closed. */
export function forgetGone<T>(byPane: Record<number, T>, open: Set<number>): Record<number, T> {
  const gone = Object.keys(byPane).filter((k) => !open.has(Number(k)));
  if (gone.length === 0) return byPane;
  const kept = { ...byPane };
  for (const k of gone) delete kept[Number(k)];
  return kept;
}

/** The record without one pane's entry; the same object back when it has none. */
function without<T>(byPane: Record<number, T>, key: number): Record<number, T> {
  if (!(key in byPane)) return byPane;
  const kept = { ...byPane };
  delete kept[key];
  return kept;
}

export function useAgentStatusState(running: Record<number, boolean>) {
  const [needs, setNeeds] = useState<Record<number, boolean>>({}); // TERM-030: panes waiting on the user
  const [hook, setHook] = useState<Record<number, AgentState>>({}); // STAT-001: each pane's last hook-fed state
  // STAT-050: when each pane's state last moved, and whether that turn was interrupted; the Inbox's clock.
  const [stamp, setStamp] = useState<Record<number, { at: number; interrupted: boolean }>>({});
  // VIEW-023: what each pane's last event said it was doing, and the newest file it wrote this session.
  // TERM-036: the agent's own session id per pane, from its hooks.
  const [turn, setTurn] = useState<Record<number, TurnInfo>>({});
  // STAT-045: the terminal has printed nothing for the quiet window; cleared by the next event.
  const [stale, setStale] = useState<Record<number, boolean>>({});
  const [context, setContext] = useState<Record<number, Reading>>({}); // STAT-040 / USAGE-001: each Claude pane's last context reading
  const [crew, setCrew] = useState<Record<number, Crew>>({}); // STAT-026: each pane's sub-agents and teammates
  const hookRef = useRef(hook);
  hookRef.current = hook;
  const runRef = useRef(running); // TERM-118: the last reported running flags, to see a finish
  runRef.current = running;
  const [unreadPanes, setUnreadPanes] = useState<Set<number>>(new Set()); // TERM-118: finished or rang out of view
  const [unreadDirs, setUnreadDirs] = useState<Set<string>>(new Set()); // PROJ-063 / TERM-118: workspace rows marked unread
  const [winFocused, setWinFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setWinFocused(true);
    const off = () => setWinFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  const markDir = (dir: string, un: boolean) => setUnreadDirs((u) => new Set(un ? [...u, dir] : [...u].filter((d) => !sameDir(d, dir))));
  return { needs, setNeeds, hook, setHook, stamp, setStamp, turn, setTurn, stale, setStale, context, setContext, crew, setCrew, hookRef, runRef, unreadPanes, setUnreadPanes, unreadDirs, setUnreadDirs, winFocused, markDir };
}

type Status = ReturnType<typeof useAgentStatusState>;

type EventsDeps = Pick<Status, "setCrew" | "setTurn" | "setStale" | "hookRef" | "setHook" | "setStamp" | "setContext" | "unreadPanes" | "setUnreadPanes" | "winFocused" | "markDir"> & Partial<Pick<Status, "stamp">> & {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  titles: Record<number, string>;
  settings: Record<string, unknown>;
  inView: (key: number) => boolean;
  setToast: (text: string) => void;
  tabName: (p: Pane, titles: Record<number, string>) => string;
  /** Review of PR #16 (d): plain terminal panes whose hand-started agent has gone (board/chip.ts hooksMuted): their
   *  late hook events are dropped, until a new agent starts there (its shell marks, or its own fresh SessionStart). */
  muted?: { current: Record<number, boolean> };
};

export function useAgentEvents({ panes, setPanes, titles, settings, inView, setToast, tabName, setCrew, setTurn, setStale, hookRef, setHook, stamp, setStamp, setContext, unreadPanes, setUnreadPanes, winFocused, markDir, muted }: EventsDeps) {
  // STAT-041: the note names the repository when more than one has agents running.
  const repoOf = (p: Pane): string | null => {
    const repos = new Set(panes.filter((x) => x.agent !== "shell" && x.cwd !== null).map((x) => folderName(x.cwd as string)));
    return repos.size > 1 && p.cwd !== null ? folderName(p.cwd) : null;
  };
  // STAT-044 / T-125: what was notified, so repeats for one worktree merge and an event never shows twice.
  const paceRef = useRef(newPaceMemory());
  const noticed = (p: Pane, what: string, body = "", gate: KindKey = "notifyOnFinish") => {
    const id = noteId();
    const known = new Set(panes.map((x) => x.key));
    if (!known.has(p.key)) return;
    const title = noteTitle(tabName(p, titles), repoOf(p), what);
    const kind = gate === "notifyOnStopped" ? ("stop" as const) : gate === "notifyBell" ? ("bell" as const) : ("finish" as const);
    // T-692: the kind goes to this pacer too, so a stop keeps its own cooldown here as well.
    const show = () => paced(paceRef.current, p.cwd, id, Date.now(), { focused: winFocused, quietWhenFocused: suppressFocused(settings), kind });
    // STAT-041: every note on a pane out of view (or in an unfocused window) is a desktop
    // notification unless 'Agent Task Complete' is off (a stop goes by 'Agent Stopped', STAT-023);
    // the unread mark and the toast keep T-024's one-mark-until-viewed rule.
    // STAT-044 (lane/tray): the event's identity and pane go to the backend (notify_event), so a click
    // can focus this pane; main's pacer above stays the one that merges repeats.
    const event = { id, worktree: p.cwd, pane: String(p.key), kind };
    // STAT-047: the tray dot lights (while the window is hidden) before any toast switch is consulted.
    void invoke("tray_ping", { kind: kind === "bell" ? "bell" : "finished" }).catch(() => {});
    // STAT-044 "Stay quiet about the worktree you are looking at": only the worktree in view is held back.
    if (!(inView(p.key) && winFocused) && settings[gate] !== false && show()) void raiseNotification(settings, title, body, event).catch(() => {});
    if (!marksUnread(p.key, known, unreadPanes, inView(p.key), winFocused)) return;
    setUnreadPanes((u) => new Set([...u, p.key]));
    if (p.cwd !== null) markDir(p.cwd, true);
    setToast(title);
  };
  const noticedRef = useRef(noticed);
  noticedRef.current = noticed;
  // STAT-045: the quiet alert has its own switch (the minutes), so neither the view nor the finish
  // switch gates it: a toast and a desktop notification, once per silent spell.
  const quiet = (p: Pane, minutes: number) => {
    const title = noteTitle(tabName(p, titles), repoOf(p), `has gone quiet for ${minutes} min`);
    setToast(title);
    void raiseNotification(settings, title, "No terminal output since then. It may be stuck.", { id: noteId(), worktree: p.cwd, pane: String(p.key), kind: "quiet" }).catch(() => {});
  };
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  /** Whether a hook event for `paneKey` is dropped; a fresh start lifts the pane's mute. */
  const droppedLate = (paneKey: number, fresh: boolean | undefined): boolean => {
    const m = mutedRef.current;
    if (!m?.current[paneKey]) return false;
    if (!fresh) return true;
    m.current = { ...m.current, [paneKey]: false };
    return false;
  };
  // USAGE-001: the stamp of each reading a clear forgot.
  const floorRef = useRef<Record<number, Floor>>({});
  // USAGE-001: what each pane's gauge shows, kept beside the state so the listeners decide outside
  // the state updaters; an updater must stay pure, React may run it again (stand-in review of
  // lane/marks 243736d, AFTER 10). The listeners here are the only writers of the readings.
  const shownRef = useRef<Record<number, Reading>>({});
  // USAGE-001: when each pane last saw a fresh start, to tell the old process's late report from the new one's.
  const freshRef = useRef<Record<number, number>>({});
  // USAGE-001: each pane's held report (see heldByFresh), shown when the window ends with nothing else.
  const heldRef = useRef<Record<number, { e: UsageEvent; heldAt: number; timer: ReturnType<typeof setTimeout> }>>({});
  const dropHeld = (paneKey: number) => {
    const h = heldRef.current[paneKey];
    if (!h) return;
    clearTimeout(h.timer);
    heldRef.current = without(heldRef.current, paneKey);
  };
  const show = (paneKey: number, next: Reading) => {
    dropHeld(paneKey);
    shownRef.current = { ...shownRef.current, [paneKey]: next };
    setContext((c) => ({ ...c, [paneKey]: next }));
  };
  useEffect(() => {
    // STAT-001: the hooks report each pane's state; a turn ending out of view is noticed like an exit.
    const off = listen<{ paneKey: number; children: Crew; tool?: string; detail?: string; ask?: string; wrote?: string; plan?: string; planCut?: boolean; session?: string; fresh?: boolean } & Turn>("agent-status", (e) => {
      const { paneKey, state, children, tool, detail, ask, reply, wrote, boundary, stop, plan, planCut, session, monitoring, fresh } = e.payload;
      // STAT-031 / T-275: a closed tab's late event, or a retired pane's, changes nothing.
      // Review of PR #16 (d): a late Stop or done from an agent that already gave the prompt back changes nothing.
      if (droppedLate(paneKey, fresh)) return;
      if (!admit(ledger, paneKey, new Set(panesRef.current.map((x) => x.key)), { state, fresh })) return;
      // SESS-030: the newest session id is what a restart resumes (a /clear or a resume brings a new one).
      // ACCT-063: the pane owns the session it reports; another pane holding the same id lets go of it.
      if (session) setPanes((ps) => claim(ps, paneKey, session));
      setCrew((c) => (children.length === 0 && !(paneKey in c) ? c : { ...c, [paneKey]: children }));
      setTurn((t) => ({ ...t, [paneKey]: { tool, detail, ask, reply, stop, plan, planCut, monitoring, wrote: boundary ? undefined : (wrote ?? t[paneKey]?.wrote) } }));
      setStale((m) => (m[paneKey] ? { ...m, [paneKey]: false } : m));
      const prev = hookRef.current[paneKey];
      // STAT-041: a finish, a permission request, a block, an interrupt or a sub-agent's turn is a note.
      const note = turnNote(prev, e.payload);
      // STAT-038 / T-309-b: a finish asks the sidebar's pull request poll for one early round.
      if (note?.what === "finished") finished(paneKey, panesRef.current.find((x) => x.key === paneKey)?.cwd ?? null);
      if (note) {
        const p = panesRef.current.find((x) => x.key === paneKey);
        if (p) noticedRef.current(p, note.what, note.body, note.stopped ? "notifyOnStopped" : "notifyOnFinish");
      }
      // STAT-046: a stop on a sign-in failure has the account checked, so the main-window notice
      // (SignInNotice) names the lapsed account without waiting for the next start.
      if (stop?.cause === "signin" && prev !== "blocked") invoke("claude_account_check", { cause: "signin" }).catch(() => {});
      // USAGE-001: clearing the pane (a /clear, a resume, a manual compact) forgets its reading; the
      // next status report brings the new figure. A clear or a compact keeps the agent's process, so
      // a report from before it may still turn up: the forgotten stamp is the floor. A start or a
      // resume (`fresh`) is a new process whose running time may start over on the same clock (a
      // resume in the same terminal), so it sets no floor and lifts any earlier one (stand-in review
      // of lane/marks 3efef76, FIX-SOON 1).
      if (boundary) {
        dropHeld(paneKey);
        const r = shownRef.current[paneKey];
        if (fresh) {
          delete floorRef.current[paneKey];
          freshRef.current[paneKey] = Date.now();
        } else if (r) floorRef.current[paneKey] = { session: r.session, at: r.at };
        if (r) {
          shownRef.current = without(shownRef.current, paneKey);
          setContext((c) => without(c, paneKey));
        }
      }
      if (prev !== state) {
        setHook((h) => ({ ...h, [paneKey]: state }));
        setStamp((m) => ({ ...m, [paneKey]: { at: Date.now(), interrupted: e.payload.interrupted || boundary } }));
      }
    });
    // STAT-045: the quiet alert comes from the terminal's own silence, judged in Rust.
    // USAGE-001: readings are per pane and the newest wins; a late one, or one for a closed pane, is dropped.
    const offUsage = listen<UsageEvent>("claude-usage", (e) => {
      const { paneKey } = e.payload;
      if (!panesRef.current.some((p) => p.key === paneKey)) return;
      const since = freshRef.current[paneKey];
      const sinceMs = since === undefined ? undefined : Date.now() - since;
      let guard = sinceMs;
      if (heldByFresh(e.payload, sinceMs)) {
        const held = heldRef.current[paneKey];
        if (!(held && sameRun(held, e.payload, Date.now()))) {
          // The new process's first word or the old one's straggler: keep it as the candidate. If
          // nothing else comes before the window ends it is shown, without its clock so whatever
          // the new process reports next is taken (it cannot freeze the gauge).
          // A limits-only report (no context) says nothing about the gauge: it leaves the candidate be.
          if (e.payload.contextTokens === null || e.payload.contextWindow === null) return;
          dropHeld(paneKey);
          const timer = setTimeout(() => {
            const h = heldRef.current[paneKey];
            if (!h || !panesRef.current.some((p) => p.key === paneKey)) return;
            const late = takeReading(shownRef.current[paneKey], floorRef.current[paneKey], { ...h.e, session: null, at: null });
            if (late) show(paneKey, late);
          }, FRESH_WINDOW_MS - (sinceMs as number));
          heldRef.current = { ...heldRef.current, [paneKey]: { e: e.payload, heldAt: Date.now(), timer } };
          return;
        }
        // A live process is making these: take the newer, with its clock.
        guard = undefined;
      }
      const next = takeReading(shownRef.current[paneKey], floorRef.current[paneKey], e.payload, guard);
      if (!next) return;
      show(paneKey, next);
    });
    const offQuiet = listen<{ paneKey: number; minutes: number }>("agent-quiet", (e) => {
      const p = panesRef.current.find((x) => x.key === e.payload.paneKey);
      if (p) quietRef.current(p, e.payload.minutes);
      setStale((m) => ({ ...m, [e.payload.paneKey]: true }));
    });
    // STAT-032: a working reading with no hook signal for 30 minutes reads No recent update, quietly.
    const offUnverified = listen<{ paneKey: number; minutes: number }>("agent-unverified", (e) => setStale((m) => ({ ...m, [e.payload.paneKey]: true })));
    // STAT-034 (T-124-b): an in-band new turn drops the pane's stored provider session; a completion keeps it.
    const offInbandTurn = onInbandTurn((paneKey) => setPanes((ps) => forgetSession(ps, paneKey)));
    return () => {
      offInbandTurn();
      // The window going away takes the candidates' timers with it.
      for (const k of Object.keys(heldRef.current)) dropHeld(Number(k));
      off.then((f) => f());
      offQuiet.then((f) => f());
      offUnverified.then((f) => f());
      offUsage.then((f) => f());
    };
  }, []);
  // STAT-049 / T-125: the acknowledgements made, by pane and turn stamp, so a future-stamped turn clears once.
  const ackedRef = useRef(new Set<string>());
  useEffect(() => {
    // Viewing a marked pane in a focused window clears its mark (STAT-049: a pane with no status yet
    // keeps being watched; a pane marked unread by hand would stay, none can be yet).
    if (!winFocused || unreadPanes.size === 0) return;
    const { panes: seen, acks } = toAcknowledge({ unread: unreadPanes, inView, focused: winFocused, manual: new Set(), stampOf: (k) => (hookRef.current[k] === undefined ? undefined : (stamp?.[k]?.at ?? 0)), acked: ackedRef.current });
    if (seen.length === 0) return;
    for (const a of acks) ackedRef.current.add(a);
    setUnreadPanes((u) => new Set([...u].filter((k) => !seen.includes(k))));
    for (const p of panes) if (seen.includes(p.key) && p.cwd !== null) markDir(p.cwd, false);
  });
  useEffect(() => {
    // STAT-048: the taskbar or dock badge counts the workspaces with unseen results; zero clears it.
    void invoke("badge_set", { count: badgeCount(unreadPanes, panes) }).catch(() => {});
  }, [unreadPanes, panes]);
  useEffect(() => {
    // USAGE-001: closing a pane forgets its reading.
    const open = new Set(panes.map((p) => p.key));
    setContext((c) => forgetGone(c, open));
    shownRef.current = forgetGone(shownRef.current, open);
    floorRef.current = forgetGone(floorRef.current, open);
    freshRef.current = forgetGone(freshRef.current, open);
    for (const k of Object.keys(heldRef.current)) if (!open.has(Number(k))) dropHeld(Number(k));
  }, [panes]);
  return { noticed, panesRef };
}
