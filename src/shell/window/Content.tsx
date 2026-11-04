// Cycle 3 (the WindowView split): the content column, moved out of shell/WindowView.tsx as it was:
// the New session sheet (SESS-018), the window notices, the plan sheet (SAFE-002..007), the pages over
// the grid (VIEW-011, DT-17), the layout strip and the file pickers (EDIT-027, EDIT-036), the screens
// (artifacts, skills, inbox, agents, tower, floor, space), the empty states, the needs strip and the
// stand-ins (PROJ-020), then the grid itself (Grid.tsx).
import { invoke } from "@tauri-apps/api/core";
import ScreenBoundary from "../../recovery/ScreenBoundary";
import type { Pane } from "../../App";
import { cardPanes } from "../../agents/rail";
import { AgentsChat } from "../../lazy/pages";
import { linksOpenInKolux } from "../../chat/chatLinks";
import LayoutStrip from "../../chrome/LayoutStrip";
import { StatusGlyph, Spinner } from "../../chrome/icons";
import { openInBrowser } from "../../browser/openIn";
import FilePicker, { quickOpenList, type Pick } from "../../editor/FilePicker";
import { inboxItems } from "../../inbox/inbox";
import type { Seat } from "../../launch/seats";
import { folderName, projectLabel } from "../../projects/model";
import { closeSkills } from "../../skills/nav";
import { tasksRepo } from "../../tasks/model";
import { draftKey, keepDraft, stillPending } from "../../terminal/planReview";
import { VOCAB } from "../../terminal/status";
import { tabName } from "../../terminal/tabName";
import { towerRows } from "../../tower/tower";
import { nameOf } from "../../workspaces";
import Grid from "./Grid";
import Notices from "./Notices";
import SeatChooser from "./SeatChooser";
import { useWindow } from "./store";
import { PlanSheet } from "../../lazy/pages";
import { RoutingPage } from "../../lazy/pages";
import { SignInNotice } from "../../lazy/pages";
import { KeyLostNotice } from "../../lazy/pages";
import { TasksPage } from "../../lazy/pages";
import { AutomationsPage } from "../../lazy/pages";
import { SkillsPage } from "../../lazy/pages";
import { ArtifactsPage } from "../../lazy/pages";
import { SpaceView } from "../../lazy/pages";
import { FloorView } from "../../lazy/pages";
import { InboxView } from "../../lazy/pages";
import { TemplatePicker } from "../../lazy/pages";
import { RecoveryMount } from "../../lazy/pages";
import { ToolNotices } from "../../lazy/pages";
import { PreviewButton } from "../../lazy/pages";
import { TowerView } from "../../lazy/pages";

export default function WindowContent() {
  const {
    sheet, projects, projectOf, projectFor, setSheet, terminals, reviewPane, reviewing, names, titles, hook,
    turn, planDrafts, setPlanDrafts, approvePlan, requestChanges, setReviewing, page, setPage, runPane, openPane,
    select, agents, settings, savePageSettings, activeDir, fromItem, cli, shown, setCount, shells, newTab,
    setFocused, picking, openFile, setToast, setPicking, openDiff, toast, notice, keymapNotice, setNotice,
    screen, setScreen, inbox, inboxSeen, now, reviewChanges, panes, selected,
    focused, ptys, hookRef, setAgentSel, tower, towerSeats, towerUsage, floor, space, waiting, statusOf,
    standIns, saved, board, agentsScreen, openDirs, workerNames,
  } = useWindow();
  return (
    <div className="content">
      {sheet?.seats && (
        <div className="sheet-wrap">
          {(() => {
            const proj = projects.find((x) => x.id === (projectOf(sheet.cwd) ?? projectFor(null)));
            return <SeatChooser pane={sheet as Pane & { seats: Seat[] }} hidden={false} focused onFocus={() => {}} onClose={() => setSheet(null)} sheetOf={{ project: proj?.name ?? "No project", path: sheet.cwd ?? proj?.path ?? "Home folder" }} />;
          })()}
        </div>
      )}
      <Notices toast={toast} notice={notice} keymapNotice={keymapNotice} onDismiss={() => setNotice(null)} />
      <SignInNotice />
      <KeyLostNotice />
      <RecoveryMount />
      {terminals && page === null && <ToolNotices projects={projects.map((p) => p.id).join(",")} />}
      {terminals && reviewPane && reviewing && (
        <PlanSheet
          title={nameOf(names, reviewPane.cwd) ?? (reviewPane.cwd ? folderName(reviewPane.cwd) : tabName(reviewPane, titles))}
          plan={reviewing.plan}
          cut={reviewing.cut}
          closed={!reviewing.send && !stillPending(hook[reviewPane.key], turn[reviewPane.key], reviewing.plan)}
          sending={!!reviewing.send}
          onCancel={() => reviewing.send?.cancel()}
          draft={planDrafts[draftKey(reviewPane.key, reviewing.plan)] ?? { comments: [], note: "" }}
          onDraft={(d) => setPlanDrafts((m) => keepDraft(m, draftKey(reviewPane.key, reviewing.plan), d))}
          onApprove={() => approvePlan(reviewPane, reviewing.plan)}
          onRequest={() => void requestChanges(reviewPane, reviewing.plan)}
          onClose={() => setReviewing(null)}
        />
      )}
      {terminals && page === "automations" && (
        <AutomationsPage
          onClose={() => setPage(null)}
          liveRun={(r) => !!runPane(r)}
          onViewRun={(r) => {
            const p = runPane(r);
            if (!p) return;
            setPage(null);
            openPane(p.key);
          }}
          onResume={(r) => r.worktree && select(r.worktree, null)}
          projects={projects}
          agents={agents}
          settings={settings}
          onSettings={(built) => savePageSettings(settings, built)}
        />
      )}
      {terminals && page === "tasks" && <TasksPage repo={tasksRepo(projects, activeDir)} onStart={fromItem} onResume={(dir) => cli.current.select(dir, null, true)} />}
      {terminals && page === "routing" && (
        <RoutingPage
          agents={agents}
          settings={settings}
          onSettings={(built) => savePageSettings(settings, built)}
        />
      )}
      {terminals && (
        <>
          {page === null && <LayoutStrip count={shown.length} onLayout={setCount} agents={agents.filter((a) => a.installed)} shells={shells} onNewTab={(a) => void newTab(a)} preview={<PreviewButton dir={activeDir} onFocus={setFocused} />} />}
          {picking === "file" && activeDir && (
            <FilePicker
              root={activeDir}
              what="file"
              load={() => invoke<{ files: string[]; capped: boolean; source: string; rgMissing: boolean }>("file_list", { root: activeDir }).then((l) => quickOpenList(activeDir, l))}
              onPick={(f) => openFile(f.path)}
              onClose={() => setPicking(null)}
            />
          )}
          {picking === "template" && activeDir && <TemplatePicker root={activeDir} onOpen={openFile} onError={(m) => setToast(m)} onClose={() => setPicking(null)} />}
          {picking === "markdown" && activeDir && (
            <FilePicker
              root={activeDir}
              what="markdown file"
              load={() => invoke<{ files: string[]; capped: boolean }>("md_list", { root: activeDir }).then((n) => ({ items: n.files.map((path) => ({ path })), capped: n.capped }))}
              onPick={(f) => openFile(f.path)}
              onClose={() => setPicking(null)}
            />
          )}
          {picking === "change" && activeDir && (
            <FilePicker
              root={activeDir}
              what="changed file"
              load={() => invoke<{ path: string; staged: boolean; code: string }[]>("git_changes", { root: activeDir }).then((cs) => ({ items: cs.map((c): Pick => ({ path: c.path, staged: c.staged, tag: c.staged ? "Staged" : c.code === "?" ? "Untracked" : "Unstaged" })), capped: false }))}
              onPick={(f) => openDiff(f.path, !!f.staged)}
              onClose={() => setPicking(null)}
            />
          )}
        </>
      )}
      {/* UX lane A (shell.md row 6): a screen that fails to draw shows Try again here instead of taking the whole window down; a new screen starts clean. A screen whose code failed to load stays failed until Reload (lazy() keeps the failed load). */}
      <ScreenBoundary key={screen}>
      {screen === "artifacts" && <ArtifactsPage onToast={setToast} onClose={() => setScreen("terminals")} />}
      {screen === "skills" && <SkillsPage workspace={activeDir} onClose={() => closeSkills(setScreen)} />}
      {inbox && <InboxView items={inboxItems(inboxSeen.sources, now)} now={now} onOpen={openPane} onReview={reviewChanges} />}
      {screen === "agents" && <AgentsChat open={{ onOpenFile: (path, line, column) => openFile(path, line, column), onOpenLink: openInBrowser, inKolux: linksOpenInKolux(settings), onReview: (k, plan, cut) => setReviewing({ key: k, plan, cut }) }} taskOf={(k) => workerNames[`term-${ptys.current[k]}`]} panes={panes.filter((p) => !p.kind && !p.seats).map((p) => ({ key: p.key, cwd: p.cwd, title: p.title, program: p.program }))} focused={selected ?? focused} ptyOf={(k) => ptys.current[k]} hook={hook} stateOf={(k) => hookRef.current[k]} onPick={(key) => {
        setAgentSel(key);
        setFocused(key);
      }} />}
      {tower && <TowerView rows={towerRows(towerSeats)} usage={towerUsage} now={now} onOpen={openPane} />}
      {floor && <FloorView onOpen={openPane} />}
      {space && <SpaceView projectId={projectFor(projectOf(activeDir))} projectName={(() => { const p = projects.find((x) => x.id === projectFor(projectOf(activeDir))); return p ? projectLabel(p) : ""; })()} openDirs={openDirs} />}
      </ScreenBoundary>
      {agentsScreen && selected === null && (
        <div className="empty">
          <h2>Agents</h2>
          <p>{saved.length ? "No session yet. Add one with + under an agent." : "No agents yet."}</p>
        </div>
      )}
      {board && cardPanes(panes).length === 0 && (
        <div className="empty">
          <h2>Board</h2>
          <p>No session yet.</p>
        </div>
      )}
      {terminals && page === null && waiting.length > 0 && (
        <div className="needs-strip" role="group" aria-label="Sessions that need you">
          {waiting.map((p) => (
            <button key={p.key} className="needs-chip" onClick={() => openPane(p.key)} title={VOCAB[statusOf(p)!].explain}>
              <StatusGlyph glyph="attention" size={11} />
              <span className="name">{tabName(p, titles)}</span>
              <span className="why">{statusOf(p) === "permission" ? "needs permission" : "asked a question"}</span>
            </button>
          ))}
        </div>
      )}
      {terminals && page === null && standIns.length > 0 && (
        // PROJ-020: a stand-in tab for each workspace Git is still making; it gives way to
        // the workspace's own tabs once it opens, and never pulls focus.
        <div className="tabs standins" role="tablist" aria-label="Workspaces being created">
          {standIns.map((c) => (
            <div key={c.ticket} role="tab" aria-selected={false} aria-busy="true" className="tab standin" data-standin={c.name} title={`Git is making ${c.name}; it opens when it is ready`}>
              <Spinner size={12} />
              <span className="tab-name">{c.name}</span>
              <span className="hint">creating…</span>
            </div>
          ))}
        </div>
      )}
      <Grid />
    </div>
  );
}
