// Cycle 3 (the WindowView split): the window-wide hosts, moved out of shell/WindowView.tsx as they
// were: the guides and the first-run wizard (ONB), the updater (APP-058..060), the skills bar and its
// notice, Feedback, the Review changes sheet (GIT-042), the status bar (STAT-024, STAT-050), the
// floating windows and the Edit menu. They sit after the body, as they did.
import StatusBar from "../../chrome/StatusBar";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "../../chrome/statusItems";
import EditMenuHost from "../../editmenu/EditMenuHost";
import { plainNote } from "../../editor/fileNotes";
import { reviewOn, startChoices } from "../../editor/notes";
import FloatingLayer from "../../floating/FloatingLayer";
import { hooksOn } from "../../onboarding/hooksOn";
import type { KindKey } from "../../settings/notifications";
import { BringSkillsUp } from "../../skills/SkillBarItem";
import { toggleSkills } from "../../skills/nav";
import { windowLoaded } from "../../status/manage";
import { tabName } from "../../terminal/tabName";
import { useWindow } from "./store";
import { SkillUpdateNotice } from "../../lazy/pages";
import { Guides } from "../../lazy/pages";
import { Wizard } from "../../lazy/pages";
import { ReviewNotes } from "../../lazy/pages";
import { UpdateCenter } from "../../lazy/pages";
import { FeedbackDialog } from "../../lazy/pages";

export default function WindowHosts() {
  const {
    wizard, settings, saveSetting, wizardSession, wizardClose, pickFolder, projects, endWizard, firstFolder,
    screen, setScreen, settingsRead, picked, notes, repoless, activeDir, putNote, setNotes, setPicked,
    reviewTargets, sendMenu, setSendMenu, sendReview, startReview, agents, defaultId, live, panes, ptys, titles,
    owner, restoredKeys, setToast,
  } = useWindow();
  return (
    <>
      <Guides />
      {wizard !== null && (
        <Wizard
          start={wizard}
          ping={settings["notifyOnFinish" satisfies KindKey] !== false}
          onPing={(on) => saveSetting("notifyOnFinish" satisfies KindKey, on)}
          onSession={() => void wizardSession()}
          onPickFolder={() => {
            if (wizardClose.retry()) return;
            pickFolder(); // ONB-004, the same hand-over T-612's Open a session uses with no workspace
          }}
          onClose={() => {
            if (wizardClose.retry()) return;
            const none = projects.length === 0;
            endWizard("dismissed", () => (firstFolder.current = none));
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
      <FloatingLayer agents={agents} defaultId={defaultId} home={activeDir ?? undefined} onToast={(m) => setToast(m)} />
      <EditMenuHost onToast={setToast} />
    </>
  );
}
