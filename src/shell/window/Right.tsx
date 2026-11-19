// Cycle 3 (the WindowView split): the right sidebar, moved out of shell/WindowView.tsx as it was: the
// panel frame and its width (VIEW-056), the Insights tab (T-646: tokens, estimated cost and what every
// session is doing, app-wide; it replaced Source Control, T-644), the past-sessions tab (VIEW-080), the
// attached-worktrees and checks tabs.
import RightSidebar, { RIGHT_KEYS, clampWidth } from "../../chrome/RightSidebar";
import { liveSessions } from "../../insights/model";
import { AttachedWorktreesTab, FolderChecksTab } from "../../projects/AttachedTabs.tsx";
import { applySettings } from "../../projects/settingWrite";
import { SCM_LINKED_PR_KEY, linkedPrs } from "../../scm/model";
import { FOLDER_TAB_KEY, rememberTab } from "../../sessions/folderTabs";
import { openSessions } from "../../sessions/openPanes";
import { saveChanged } from "../../settings/saveChanged";
import { useWindow } from "./store";
import { AgentsPanel } from "../../lazy/pages";
import { ChecksPanel } from "../../lazy/pages";
import { InsightsPanel } from "../../lazy/pages";


export default function WindowRight() {
  const {
    right, dragWidth, setDragWidth, sidebarOpen, leftWidth, terminals, fullPage, offeredRight, settings,
    settingsRef, setSettings, setNotice, saveRight, activeDir, workDir, projects,
    projectOf, setScreen,
    select, panes, resumeOrFocus, resumeIn, wsKind,
    owner, saveSetting, shells,
    setActiveDir, openCheck, openPane, agentOf, statusOf, turn, stamp, running, stale,
  } = useWindow();
  const fit = (w: number) => clampWidth(w, window.innerWidth, sidebarOpen ? leftWidth + 8 : 0);
  return (
    <RightSidebar tab={right.tab} width={fit(dragWidth ?? right.width)} max={fit(1e4)} hidden={!terminals || !right.open || fullPage} offered={offeredRight} onTab={(tab) => {
      const patch: Record<string, unknown> = { [RIGHT_KEYS.tab]: tab };
      if (wsKind.folder && activeDir !== null) patch[FOLDER_TAB_KEY] = rememberTab(settingsRef.current[FOLDER_TAB_KEY], activeDir, tab);
      const { was, next } = applySettings(settingsRef, patch);
      setSettings(next);
      saveChanged(was, next).catch((err) => setNotice(String(err)));
    }} onWidth={(w, done) => {
      const used = fit(w);
      setDragWidth(done ? null : used);
      if (done) saveRight({ width: used });
    }}>
      {/* T-646: the Insights tab is app-wide: tokens, estimated cost and what every open agent session is doing (T-644 took Source Control out of this sidebar). */}
      {right.open && right.tab === "insights" && <InsightsPanel sessions={liveSessions(panes, agentOf, statusOf, turn, stamp, running, stale)} onJump={openPane} />}
      {/* VIEW-080 (T-168, T-169): the Agents tab lists past sessions of every agent in the saved scope. */}
      {right.open && right.tab === "agents" && (
        <AgentsPanel settings={settings} onSave={saveSetting} activeDir={activeDir} projects={projects} projectDirs={Object.entries(owner).filter(([, p]) => p === projectOf(activeDir)).map(([d]) => d)} rescanKey={panes.length} visible={terminals && !fullPage} shell={shells[0]?.program ?? null} onResume={(s, plan) => resumeOrFocus(s, plan)} onResumeChat={(s, plan) => void resumeIn(s.agent, plan, s.id).then((ok) => ok && setScreen("terminals"))} openDirs={[...new Set(panes.map((p) => p.cwd).filter((d): d is string => d !== null))]} onJump={(d) => setActiveDir(d)} openPanes={openSessions(panes)} />
      )}
      {right.open && right.tab === "attached" && activeDir !== null && <AttachedWorktreesTab folder={activeDir} worktrees={wsKind.worktrees} onOpen={(path) => { setScreen("terminals"); select(path, null); }} />}
      {right.open && right.tab === "prchecks" && activeDir !== null && <FolderChecksTab folder={activeDir} worktrees={wsKind.worktrees} />}
      {/* VIEW-073: the Checks tab follows the workspace of the focused terminal. */}
      {right.open && right.tab === "checks" && <ChecksPanel dir={workDir} linked={workDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[workDir] ?? null)} visible={terminals && !fullPage} onOpenCheck={openCheck} />}
    </RightSidebar>
  );
}
