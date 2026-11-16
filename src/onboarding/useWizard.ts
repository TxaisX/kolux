// T-543: the first-run wizard's state and ways out, moved out of App.tsx as they were and called
// where they used to sit.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ADD_PROJECT, oneClick, openAt, REOPEN_WIZARD, reopenWizard, wizardCloser, type Outcome } from "./firstRun";
import { projectAddedNote } from "./sidebar";
import { starAfterClose } from "./star";
import type { AgentInfo } from "../launch/PlusMenu";
import { addFolderVia } from "../launch/startForm";

type WizardDeps = {
  setToast: (text: string) => void;
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  /** Job 47 A6: no longer used here (the first folder opens the Start form); kept so App's call stays as it is. */
  startIn?: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra?: string[], title?: string) => Promise<number | null>;
};

/** 49-ux2: what Pick a folder says while Add Project is up and the wizard is out of its way. */
export const PICK_FOLDER_NOTE = "Add a project to finish setup. If you cancel, Help > Onboarding brings the setup back.";

export function useWizard({ setToast }: WizardDeps) {
  // ONB-001..005: the first-run wizard floats over the app while its record says it is open.
  const [wizard, setWizard] = useState<number | null>(null);
  const [wizardKnown, setWizardKnown] = useState(false); // job 13 F4: the Start form's ask at open waits for this answer
  useEffect(() => {
    invoke<{ step: number } | null>("onboarding_get")
      .then((r) => setWizard(openAt(r)), () => {})
      .finally(() => setWizardKnown(true));
  }, []);
  // ONB-007: the close is stored before the wizard goes; a failed store keeps it open with a toast,
  // and the next click on any of its ways out tries that same close again. VIEW-114: a stored close
  // also tells the sidebar slot (FIX-2).
  const [wizardClose] = useState(() =>
    wizardCloser(
      // ONB-007 / ONB-037 (T-208-c): a stored completed close asks the star prompt for its onboarding-finished toast.
      (outcome) => invoke("onboarding_close", { outcome }).then((r) => (starAfterClose(outcome), r)),
      () => {
        setWizard(null);
      },
      (err) => setToast(`Kolux could not keep your setup progress (${String(err)}). Click the same button again to try once more.`),
    ),
  );
  const endWizard = (outcome: Outcome, after?: () => void) => wizardClose.end(outcome, after);
  // ONB-009: Onboarding in the sidebar help menu starts the wizard over on screen one.
  useEffect(() => {
    const counts = oneClick();
    const reopen = () => {
      if (!counts()) return;
      // 49-ux2: a Pick a folder that was cancelled is over once the wizard is reopened.
      if (finishOnAdd.current) (finishOnAdd.current = false), (firstFolder.current = false);
      backToSession.current = false;
      void reopenWizard(
        () => invoke("onboarding_reopen"),
        () => setWizard(0),
        (err) => setToast(`Setup didn't open. Try again from Help. Details: ${String(err)}`),
      );
    };
    window.addEventListener(REOPEN_WIZARD, reopen);
    return () => window.removeEventListener(REOPEN_WIZARD, reopen);
  }, []);
  // ONB-010 (job 47 A6): armed when setup is closed with no folder; the next project added opens the Start form
  // with that folder ticked, once, and starts nothing by itself (FROZEN decision 8: one Start question).
  const firstFolder = useRef(false);
  // T-796: Pick a folder on Your work: once the folder is added the wizard comes back on the last screen, which asks what to start.
  const backToSession = useRef(false);
  // 49-ux2: Pick a folder hides the wizard but stores nothing; the close is stored once a project was really added.
  const finishOnAdd = useRef(false);
  // VIEW-114 (FIX-2): every added project tells the sidebar entry to read its steps again.
  const projectAdded = (dir: string, _branch: string | null) => {
    projectAddedNote();
    if (backToSession.current) {
      backToSession.current = firstFolder.current = finishOnAdd.current = false;
      invoke("onboarding_step", { step: 2 }).catch(() => {}); // the folder screen is finished; the last one is next
      setWizard(3);
      return;
    }
    if (!firstFolder.current) return;
    firstFolder.current = false;
    if (finishOnAdd.current) {
      finishOnAdd.current = false;
      void wizardClose.end("completed");
    }
    setFirstStart(dir); // Hosts opens the form once the folder is on the list and in front
  };
  // Job 47 A6: the folder the Start form opens on, until Hosts has opened it.
  const [firstStart, setFirstStart] = useState<string | null>(null);
  const doneFirstStart = () => setFirstStart(null);
  // ONB-004: Pick a folder hands over to Add Project and starts `agent` in the folder added next. 49-ux2: setup is
  // marked completed only once a folder was added (projectAdded), so cancelling the dialog does not finish it;
  // the wizard stays out of the dialog's way and Help > Onboarding brings it back.
  // Job 29 R7: Add Project lives in the sidebar's panel; `reach` shows that panel first when it is hidden (addFolderVia).
  const pickFolder = (backToLast: boolean, reach: Omit<Parameters<typeof addFolderVia>[0], "fire">) => {
    if (wizardClose.retry()) return;
    firstFolder.current = true;
    finishOnAdd.current = true;
    backToSession.current = backToLast;
    const at = wizard;
    setWizard(null);
    setToast(PICK_FOLDER_NOTE);
    // Job 37 A3: the panel never came, so Add project never opened: the screens come back where the user was.
    void addFolderVia({ ...reach, fire: () => window.dispatchEvent(new CustomEvent(ADD_PROJECT)) }).then((ok) => {
      if (ok || !finishOnAdd.current) return; // job 43 F5: a reopen or a project added meanwhile already moved on
      backToSession.current = firstFolder.current = finishOnAdd.current = false;
      setWizard(at);
      setToast("Could not open Add project. Try again.");
    });
  };
  // Job 22 (FROZEN decision 8, one Start question): the last screen hands over to the Start form. Setup is stored as
  // completed as before, the screens close, and then `open` brings up the form once. A failed save keeps the screens up
  // with a toast; the same button tries that close again, with its hand-over.
  const wizardSession = (open: () => void) => {
    if (wizardClose.retry()) return;
    endWizard("completed", open);
  };
  return { wizard, setWizard, wizardKnown, wizardClose, endWizard, firstFolder, projectAdded, wizardSession, pickFolder, firstStart, doneFirstStart };
}
