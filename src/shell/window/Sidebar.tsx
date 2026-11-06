// Cycle 3 (the WindowView split): the left card, moved out of shell/WindowView.tsx as it was: the
// project list (PROJ-063, PROJ-067, PROJ-020), its resize grip (VIEW-050) and the Agents rail
// (VIEW-015, VIEW-021, VIEW-024). The content column beside it is in Content.tsx.
import AgentsRail from "../../agents/AgentsRail";
import { rowStatus } from "../../agents/rail";
import { Grip, LEFT_KEY, LEFT_MAX, LEFT_MIN, clampLeft } from "../../chrome/RightSidebar";
import { allSwitchedOff } from "../../launch/agents";
import { NESTING_KEY } from "../../projects/model";
import ProjectsPanel from "../../projects/ProjectsPanel";
import { openSettings } from "../../settings/pages";
import { toggleSkills } from "../../skills/nav";
import { screenAfterPick, showsProjects } from "./sidebarScreens";
import { useWindow } from "./store";

export default function WindowSidebar() {
  const {
    screen, sidebarOpen, reveal, openDirs, sources, rowStates, unreadDirs,
    markDir, settings, saveSetting, activeDir, select, removed, removedAll, agents, defaultId, setDefault,
    launching, launch, addChooser, newTab, allAgents, agentPass, refreshAgents, page, setPage, refresh,
    createRequest, createName, deleteRequest, renameRequest, setRenameRequest, startIn, projectAdded,
    setScreen, setStandIns, startSetup, setProjects, setOwner, setNames, leftWidth, setDragLeft,
    agentsScreen, groups, selected, saved, classic, chipFor, ringOf, footer, setAgentSel, setFocused, addPreset, closePane,
    workerNames, ptys, wsUnsaved, askWsUnsaved,
  } = useWindow();
  return (
    <>
      {showsProjects(screen) && sidebarOpen && (
        <ProjectsPanel
          reveal={reveal}
          openDirs={openDirs}
          sessions={sources}
          states={rowStates}
          unread={unreadDirs}
          onUnread={markDir}
          settings={settings}
          onSetting={saveSetting}
          activeDir={activeDir}
          onSelect={(dir, branch, fresh) => {
            setScreen(screenAfterPick(screen));
            select(dir, branch, fresh);
          }}
          onRemoved={removed}
          onRemovedAll={removedAll}
          onSleep={removedAll}
          unsavedIn={wsUnsaved}
          onAskUnsaved={askWsUnsaved}
          nest={settings[NESTING_KEY] !== false}
          onNest={(on) => saveSetting(NESTING_KEY, on)}
          agents={agents}
          defaultId={defaultId}
          onSetDefault={setDefault}
          launching={launching}
          onLaunch={launch}
          onChoose={addChooser}
          onTerminal={() => void newTab(null)}
          allOff={allSwitchedOff(allAgents, settings)}
          pass={agentPass}
          onRefresh={refreshAgents}
          page={screen === "terminals" ? page : null}
          onPage={(next) => {
            // C02-R5-01: the page draws only on Terminals, so the row brings that screen up; the
            // toggle is guarded by the screen so a stale page cannot close the one being opened.
            setScreen("terminals");
            setPage((p) => (screen === "terminals" && p === next ? null : next));
          }}
          refresh={refresh}
          createRequest={createRequest}
          createName={createName}
          deleteRequest={deleteRequest}
          renameRequest={renameRequest}
          onRenameTaken={() => setRenameRequest(0)}
          onStartIn={startIn}
          onAdded={projectAdded}
          artifactsOn={screen === "artifacts"}
          onArtifacts={() => setScreen("artifacts")}
          skillsOn={screen === "skills"}
          onSkills={() => toggleSkills(screen, setScreen)}
          onPending={setStandIns}
          onSetup={startSetup}
          onIndex={(list, dirs, typed) => {
            setProjects(list);
            setOwner(dirs);
            setNames(typed);
          }}
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
        />
      )}
    </>
  );
}
