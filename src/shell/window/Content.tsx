// Cycle 3 (the WindowView split): the content column, moved out of shell/WindowView.tsx as it was:
// the New session sheet (SESS-018), the window notices, the plan sheet (SAFE-002..007), the pages over
// the grid (VIEW-011, DT-17), the layout strip, the screens
// (inbox, tower, floor, space), the empty states, the needs strip and the
// stand-ins (PROJ-020), then the grid itself (Grid.tsx).
import ScreenBoundary from "../../recovery/ScreenBoundary";
import { cardPanes } from "../../agents/rail";
import LayoutStrip from "../../chrome/LayoutStrip";
import { StatusGlyph, Spinner } from "../../chrome/icons";
import { inboxItems } from "../../inbox/inbox";
import type { Seat } from "../../launch/seats";
import type { StartSheet } from "../../launch/startForm";
import { folderName, projectLabel } from "../../projects/model";
import { tasksRepo } from "../../tasks/model";
import { draftKey, keepDraft, stillPending } from "../../terminal/planReview";
import { VOCAB } from "../../terminal/status";
import { tabName } from "../../terminal/tabName";
import { towerRows } from "../../tower/tower";
import { nameOf } from "../../workspaces";
import Grid from "./Grid";
import Notices from "./Notices";
import SeatChooser from "./SeatChooser";
import { ownPanes, useStartAsk } from "../useStartAsk";
import { useWindow } from "./store";
import { PlanSheet } from "../../lazy/pages";
import { SignInNotice } from "../../lazy/pages";
import { KeyLostNotice } from "../../lazy/pages";
import { TasksPage } from "../../lazy/pages";
import { SpaceView } from "../../lazy/pages";
import { FloorView } from "../../lazy/pages";
import { InboxView } from "../../lazy/pages";
import { RecoveryMount } from "../../lazy/pages";
import { ToolNotices } from "../../lazy/pages";
import { TowerView } from "../../lazy/pages";

/** Job 68: the close the ask at open hands useStartAsk: it drops only the form the ask opened, never one opened by hand. */
export const dropAtOpen = (s: StartSheet | null): StartSheet | null => (s?.atOpen ? null : s);

export default function WindowContent() {
  const {
    sheet, projects, projectOf, projectFor, setSheet, terminals, reviewPane, reviewing, names, titles, hook, turn, planDrafts, setPlanDrafts, approvePlan, requestChanges, setReviewing, page, openPane, settings, activeDir, fromItem, cli, shown, setCount, toast, notice, keymapNotice, setNotice, screen, inbox, inboxSeen, now, panes, tower, towerSeats, towerUsage, floor, space, waiting, statusOf, standIns, board, openDirs, addChooser, settingsRead, agentPass, launching, openStart, wizard, projectsRead, wizardKnown, layoutIn,
  } = useWindow();
  // Start form D: asked once when Kolux starts, in the main window, in front of what was restored.
  useStartAsk({ settings, settingsRead, layoutIn, agentsDone: agentPass.done, projectsRead, launching, sheetOpen: !!sheet, firstRun: wizard !== null, firstRunKnown: wizardKnown, agentsFailed: agentPass.error !== null && !agentPass.done, panes: ownPanes(panes), open: () => openStart({ atOpen: true }), close: () => setSheet(dropAtOpen) });
  return (
    <div className="content">
      {sheet?.seats && (
        <div className="sheet-wrap">
          {(() => {
            const proj = projects.find((x) => x.id === (projectOf(sheet.cwd) ?? projectFor(null)));
            // Start form C: the header names the ticked folders; one folder keeps its path under the name.
            const ticked = (sheet.folders ?? []).map((id) => projects.find((x) => x.id === id)).filter((x) => !!x);
            const head = ticked.length > 1 ? { project: ticked.map((x) => x.name).join(", "), path: `${ticked.length} folders` } : ticked.length === 1 ? { project: ticked[0].name, path: ticked[0].path } : { project: proj?.name ?? "No project", path: sheet.cwd ?? proj?.path ?? "Home folder" };
            return <SeatChooser pane={sheet as StartSheet & { seats: Seat[] }} hidden={false} focused onFocus={() => {}} onClose={() => setSheet(null)} sheetOf={head} />;
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
      {terminals && page === "tasks" && <TasksPage repo={tasksRepo(projects, activeDir)} onStart={fromItem} onResume={(dir) => cli.current.select(dir, null, true)} />}
      {terminals && (
        <>
          {page === null && <LayoutStrip count={shown.length} onLayout={setCount} workspace={activeDir} />}
        </>
      )}
      {/* UX lane A (shell.md row 6): a screen that fails to draw shows Try again here instead of taking the whole window down; a new screen starts clean. A screen whose code failed to load stays failed until Reload (lazy() keeps the failed load). */}
      <ScreenBoundary key={screen}>
      {inbox && <InboxView items={inboxItems(inboxSeen.sources, now)} now={now} onOpen={openPane} />}
      {tower && <TowerView rows={towerRows(towerSeats)} usage={towerUsage} now={now} onOpen={openPane} />}
      {floor && <FloorView onOpen={openPane} />}
      {space && <SpaceView projectId={projectFor(projectOf(activeDir))} projectName={(() => { const p = projects.find((x) => x.id === projectFor(projectOf(activeDir))); return p ? projectLabel(p) : ""; })()} openDirs={openDirs} />}
      </ScreenBoundary>
      {board && cardPanes(panes).length === 0 && (
        <div className="empty">
          <h2>Board</h2>
          <p>No session yet.</p>
          <div className="btn-row">
            <button className="btn" onClick={addChooser}>Start agents</button>
          </div>
        </div>
      )}
      {terminals && page === null && waiting.length > 0 && (
        <div className="needs-strip" role="group" aria-label="Sessions that need you">
          {waiting.map((p) => (
            <button key={p.key} className="needs-chip" onClick={() => openPane(p.key)} title={VOCAB[statusOf(p)!].explain}>
              <StatusGlyph glyph="attention" size={11} />
              <span className="name">{tabName(p, titles)}</span>
              <span className="why">{statusOf(p) === "permission" ? "wants a yes or no" : "asked a question"}</span>
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
