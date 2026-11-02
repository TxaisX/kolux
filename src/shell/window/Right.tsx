// Cycle 3 (the WindowView split): the right sidebar, moved out of shell/WindowView.tsx as it was: the
// panel frame and its width (VIEW-056), Source Control with its draft, notes and agent hand-over
// (GIT-004, GIT-012, VIEW-073), the past-sessions tab (VIEW-080), the attached-worktrees and checks
// tabs, the Continue / Fix / Start host (T-187-b, T-189-b) and the Explorer (EDIT-033).
import { invoke } from "@tauri-apps/api/core";
import RightSidebar, { RIGHT_KEYS, clampWidth } from "../../chrome/RightSidebar";
import { clearDelivered } from "../../editor/diffNotes";
import { noteTarget } from "../../editor/fileNotes";
import { menuAgents } from "../../launch/agents";
import { AttachedWorktreesTab, FolderChecksTab } from "../../projects/AttachedTabs.tsx";
import { type Created, type Project } from "../../projects/model";
import { applySettings } from "../../projects/settingWrite";
import { writerOf } from "../../scm/generate";
import { SCM_AGENT_KEY, SCM_GROUP_ORDER_KEY, SCM_LINKED_PR_KEY, SCM_VIEW_KEY, SUMMARY_UPSTREAM_KEY, linkedPrs, withLink } from "../../scm/model";
import { aiControlsShown } from "../../scm/rules";
import { DIFF_SPLIT_KEY, diffSplitOf } from "../../scm/split";
import { FOLDER_TAB_KEY, rememberTab } from "../../sessions/folderTabs";
import { saveChanged } from "../../settings/saveChanged";
import { panesIn } from "../../workspaces";
import { useWindow } from "./store";
import { AgentsPanel } from "../../lazy/pages";
import { Explorer } from "../../lazy/pages";
import { AddProjectRow } from "../../lazy/pages";
import { SourceControlPanel } from "../../lazy/pages";
import { ChecksPanel } from "../../lazy/pages";
import { LineNotes } from "../../lazy/pages";
import { AgentStartHost } from "../../lazy/pages";

export default function WindowRight() {
  const {
    right, dragWidth, setDragWidth, sidebarOpen, leftWidth, terminals, fullPage, offeredRight, settings,
    settingsRef, setSettings, setNotice, saveRight, scmOpen, activeDir, drafts, setDrafts, fixWithAI, projects,
    projectOf, setProjects, openDiff, newTab, notesFor, repoless, openFile, dropNotes, saveNotes, setScreen,
    select, defaultId, openIn, panes, startIn, agents, classic, resumeOrFocus, resumeIn, wsKind, cli,
    runSetup, setRefresh, explorerOpen, explorerFocus, openTerminalIn, showRight, owner, saveSetting, shells, sendNotes,
    setActiveDir, setToast, openCheck,
  } = useWindow();
  return (
    <RightSidebar tab={right.tab} width={clampWidth(dragWidth ?? right.width, window.innerWidth, sidebarOpen ? leftWidth + 8 : 0)} hidden={!terminals || !right.open || fullPage} offered={offeredRight} onTab={(tab) => {
      const patch: Record<string, unknown> = { [RIGHT_KEYS.tab]: tab };
      if (wsKind.folder && activeDir !== null) patch[FOLDER_TAB_KEY] = rememberTab(settingsRef.current[FOLDER_TAB_KEY], activeDir, tab);
      const { was, next } = applySettings(settingsRef, patch);
      setSettings(next);
      saveChanged(was, next).catch((err) => setNotice(String(err)));
    }} onWidth={(w, done) => {
      const used = clampWidth(w, window.innerWidth, sidebarOpen ? leftWidth + 8 : 0);
      setDragWidth(done ? null : used);
      if (done) saveRight({ width: used });
    }}>
      {scmOpen && (
        <SourceControlPanel dir={activeDir} writer={writerOf(settings)} draft={activeDir === null ? "" : (drafts[activeDir] ?? "")} onDraft={(text, dir) => (dir ?? activeDir) !== null && setDrafts((d) => ({ ...d, [dir ?? activeDir!]: text }))} onClose={() => saveRight({ open: false })} onFix={fixWithAI} aiShown={aiControlsShown(settings)} pinnedBase={projects.find((p) => p.id === projectOf(activeDir))?.base ?? null} onChangeBase={(base) => {
          const p = projects.find((x) => x.id === projectOf(activeDir));
          if (p) void invoke<Project>("project_set", { projectId: p.id, workspacesDir: p.workspacesDir ?? "", base }).then((u) => setProjects((ps) => ps.map((x) => (x.id === u.id ? u : x))));
        }} againstUpstream={settings[SUMMARY_UPSTREAM_KEY] === true} groupOrder={settings[SCM_GROUP_ORDER_KEY]} view={settings[SCM_VIEW_KEY] === "tree" ? "tree" : "list"} onView={(v) => saveSetting(SCM_VIEW_KEY, v)} onOpenDiff={(path, staged) => activeDir !== null && openDiff(`${activeDir.replace(/[\\/]+$/, "")}/${path}`, staged, true)} onAllChanges={() => void newTab("changes")} diffSplit={diffSplitOf(settings[DIFF_SPLIT_KEY])} onDiffSplit={(v) => saveSetting(DIFF_SPLIT_KEY, v)} notesSection={activeDir !== null && <LineNotes dir={activeDir} notes={notesFor(activeDir)} repoless={repoless} onOpen={(n) => (noteTarget(repoless) === "file" ? openFile(n.path, n.end ?? n.line) : openDiff(n.path, n.staged, true, n.end ?? n.line, n.side))} onDrop={(ids) => dropNotes(activeDir, ids)} onClearSent={() => saveNotes(activeDir, clearDelivered(notesFor(activeDir)))} onSend={() => sendNotes(activeDir)} />} onAgainstUpstream={(on) => saveSetting(SUMMARY_UPSTREAM_KEY, on)} fixAgent={settings[SCM_AGENT_KEY]} onFixAgent={(id) => saveSetting(SCM_AGENT_KEY, id)} linkedPr={activeDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[activeDir] ?? null)} onLinkPr={(url) => activeDir !== null && saveSetting(SCM_LINKED_PR_KEY, withLink(linkedPrs(settings[SCM_LINKED_PR_KEY]), activeDir, url))} onAgentAction={async (a, prompt) => {
          if (activeDir === null) return "Open a workspace first.";
          try {
            await openIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true);
            return null;
          } catch (err) {
            return `${a.name} did not start, so the conflicts were not handed over: ${String(err)}`;
          }
        }} agents={menuAgents(agents, defaultId)} onHand={(a, note) => activeDir !== null && void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, note, true)} />
      )}
      {/* VIEW-080 (T-168, T-169): the Agents tab lists past sessions of every agent in the saved scope. */}
      {right.open && right.tab === "agents" && (
        <AgentsPanel settings={settings} onSave={saveSetting} activeDir={activeDir} projects={projects} projectDirs={Object.entries(owner).filter(([, p]) => p === projectOf(activeDir)).map(([d]) => d)} rescanKey={panes.length} visible={terminals} shell={shells[0]?.program ?? null} onResume={(s, plan) => void resumeOrFocus(s, plan)} onResumeChat={(s, plan) => void resumeIn(s.agent, plan).then((ok) => ok && setScreen(classic ? "terminals" : "agents"))} openDirs={[...new Set(panes.map((p) => p.cwd).filter((d): d is string => d !== null))]} onJump={(d) => setActiveDir(d)} />
      )}
      {right.open && right.tab === "attached" && activeDir !== null && <AttachedWorktreesTab folder={activeDir} worktrees={wsKind.worktrees} onOpen={(path) => { setScreen("terminals"); select(path, null); }} />}
      {right.open && right.tab === "prchecks" && activeDir !== null && <FolderChecksTab folder={activeDir} worktrees={wsKind.worktrees} />}
      {/* VIEW-073: the Checks tab follows the workspace of the focused terminal. */}
      {right.open && right.tab === "checks" && <ChecksPanel dir={activeDir} linked={activeDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[activeDir] ?? null)} visible={terminals} onOpenCheck={openCheck} />}
      {/* T-187-b / T-189-b: the dialog and helpers behind "Continue with…", "Fix with an agent" and "Start with an agent". */}
      <AgentStartHost
        agents={agents}
        defaultId={defaultId}
        saved={settings[SCM_AGENT_KEY]}
        workspace={activeDir}
        notify={(text, failed) => (failed ? setNotice(text) : setToast(text))}
        launch={async (id, dir, prompt, extra) => {
          const a = agents.find((x) => x.id === id);
          if (!a) throw new Error(`${id} is not installed here.`);
          await openIn(a, dir, panesIn(panes, dir)[0]?.branch ?? null, prompt, true, extra);
          return { handed: true };
        }}
        makeWorkspace={async (item) => {
          const made = await invoke<Created>("workspace_from_item", { item });
          setRefresh((n) => n + 1);
          cli.current.select(made.path, made.branch, true);
          void runSetup(made.path, made.branch);
          return made;
        }}
      />
      {activeDir ? <Explorer key={activeDir} root={activeDir} hidden={!explorerOpen} focusAsk={explorerFocus} onOpen={openFile} onClose={() => saveRight({ open: false })} onOpenTerminal={openTerminalIn} onWake={() => showRight("explorer")} /> : explorerOpen && <AddProjectRow />}
    </RightSidebar>
  );
}
