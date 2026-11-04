// Cycle 3 (the WindowView split): one pane's body, moved out of shell/WindowView.tsx as it was: the
// browser page (T-012-a), the editor, diff, all-changes and preview tabs (EDIT-001..), the chooser
// (SESS-007) and the terminal with every signal it reports and every action its header offers
// (TERM-013, TERM-042, TERM-045, TERM-106, STAT-050, ACCT-023). A pane's key is still the key of its
// terminal, so a layout change never remounts it (TERM-017).
import type { Pane } from "../../App";
import { keyOf } from "../../editor/buffers";
import { sendTargets } from "../../editor/notes";
import { forget, hooksMuted, promptReturned } from "../../board/chip";
import { touchRunTab } from "../../automations/runTab";
import { BELL_NOTE } from "../../terminal/bellNote";
import { canExpand, groupOf, toggleCard } from "../../terminal/grid";
import { moveToTab } from "../tidy";
import { readoutOf } from "../../terminal/headerUsage";
import { showsDragHandle } from "../../terminal/rearrange";
import { gpuOn } from "../../terminal/renderer";
import { showsReview } from "../../terminal/planReview";
import { tabName } from "../../terminal/tabName";
import { codexSetup, spawnRecord } from "../../terminal/accountChange";
import { onRunning } from "../../inbox/exitedPrompt";
import { deliverPrompt, startWatch } from "../../launch/startWatch";
import { capOn, claudeOf, codexOf, contextFill, meterOf, readsLeft } from "../../usage/meter";
import { nameOf, sameDir } from "../../workspaces";
import { watchCodexSignIn } from "../../settings/codexSignInScan";
import { invoke } from "@tauri-apps/api/core";
import { deferred } from "../../lazy/deferred";
import SeatChooser from "./SeatChooser";
import TerminalPane from "../../terminal/TerminalPane";
import { useWindow } from "./store";
import { EditorPane } from "../../lazy/panes";
import { DiffPane } from "../../lazy/panes";
import { AllChangesPane } from "../../lazy/panes";
import { PreviewPane } from "../../lazy/panes";
import { CheckPane } from "../../lazy/panes";
import { BrowserPane } from "../../lazy/panes";
import { openInBrowser } from "../../browser/openIn";

/** A restored tab that lost its data is rare: its placeholder loads when one is drawn, not at start. */
const LostPane = deferred(() => import("./LostPane"));

export default function WindowPane({ pane: p, active }: { pane: Pane; active: number }) {
  const {
    terminals, settingsOpen, board, focused, closePane, setFocused, settings, agentsScreen, titles, liveIds, notes,
    setNotes, notesFor, putNote, dropNotes, openDiff, openFile, followLink, pasteInto, restoredKeys, projects,
    projectOf, expanded, setExpanded, chipFor, columnOf, answer, reviewChanges, plan, accountSwitcher,
    context, agents, defaultId, setDefault, launching, launch, addChooser, savedName, labelOf, planLine,
    setDirty, ptys, unreadPanes, hook, hookRef, turn, crew, setNeeds, stamp, setStamp, setRunning, runRef,
    liveRef, muteRef, setGuess, setLiveIds, setHook, setPanes, exitedPrompt, afterSetup, noticed, report, runTabs,
    dragging, setDropHint, shown, equalizePanes, gridCount, moveOutToTab, zoomed, classic, expandPane, names,
    renamePane, askName, shells, newTab, copyId, findHandle, setReviewing, setToast, failedPane, noticeFor,
    splitPane, rememberLineup, panes, activeDir,
  } = useWindow();
  if (p.kind === "browser") {
    return (
      <BrowserPane
        key={p.key}
        id={p.key}
        url={p.url ?? p.path}
        title={titles[p.key]}
        hidden={!terminals || settingsOpen || p.key !== active}
        focused={p.key === focused}
        onFocus={() => setFocused(p.key)}
        onClose={() => closePane(p.key)}
        cwd={p.cwd}
        // BROW-037: notes go to an agent pane in the tab's own worktree, by the review-notes paste path.
        targets={() => sendTargets(panes, (x) => x.cwd !== null && p.cwd !== null && sameDir(x.cwd, p.cwd) && ptys.current[x.key] !== undefined, stamp, Date.now(), (x) => tabName(x, titles))}
        onSend={(key, text) => pasteInto(key, text)}
        restored={restoredKeys.current.has(p.key)}
      />
    );
  }
  if (p.kind === "editor" && p.path) {
    return (
      <EditorPane
        key={p.key}
        id={p.key}
        path={p.path}
        root={p.cwd}
        readOnly={p.follow}
        follow={p.follow}
        notes={notes}
        onRemoveNote={(n) => setNotes((ns) => ns.filter((x) => x !== n))}
        onEditNote={(n, text) => setNotes((ns) => ns.map((x) => (x === n ? { ...x, note: text } : x)))}
        hidden={!terminals || p.key !== active}
        focused={p.key === focused}
        onFocus={() => setFocused(p.key)}
        onClose={() => closePane(p.key)}
        onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
        onToast={setToast}
        jump={p.jump}
        onLink={followLink}
      />
    );
  }
  if (p.kind === "diff" && p.path) {
    return (
      <DiffPane
        key={p.key}
        id={p.key}
        path={p.path}
        root={p.cwd}
        staged={!!p.staged}
        hidden={!terminals || p.key !== active}
        focused={p.key === focused}
        onFocus={() => setFocused(p.key)}
        onClose={() => closePane(p.key)}
        onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
        onToast={setToast}
        notes={notesFor(p.cwd).filter((n) => keyOf(n.path) === keyOf(p.path ?? ""))}
        onSaveNote={p.cwd === null ? undefined : (n) => putNote(p.cwd as string, n)}
        onDeleteNote={(n) => p.cwd !== null && dropNotes(p.cwd, [n.id])}
        jump={p.jump}
      />
    );
  }
  if (p.kind === "changes" && p.cwd) {
    return (
      <AllChangesPane key={p.key} id={p.key} root={p.cwd} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} onOpenDiff={(path, staged) => openDiff(path, staged, true)} pinnedBase={projects.find((pr) => pr.id === projectOf(p.cwd))?.base ?? null} />
    );
  }
  if (p.kind === "check" && p.check && p.cwd) {
    return <CheckPane key={p.key} id={p.key} check={p.check} cwd={p.cwd} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} onOpenFile={openFile} onToast={setToast} />;
  }
  if (p.kind === "preview" && p.path) {
    return (
      <PreviewPane key={p.key} id={p.key} path={p.path} worktree={p.cwd} onLink={followLink} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
    );
  }
  if (p.seats) {
    return <SeatChooser pane={p as Pane & { seats: NonNullable<Pane["seats"]> }} hidden={!board && p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />;
  }
  // A restored tab that kept its kind but lost its data is a placeholder, never a live terminal (UX lane A, shell.md row 12).
  if (p.kind) return <LostPane kind={p.kind} hidden={!terminals || p.key !== active} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />;
  return (
    <TerminalPane
      key={p.key}
      hidden={!board && p.key !== active}
      restored={restoredKeys.current.has(p.key)}
      resumed={p.resumed}
      onOpenFile={openFile}
      onOpenLink={openInBrowser}
      linksOpenInKolux={settings.linksOpenInKolux === true}
      gpu={gpuOn(settings)}
      card={board ? { expanded: expanded === p.key, onToggle: () => setExpanded((x) => toggleCard(x, p.key)), chip: chipFor(p), column: columnOf(p), onAnswer: (ok) => void answer(p, ok), onReview: () => reviewChanges(p.key), meter: p.seats || p.kind ? null : meterOf(context[p.key], p.agent, claudeOf(p.agent, p.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) } : undefined}
      cwd={p.cwd}
      branch={p.branch}
      agent={p.agent}
      name={savedName(p) ?? labelOf(p)}
      plan={agentsScreen ? planLine(p) : undefined}
      program={p.program}
      args={p.args}
      env={p.env}
      stop={turn[p.key]?.stop}
      context={context[p.key] ? contextFill(context[p.key], capOn(settings)) : null}
      usage={p.agent === "shell" ? undefined : readoutOf(context[p.key], capOn(settings), readsLeft(settings))}
      focused={p.key === focused}
      onFocus={() => {
        setFocused(p.key);
        runTabs.current = touchRunTab(runTabs.current, p.key);
      }}
      onRunning={(on) => {
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
        // The program is gone: its last hook state goes with it everywhere. An open question or
        // permission is remembered for the Inbox alone (T-035-b); a stop is not a prompt.
        exitedPrompt.current = onRunning(exitedPrompt.current, p.key, on, hookRef.current[p.key]);
        if (!on && p.key in hookRef.current) setHook((h) => Object.fromEntries(Object.entries(h).filter(([k]) => Number(k) !== p.key)));
        const then = !on && runRef.current[p.key] && afterSetup.current[p.key];
        if (then) {
          delete afterSetup.current[p.key];
          then();
        }
      }}
      hook={hook[p.key] === "working" && turn[p.key]?.monitoring ? "background" : hook[p.key]}
      pendingTool={hook[p.key] === "permission" ? turn[p.key]?.tool : undefined}
      keySettings={settings}
      crew={crew[p.key]}
      onNeedsYou={(on) => setNeeds((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
      onIdentity={(l) => {
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
      }}
      onGuess={(g) => setGuess((m) => (m[p.key] === g ? m : { ...m, [p.key]: g }))}
      onBell={() => noticed(p, BELL_NOTE.what, "", BELL_NOTE.gate)}
      unread={unreadPanes.has(p.key)}
      onPty={(id, account) => {
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
      }}
      account={p.account}
      notice={noticeFor(p)}
      onFailed={(error) => {
        failedPane(p.key, error);
        const then = afterSetup.current[p.key];
        delete afterSetup.current[p.key];
        then?.();
      }}
      // C24-R1-01: the tab could not take its terminal back; it stays, so it is no longer a restore in
      // flight and the loaded latch does not wait on it, and the pane's own notice is the only warning.
      onRestoreFailed={() => {
        restoredKeys.current.delete(p.key);
        startWatch.seen(p.key);
      }}
      onSplit={(dir) => splitPane(p.key, dir)}
      dragCell={!board && showsDragHandle(shown.length) ? { onStart: () => (dragging.current = { cell: groupOf(p) }), onEnd: () => (dragging.current = null, setDropHint(null)) } : undefined}
      onEqualize={terminals && gridCount > 1 ? equalizePanes : undefined}
      onMoveToTab={terminals && gridCount > 1 && moveToTab(panes, p.key) ? () => moveOutToTab(p.key) : undefined}
      expand={board ? undefined : { on: zoomed === groupOf(p), can: canExpand(shown.length, classic), toggle: () => expandPane(p.key) }}
      title={p.title || nameOf(names, p.cwd)}
      custom={!!p.title}
      onRename={(name) => renamePane(p.key, name)}
      renameAsk={askName[p.key]}
      sessionKnown={!!p.session}
      session={p.session}
      onSessionLaunch={(l, fork, forkName) => splitPane(p.key, "right", undefined, { agent: p.agent, agentId: p.agentId, account: p.account, setup: p.setup, env: p.env, program: l.program, args: l.args, forkOf: fork ? p.session : undefined, title: fork ? forkName : undefined })}
      entryTabs={panes.filter((q) => sameDir(q.cwd, activeDir)).map((q) => ({ key: q.key, name: tabName(q, titles, labelOf(q), liveIds) }))}
      onEntry={(t) => (t.kind === "browser" ? openInBrowser(t.url) : t.kind === "file" ? openFile(t.path) : setFocused(t.key))}
      shells={shells}
      onShell={(sh) => void newTab({ shell: sh })} // TERM-043: the plus menu's shell choice, a tab like the New tab menu's // after-list #117: Continue / Fork open a second pane beside this one
      onCopyId={(what) => copyId(p, what)}
      findHandle={findHandle}
      typed={p.typed}
      shellName={p.word}
      number={p.key}
      onClose={() => closePane(p.key)}
      onReviewPlan={showsReview(hook[p.key], turn[p.key]) ? () => setReviewing({ key: p.key, plan: turn[p.key]?.plan ?? "", cut: !!turn[p.key]?.planCut }) : undefined}
      agents={agents}
      defaultId={defaultId}
      onSetDefault={setDefault}
      launching={launching}
      onLaunch={(a) => launch(a, null)}
      onChoose={addChooser}
    />
  );
}
