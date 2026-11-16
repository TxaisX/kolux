// Cycle 3 (the WindowView split): the window-wide hosts, moved out of shell/WindowView.tsx as they
// were: the guides and the first-run wizard (ONB), the updater (APP-058..060), the skills bar and its
// notice, Feedback, the Review changes sheet (GIT-042), the status bar (STAT-024, STAT-050) and the
// Edit menu. They sit after the body, as they did.
import { useEffect } from "react";
import StatusBar from "../../chrome/StatusBar";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "../../chrome/statusItems";
import EditMenuHost from "../../editmenu/EditMenuHost";
import { plainNote } from "../../editor/fileNotes";
import { asksAtStart } from "../../launch/startForm";
import { reviewOn, startChoices } from "../../editor/notes";
import { hooksOn } from "../../onboarding/hooksOn";
import type { KindKey } from "../../settings/notifications";
import { BringSkillsUp } from "../../skills/SkillBarItem";
import { toggleSkills } from "../../skills/nav";
import { windowLoaded } from "../../status/manage";
import { tabName } from "../../terminal/tabName";
import { sameDir } from "../../workspaces";
import { ownPanes } from "../useStartAsk";
import { useWindow } from "./store";
import { addFolderHands } from "./sidebarScreens";
import { SkillUpdateNotice } from "../../lazy/pages";
import { Guides } from "../../lazy/pages";
import { Wizard } from "../../lazy/pages";
import { ReviewNotes } from "../../lazy/pages";
import { UpdateCenter } from "../../lazy/pages";
import { FeedbackDialog } from "../../lazy/pages";

// Job 47 A6 (ONB-010): the first folder after setup opens the Start form on it, once it is on the list and in front.
// Job 57 F1: "on the list" is the folder-to-project map openStart ticks the folder from (projectOf), matched with
// sameDir, since firstStart is the opened worktree. Job 68 F1: "in front" is that folder or its project's own
// stored folder (the store shows a worktree in its project's grid, and git can spell one folder two ways: an 8.3
// name, a subst drive, a link). On the list but not in front: the user went elsewhere, so it is dropped unopened.
export function FirstFolderStart() {
  const { firstStart, doneFirstStart, activeDir, projects, owner, openStart } = useWindow();
  useEffect(() => {
    if (firstStart === null) return;
    const pid = Object.entries(owner).find(([dir]) => sameDir(dir, firstStart))?.[1];
    if (pid === undefined || !projects.some((p) => p.id === pid)) return;
    doneFirstStart();
    const proj = projects.find((p) => p.id === pid);
    if (sameDir(activeDir, firstStart) || (proj && sameDir(activeDir, proj.path))) openStart({ here: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstStart, activeDir, projects, owner]);
  return null;
}

export default function WindowHosts() {
  const {
    wizard, settings, saveSetting, wizardSession, wizardClose, pickFolder, projects, endWizard, firstFolder,
    screen, setScreen, settingsRead, picked, notes, repoless, activeDir, putNote, setNotes, setPicked,
    reviewTargets, sendMenu, setSendMenu, sendReview, startReview, agents, defaultId, live, panes, ptys, titles,
    owner, restoredKeys, setToast, openStart, setSidebarOpen, sheet,
  } = useWindow();
  return (
    <>
      <Guides />
      <FirstFolderStart />
      {wizard !== null && (
        <Wizard
          start={wizard}
          ping={settings["notifyOnFinish" satisfies KindKey] !== false}
          onPing={(on) => saveSetting("notifyOnFinish" satisfies KindKey, on)}
          onSession={() => wizardSession(() => openStart({ here: activeDir !== null }))} // job 22: hand over to the Start form, on the folder in front
          hasFolder={projects.length > 0}
          onPickFolder={() => {
            if (wizardClose.retry()) return;
            // ONB-004: Add Project, then back to the last screen (T-796); with the sidebar hidden, its panel is shown first (job 29 R7)
            pickFolder(true, addFolderHands(setSidebarOpen, screen, setScreen));
          }}
          onClose={() => {
            if (wizardClose.retry()) return;
            const none = projects.length === 0;
            // Job 68 (decided): closed or skipped with a folder on the list, the Start form opens as finishing does,
            // unless the ask at start is off or work is up (a pane, or a Start form: setup reopened from Help).
            // Job 78 R73-1: a pane not started yet (it has seats: the one "Pick a folder" leaves) is not work.
            const start = !none && asksAtStart(settings) && ownPanes(panes.filter((p) => !p.seats)) === 0 && !sheet;
            endWizard("dismissed", () => {
              firstFolder.current = none;
              if (start) openStart({ here: activeDir !== null });
            });
          }}
        />
      )}
      <UpdateCenter />
      <BringSkillsUp onShow={() => screen !== "skills" && toggleSkills(screen, setScreen)} />
      <SkillUpdateNotice settingsLoaded={settingsRead} />
      <FeedbackDialog />
      {reviewOn(settings) && (
        <ReviewNotes
          picked={picked}
          notes={notes}
          onAdd={(n) => {
            const kept = repoless && activeDir !== null ? plainNote(n, crypto.randomUUID()) : null;
            if (kept && activeDir !== null) putNote(activeDir, kept);
            else setNotes((ns) => [...ns, n]);
            setPicked(null);
          }}
          onCancel={() => setPicked(null)}
          onRemove={(i) => setNotes((ns) => ns.filter((_, k) => k !== i))}
          onClear={() => setNotes([])}
          targets={reviewTargets}
          menu={sendMenu}
          onMenu={setSendMenu}
          onSend={sendReview}
          starters={activeDir === null ? [] : startChoices(agents, defaultId)}
          onStart={startReview}
        />
      )}
      {readStatusBar(settings).visible && (
      <StatusBar
        hidden={readStatusBar(settings).hidden}
        onToggle={(id) => saveSetting(STATUS_FIELDS.hidden, toggleItem(readStatusBar(settings).hidden, id))}
        onHideBar={() => saveSetting(STATUS_FIELDS.visible, false)}
        terminals={live.length}
        agents={live.filter((p) => p.agent !== "shell").length}
        names={() => Object.fromEntries(panes.flatMap((p) => (ptys.current[p.key] === undefined ? [] : [[ptys.current[p.key], tabName(p, titles)]])))}
        workspaces={Object.keys(owner)}
        active={activeDir}
        hooks={settingsRead ? hooksOn(settings) : null}
        loaded={() => windowLoaded(settingsRead, restoredKeys.current, ptys.current, panes)}
      />
      )}
      <EditMenuHost onToast={setToast} />
    </>
  );
}
