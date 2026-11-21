// Cycle 3 (the WindowView split): one pane's body, moved out of shell/WindowView.tsx as it was: the
// editor, diff, all-changes and preview tabs (EDIT-001..), the chooser
// (SESS-007) and the terminal with every signal it reports and every action its header offers
// (TERM-013, TERM-042, TERM-045, TERM-106, STAT-050, ACCT-023). A pane's key is still the key of its
// terminal, so a layout change never remounts it (TERM-017).
import type { Pane } from "../../App";
import { forget, hooksMuted, promptReturned } from "../../status/chip";
import { BELL_NOTE } from "../../terminal/bellNote";
import { canExpand, groupOf, toggleCard } from "../../terminal/grid";
import { moveToTab } from "../tidy";
import { readoutOf } from "../../terminal/headerUsage";
import { showsDragHandle } from "../../terminal/rearrange";
import { gpuOn } from "../../terminal/renderer";
import { showsReview } from "../../terminal/planReview";
import { tabName } from "../../terminal/tabName";
import { codexSetup, spawnRecord } from "../../terminal/accountChange";
import { deliverPrompt, startWatch } from "../../launch/startWatch";
import { capOn, readsLeft } from "../../usage/meter";
import { nameOf, sameDir, viewOf } from "../../workspaces";
import { worktreeTag } from "../../projects/worktreeGrid";
import { watchCodexSignIn } from "../../settings/codexSignInScan";
import { invoke } from "@tauri-apps/api/core";
import { deferred } from "../../lazy/deferred";
import SeatChooser from "./SeatChooser";
// PKG-2: the terminal pane behind its render comparison (TerminalMemo.tsx).
import TerminalPane from "./TerminalMemo";
import { useWindow } from "./store";
import { useStableFns } from "./stable";
import { paneInView } from "./inView";
import type { Identity } from "../../terminal/shellMarks";
import type { Launch } from "../../terminal/sessionFork";
import type { ShellEntry } from "../../terminal/shellChoice";
import type { EntryTarget } from "../../launch/newTabEntryRun";
import type { AgentState } from "../../projects/rows";
import type { AgentInfo } from "../../launch/PlusMenu";
import { ChatPane } from "../../lazy/pages";
import { CheckPane } from "../../lazy/panes";
import { openExternal } from "../../open/openExternal";

/** A restored tab that lost its data is rare: its placeholder loads when one is drawn, not at start. */
const LostPane = deferred(() => import("./LostPane"));
const AsleepPane = deferred(() => import("../../sleep/AsleepPane"));

export default function WindowPane({ pane: p, active }: { pane: Pane; active: number }) {
  const {
    terminals, focused, closePane, setFocused, settings, titles, liveIds, openFile, restoredKeys, projects, setExpanded,
    answer, context, agents, defaultId, setDefault, launching, launch, addChooser, savedName, ptys, unreadPanes,
    hook, hookRef, turn, crew, setNeeds, setStamp, setRunning, runRef, liveRef, muteRef, setGuess, setLiveIds, setHook,
    setPanes, noticed, report,
    dragging, setDropHint, shown, equalizePanes, gridCount, moveOutToTab, zoomed, classic, expandPane, names,
    renamePane, askName, shells, newTab, copyId, findHandle, setReviewing, setToast, failedPane, noticeFor,
    splitPane, rememberLineup, panes, activeDir, wakePane, owner, setSidebarOpen, setWorktreeMenu, cells, newChat,
  } = useWindow();
  // FT-1 (review 0.2.0): hidden unless really on screen: terminals shown, its folder in front, top tab, not zoomed away.
  const hidden = !paneInView(cells.find((c) => c.group === groupOf(p)), p.key, active, { terminals, activeDir, zoomed });
  // PKG-2: what the terminal runs from its handlers and effects, made here each render over this render's pane and
  // window, and handed over as callers with a fixed identity, so a new closure alone never redraws the pane. The
  // terminal calls none of these while it draws (it reads them through refs or on a click).
  const act = useStableFns({
    focus: () => {
      setFocused(p.key);
    },
    running: (on: boolean | undefined) => {
      // T-151-c: a program still starting reports undefined: no entry yet, so it never reads as ended
      if (on === undefined) {
        setRunning((r) => (p.key in r ? Object.fromEntries(Object.entries(r).filter(([k]) => Number(k) !== p.key)) : r));
        return;
      }
      if (runRef.current[p.key] && !on && p.agent !== "shell") {
        noticed(p, "finished");
        setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
      }
      setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }));
      // STAT-050: a pane that just started counts from now in the Inbox.
      if (on) setStamp((m) => (m[p.key] ? m : { ...m, [p.key]: { at: Date.now(), interrupted: false } }));
      // The program is gone: its last hook state goes with it everywhere.
      if (!on && p.key in hookRef.current) setHook((h) => Object.fromEntries(Object.entries(h).filter(([k]) => Number(k) !== p.key)));
    },
    needsYou: (on: boolean) => setNeeds((r) => (r[p.key] === on ? r : { ...r, [p.key]: on })),
    worktree: (path: string, x: number, y: number) => (setSidebarOpen(true), setWorktreeMenu({ path, x, y, n: Date.now() })),
    identity: (l: Identity) => {
      // Review of PR #16: a hand-started agent quit and the prompt is back: its last word and guess go with it,
      // and (d) a late hook word from it is ignored until a new agent starts in the pane.
      const muted = muteRef.current[p.key] ?? false;
      const mute = hooksMuted(muted, p, liveRef.current[p.key], l);
      if (mute !== muted) muteRef.current = { ...muteRef.current, [p.key]: mute };
      if (promptReturned(p, liveRef.current[p.key], l)) {
        setHook((h) => forget(h, p.key));
        setGuess((g) => forget(g, p.key));
      }
      setLiveIds((m) => (m[p.key] === l ? m : { ...m, [p.key]: l }));
    },
    guess: (g: AgentState | null) => setGuess((m) => (m[p.key] === g ? m : { ...m, [p.key]: g })),
    bell: () => noticed(p, BELL_NOTE.what, "", BELL_NOTE.gate),
    pty: (id: number, account: string | null) => {
      ptys.current[p.key] = id;
      startWatch.seen(p.key);
      // C24-R1-01: the tab has its terminal, so it is no longer a restore in flight: a later failure
      // of this tab drops it as usual instead of being kept as a restored one.
      restoredKeys.current.delete(p.key);
      // SESS-032 (T-163): an agent's opening prompt is handed over by Rust exactly once; a
      // prompt that does not go in is said in a toast.
      if (p.typed && p.agent !== "shell") void deliverPrompt(invoke, id, p.typed, agents.find((a) => a.id === p.agentId)?.name ?? p.agent).then((lost) => lost && setToast(lost));
      report.current();
      if (p.batch !== undefined && p.agent !== "shell") rememberLineup(p.batch);
      // T-139-d: a Codex pane on a managed account is watched for printed sign-in errors.
      watchCodexSignIn(id, p.agent === "codex" ? account : null);
      // ACCT-023: a Codex pane remembers the account it began on (and its setup, T-139-d); T-548-b: so does a Claude pane.
      const began = spawnRecord(p, account, codexSetup(settings));
      if (began) setPanes((ps) => ps.map((x) => (x.key === p.key ? { ...x, ...began } : x)));
    },
    failed: (error: string) => {
      failedPane(p.key, error);
    },
    // C24-R1-01: the tab could not take its terminal back; it stays, so it is no longer a restore in
    // flight and the loaded latch does not wait on it, and the pane's own notice is the only warning.
    restoreFailed: () => {
      restoredKeys.current.delete(p.key);
      startWatch.seen(p.key);
    },
    split: (dir: "right" | "down") => splitPane(p.key, dir),
    dragStart: () => void (dragging.current = { cell: groupOf(p) }),
    dragEnd: () => (dragging.current = null, setDropHint(null)),
    equalize: () => equalizePanes(),
    moveToTab: () => moveOutToTab(p.key),
    expand: () => expandPane(p.key),
    rename: (name: string | undefined) => renamePane(p.key, name),
    sessionLaunch: (l: Launch, fork: boolean, forkName?: string) => splitPane(p.key, "right", { agent: p.agent, agentId: p.agentId, account: p.account, setup: p.setup, env: p.env, program: l.program, args: l.args, forkOf: fork ? p.session : undefined, title: fork ? forkName : undefined }),
    entry: (t: EntryTarget) => (t.kind === "web" ? void openExternal(t.url) : t.kind === "file" ? openFile(t.path) : setFocused(t.key)),
    shell: (sh: ShellEntry) => void newTab({ shell: sh }), // TERM-043: the plus menu's shell choice, a tab like the New tab menu's
    copyId: (what: "session" | "terminal" | "pane") => copyId(p, what),
    findHandle: (h: string) => findHandle(h),
    close: () => closePane(p.key),
    reviewPlan: () => setReviewing({ key: p.key, plan: turn[p.key]?.plan ?? "", cut: !!turn[p.key]?.planCut }),
    setDefault: (id: string) => setDefault(id),
    launch: (a: AgentInfo) => launch(a, null),
    // Slice 1 of chat panes: the plus menu's "New chat" opens one Claude pane that draws the chat engine.
    newChat: () => void newChat(),
    choose: () => addChooser(),
    openFile: (path: string, line?: number) => openFile(path, line),
    toggleCard: () => setExpanded((x) => toggleCard(x, p.key)),
    answer: (ok: boolean) => void answer(p, ok),
    // ACCT-064: the question's buttons run what the newest render's question says.
    noticePrimary: () => noticeFor(p)?.onPrimary(),
    noticeSecondary: () => noticeFor(p)?.onSecondary?.(),
  });
  if (p.kind === "check" && p.check && p.cwd) {
    return <CheckPane key={p.key} id={p.key} check={p.check} cwd={p.cwd} hidden={hidden} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} onOpenFile={openFile} onToast={setToast} />;
  }
  if (p.seats) {
    return <SeatChooser pane={p as Pane & { seats: NonNullable<Pane["seats"]> }} hidden={hidden} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />;
  }
  // A restored tab that kept its kind but lost its data is a placeholder, never a live terminal (UX lane A, shell.md row 12).
  if (p.kind) return <LostPane kind={p.kind} hidden={hidden} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />;
  // TERM-123 (T-817): a sleeping agent pane shows its placeholder; its terminal is unmounted (ended). Wake remounts it as a restored tab.
  if (p.asleep) return <AsleepPane asleep={p.asleep} hidden={hidden} onWake={() => (setFocused(p.key), void wakePane(p.key))} />;
  // Slice 1 of chat panes (docs/research/chat-pane-plan-2026-11-20.md): a pane marked `chat` draws the chat
  // engine's own conversation, and no terminal is ever spawned for it. Every other pane is a terminal, exactly
  // as before: this branch is the only place a pane's body is chosen by `chat`.
  if (p.chat) {
    return (
      <ChatPane
        key={p.key}
        pane={{ key: p.key, cwd: p.cwd, title: p.title || nameOf(names, p.cwd) }}
        hidden={hidden}
        focused={p.key === focused}
        onFocus={act.focus}
        onClose={act.close}
        open={{ onOpenFile: openFile, onOpenLink: (url: string) => void openExternal(url), inKolux: settings.linksOpenInKolux === true }}
      />
    );
  }
  const notice = noticeFor(p);
  return (
    <TerminalPane
      key={p.key}
      hidden={hidden}
      restored={restoredKeys.current.has(p.key)}
      identityBefore={liveRef.current[p.key]}
      resumed={p.resumed}
      onOpenFile={act.openFile}
      onOpenLink={(url: string) => void openExternal(url)}
      linksOpenInKolux={settings.linksOpenInKolux === true}
      gpu={gpuOn(settings)}
      cwd={p.cwd}
      branch={p.branch}
      worktree={worktreeTag(p.cwd, p.branch ?? null, { projects, owner, names })}
      onWorktree={act.worktree}
      agent={p.agent}
      name={savedName(p)}
      program={p.program}
      args={p.args}
      env={p.env}
      stop={turn[p.key]?.stop}
      usage={p.agent === "shell" ? undefined : readoutOf(context[p.key], capOn(settings), readsLeft(settings))}
      focused={p.key === focused}
      onFocus={act.focus}
      onRunning={act.running}
      hook={hook[p.key] === "working" && turn[p.key]?.monitoring ? "background" : hook[p.key]}
      pendingTool={hook[p.key] === "permission" ? turn[p.key]?.tool : undefined}
      keySettings={settings}
      crew={crew[p.key]}
      onNeedsYou={act.needsYou}
      onIdentity={act.identity}
      onGuess={act.guess}
      onBell={act.bell}
      unread={unreadPanes.has(p.key)}
      onPty={act.pty}
      account={p.account}
      notice={notice && { ...notice, onPrimary: act.noticePrimary, onSecondary: notice.onSecondary && act.noticeSecondary }}
      onFailed={act.failed}
      onRestoreFailed={act.restoreFailed}
      onSplit={act.split}
      dragCell={showsDragHandle(shown.length) ? { onStart: act.dragStart, onEnd: act.dragEnd } : undefined}
      onEqualize={terminals && gridCount > 1 ? act.equalize : undefined}
      onMoveToTab={terminals && gridCount > 1 && moveToTab(panes, p.key) ? act.moveToTab : undefined}
      expand={{ on: zoomed === groupOf(p), can: canExpand(shown.length, classic), toggle: act.expand }}
      title={p.title || nameOf(names, p.cwd)}
      custom={!!p.title}
      onRename={act.rename}
      renameAsk={askName[p.key]}
      sessionKnown={!!p.session}
      session={p.session}
      onSessionLaunch={act.sessionLaunch} // after-list #117: Continue / Fork open a second pane beside this one
      entryTabs={panes.filter((q) => sameDir(viewOf(q), activeDir)).map((q) => ({ key: q.key, name: tabName(q, titles, liveIds) }))}
      onEntry={act.entry}
      shells={shells}
      onShell={act.shell}
      onCopyId={act.copyId}
      findHandle={act.findHandle}
      typed={p.typed}
      shellName={p.word}
      number={p.key}
      onClose={act.close}
      onReviewPlan={showsReview(hook[p.key], turn[p.key]) ? act.reviewPlan : undefined}
      agents={agents}
      defaultId={defaultId}
      onSetDefault={act.setDefault}
      launching={launching}
      onLaunch={act.launch}
      onChoose={act.choose}
      onChat={act.newChat}
    />
  );
}
