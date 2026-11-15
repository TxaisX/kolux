// Cycle 3 (the WindowView split): the left card, moved out of shell/WindowView.tsx as it was: the
// project list (PROJ-063, PROJ-067, PROJ-020), its resize grip (VIEW-050) and the Agents rail
// (VIEW-015, VIEW-021, VIEW-024). The content column beside it is in Content.tsx.
import AgentsRail from "../../agents/AgentsRail";
import { rowStatus, shellNote } from "../../agents/rail";
import { Grip, LEFT_KEY, LEFT_MAX, LEFT_MIN, clampLeft } from "../../chrome/RightSidebar";
import { allSwitchedOff } from "../../launch/agents";
import { NESTING_KEY } from "../../projects/model";
// PKG-2: the project list behind its render comparison (ProjectsMemo.tsx).
import ProjectsPanel from "./ProjectsMemo";
import { openSettings } from "../../settings/pages";
import { toggleSkills } from "../../skills/nav";
import { screenAfterPick, showsProjects } from "./sidebarScreens";
import { useDeeds, useWindow } from "./store";
import { useStableFns } from "./stable";
import { useMemo } from "react";
import { gridOf } from "../../workspaces";
import { setStartDir } from "../../projects/worktreeGrid";
import type { Page } from "../../projects/ProjectsPanel";
import type { Project } from "../../projects/model";

export default function WindowSidebar() {
  const {
    screen, sidebarOpen, reveal, openDirs, sources, rowStates, unreadDirs,
    settings, saveSetting, activeDir, workDir, select, agents, defaultId,
    launching, addChooser, newTab, allAgents, agentPass, page, setPage, refresh,
    createRequest, createName, deleteRequest, renameRequest, setRenameRequest,
    setScreen, setProjects, setOwner, setNames, leftWidth, setDragLeft,
    agentsScreen, groups, selected, saved, classic, chipFor, ringOf, footer, setAgentSel, setFocused, addPreset, closePane,
    workerNames, ptys, panes, dirty, openPane, worktreeMenu,
  } = useWindow();
  // PKG-2: the project list skips a render when nothing it shows changed (projectsProps.ts). What it runs from its
  // handlers and effects keeps one identity: the window's deeds (store.tsx), and the closures below as callers that
  // run this render's version (stable.ts useStableFns).
  const deeds = useDeeds();
  const act = useStableFns({
    // The worktree menu's session items: where new sessions of the project open (its main checkout unless a worktree is picked), and a new session there now.
    worktreeSession: (path: string, what: "new" | "start") => {
      const root = gridOf(path);
      if (root === null) return;
      setStartDir(root, path);
      if (what === "new") addChooser();
    },
    select: (dir: string, branch: string | null, fresh?: boolean) => {
      setScreen(screenAfterPick(screen));
      select(dir, branch, fresh);
    },
    nest: (on: boolean) => saveSetting(NESTING_KEY, on),
    terminal: () => void newTab(null),
    page: (next: Page) => {
      // C02-R5-01: the page draws only on Terminals, so the row brings that screen up; the
      // toggle is guarded by the screen so a stale page cannot close the one being opened.
      setScreen("terminals");
      setPage((p) => (screen === "terminals" && p === next ? null : next));
    },
    renameTaken: () => setRenameRequest(0),
    // A session row opens its folder's grid and focuses that pane (paneActions.openPane).
    focusPane: (key: number) => openPane(key),
    artifacts: () => setScreen("artifacts"),
    skills: () => toggleSkills(screen, setScreen),
    index: (list: Project[], dirs: Record<string, string>, typed: Record<string, string>) => {
      setProjects(list);
      setOwner(dirs);
      setNames(typed);
    },
  });
  // EDIT-031: the list calls this while it draws (the delete question names the unsaved files). It reads the panes
  // and their unsaved marks (App.tsx wsUnsaved), so its identity follows them and the list draws again when they change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unsavedIn = useMemo(() => (paths: string[]) => deeds.wsUnsaved(paths), [panes, dirty, deeds]);
  return (
    <>
      {showsProjects(screen) && sidebarOpen && (
        <ProjectsPanel
          reveal={reveal}
          openDirs={openDirs}
          sessions={sources}
          states={rowStates}
          unread={unreadDirs}
          onUnread={deeds.markDir}
          settings={settings}
          onSetting={deeds.saveSetting}
          activeDir={activeDir}
          workDir={workDir}
          onSelect={act.select}
          onFocusPane={act.focusPane}
          onRemoved={deeds.removed}
          onRemovedAll={deeds.removedAll}
          onSleep={deeds.removedAll}
          unsavedIn={unsavedIn}
          onAskUnsaved={deeds.askWsUnsaved}
          nest={settings[NESTING_KEY] !== false}
          onNest={act.nest}
          agents={agents}
          defaultId={defaultId}
          onSetDefault={deeds.setDefault}
          launching={launching}
          onLaunch={deeds.launch}
          onChoose={deeds.addChooser}
          onTerminal={act.terminal}
          onReview={deeds.openChangesIn}
          allOff={allSwitchedOff(allAgents, settings)}
          pass={agentPass}
          onRefresh={deeds.refreshAgents}
          page={screen === "terminals" ? page : null}
          onPage={act.page}
          refresh={refresh}
          createRequest={createRequest}
          worktreeRequest={worktreeMenu}
          onWorktreeSession={act.worktreeSession}
          createName={createName}
          deleteRequest={deleteRequest}
          renameRequest={renameRequest}
          onRenameTaken={act.renameTaken}
          onStartIn={deeds.startIn}
          onAdded={deeds.projectAdded}
          artifactsOn={screen === "artifacts"}
          onArtifacts={act.artifacts}
          skillsOn={screen === "skills"}
          onSkills={act.skills}
          onPending={deeds.setStandIns}
          onSetup={deeds.startSetup}
          onIndex={act.index}
        />
      )}
      {showsProjects(screen) && sidebarOpen && (
        <Grip side="left" width={leftWidth} min={LEFT_MIN} max={LEFT_MAX} label="Resize the sidebar" className="lside-grip" onWidth={(w, done) => {
          setDragLeft(done ? null : clampLeft(w));
          if (done) saveSetting(LEFT_KEY, clampLeft(w));
        }} />
      )}
      {agentsScreen && (
        <AgentsRail
          groups={groups}
          selected={selected}
          classic={classic}
          statusOf={(p) => rowStatus(p, chipFor(p))}
          ringOf={ringOf}
          footer={footer}
          onSelect={(key) => {
            setAgentSel(key);
            setFocused(key);
          }}
          onAdd={addPreset}
          onDrop={closePane}
          onSettings={() => openSettings("agents")}
          hasAgents={saved.length > 0}
          onNew={addChooser}
          taskOf={(k) => workerNames[`term-${ptys.current[k]}`]}
          shells={shellNote(panes)}
          onTerminals={() => setScreen("terminals")}
        />
      )}
    </>
  );
}
