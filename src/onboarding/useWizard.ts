// T-543: the first-run wizard's state and ways out, moved out of App.tsx as they were and called
// where they used to sit.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ADD_PROJECT, firstFolderAgent, oneClick, openAt, REOPEN_WIZARD, reopenWizard, wizardCloser, type Outcome } from "./firstRun";
import { projectAddedNote } from "./sidebar";
import { starAfterClose } from "./star";
import type { AgentInfo } from "../launch/PlusMenu";
import { defaultAgentId, offeredAgents } from "../launch/agents";

type WizardDeps = {
  setToast: (text: string) => void;
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  activeDir: string | null;
  startIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra?: string[], title?: string) => Promise<number | null>;
  /** T-796: a plain shell tab in the folder in front (the same one a new terminal tab opens). */
  openShell: () => void;
};

/** 49-ux2: what Pick a folder says while Add Project is up and the wizard is out of its way. */
export const PICK_FOLDER_NOTE = "Add a project to finish setup. If you cancel, Help > Onboarding brings the setup back.";

export function useWizard({ setToast, agents, settings, startIn }: WizardDeps) {
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
        (err) => setToast(`Kolux could not reopen onboarding (${String(err)}).`),
      );
    };
    window.addEventListener(REOPEN_WIZARD, reopen);
    return () => window.removeEventListener(REOPEN_WIZARD, reopen);
  }, []);
  // ONB-010: armed by Pick a folder, or by Skip while no project exists; the next project added
  // starts the saved default agent in it, once.
  const firstFolder = useRef(false);
  // T-796: Pick a folder on Your work: once the folder is added the wizard comes back on the last screen, which asks what to start.
  const backToSession = useRef(false);
  // 49-ux2: Pick a folder hides the wizard but stores nothing; the close is stored once a project was really added.
  const finishOnAdd = useRef(false);
  // T-612: the AI agent Open a session would have started, for the folder picked after it (else ONB-010's saved default).
  const firstAgent = useRef<AgentInfo | null>(null);
  // A plain terminal picked on the last screen before any folder: the folder added next starts no agent (the new workspace opens its terminal).
  const firstPlain = useRef(false);
  // VIEW-114 (FIX-2): every added project tells the sidebar entry to read its steps again.
  const projectAdded = (dir: string, branch: string | null) => {
    projectAddedNote();
    if (backToSession.current) {
      backToSession.current = firstFolder.current = finishOnAdd.current = false;
      firstAgent.current = null;
      invoke("onboarding_step", { step: 2 }).catch(() => {}); // the folder screen is finished; the last one is next
      setWizard(3);
      return;
    }
    if (!firstFolder.current) return;
    firstFolder.current = false;
    const agent = firstPlain.current ? null : (firstAgent.current ?? firstFolderAgent(offeredAgents(agents, settings), defaultAgentId(settings)));
    firstAgent.current = null;
    firstPlain.current = false;
    if (finishOnAdd.current) {
      finishOnAdd.current = false;
      void wizardClose.end("completed");
    }
    if (agent) void startIn(agent, dir, branch, "", true);
  };
  // ONB-004: Pick a folder hands over to Add Project and starts `agent` in the folder added next. 49-ux2: setup is
  // marked completed only once a folder was added (projectAdded), so cancelling the dialog does not finish it;
  // the wizard stays out of the dialog's way and Help > Onboarding brings it back.
  const pickFolder = (agent: AgentInfo | null = null, backToLast = false, plain = false) => {
    if (wizardClose.retry()) return;
    firstFolder.current = true;
    firstPlain.current = plain;
    finishOnAdd.current = true;
    backToSession.current = backToLast;
    firstAgent.current = agent;
    setWizard(null);
    setToast(PICK_FOLDER_NOTE);
    window.dispatchEvent(new CustomEvent(ADD_PROJECT));
  };
  // Job 22 (FROZEN decision 8, one Start question): the last screen hands over to the Start form. Setup is stored as
  // completed as before, the screens close, and then `open` brings up the form once. A failed save keeps the screens up
  // with a toast; the same button tries that close again, with its hand-over.
  const wizardSession = (open: () => void) => {
    if (wizardClose.retry()) return;
    endWizard("completed", open);
  };
  return { wizard, setWizard, wizardKnown, wizardClose, endWizard, firstFolder, projectAdded, wizardSession, pickFolder };
}
