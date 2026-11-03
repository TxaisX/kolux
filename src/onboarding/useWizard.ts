// T-543: the first-run wizard's state and ways out, moved out of App.tsx as they were and called
// where they used to sit.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ADD_PROJECT, firstFolderAgent, oneClick, openAt, REOPEN_WIZARD, reopenWizard, wizardCloser, type Outcome } from "./firstRun";
import { isAiAgent } from "./agentKind";
import { projectAddedNote } from "./sidebar";
import { startGridTour } from "./tour";
import { starAfterClose } from "./star";
import type { AgentInfo } from "../launch/PlusMenu";
import { defaultAgentId, offeredAgents } from "../launch/agents";
import { sessionAgent } from "./sessionAgent";

type WizardDeps = {
  setToast: (text: string) => void;
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  activeDir: string | null;
  startIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra?: string[], title?: string) => Promise<number | null>;
};

/** 49-ux2: what Pick a folder says while Add Project is up and the wizard is out of its way. */
export const PICK_FOLDER_NOTE = "Add a project to finish setup. If you cancel, Help > Onboarding brings the setup back.";
/** 49-ux2: Open a session with no AI agent installed used to do nothing. */
export const NO_AGENT_NOTE = "No agent is installed yet, so no session was started. Install one in Settings > Agents, then open a session.";

export function useWizard({ setToast, agents, settings, activeDir, startIn }: WizardDeps) {
  // ONB-001..005: the first-run wizard floats over the app while its record says it is open.
  const [wizard, setWizard] = useState<number | null>(null);
  useEffect(() => {
    invoke<{ step: number } | null>("onboarding_get").then((r) => setWizard(openAt(r)), () => {});
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
  // 49-ux2: Pick a folder hides the wizard but stores nothing; the close is stored once a project was really added.
  const finishOnAdd = useRef(false);
  // T-612: the AI agent Open a session would have started, for the folder picked after it (else ONB-010's saved default).
  const firstAgent = useRef<AgentInfo | null>(null);
  // VIEW-114 (FIX-2): every added project tells the sidebar entry to read its steps again.
  const projectAdded = (dir: string, branch: string | null) => {
    projectAddedNote();
    if (!firstFolder.current) return;
    firstFolder.current = false;
    const agent = firstAgent.current ?? firstFolderAgent(offeredAgents(agents, settings), defaultAgentId(settings));
    firstAgent.current = null;
    if (finishOnAdd.current) {
      finishOnAdd.current = false;
      void wizardClose.end("completed");
    }
    if (agent) void startIn(agent, dir, branch, "", true);
  };
  // ONB-004: Pick a folder hands over to Add Project and starts `agent` in the folder added next. 49-ux2: setup is
  // marked completed only once a folder was added (projectAdded), so cancelling the dialog does not finish it;
  // the wizard stays out of the dialog's way and Help > Onboarding brings it back.
  const pickFolder = (agent: AgentInfo | null = null) => {
    if (wizardClose.retry()) return;
    firstFolder.current = true;
    finishOnAdd.current = true;
    firstAgent.current = agent;
    setWizard(null);
    setToast(PICK_FOLDER_NOTE);
    window.dispatchEvent(new CustomEvent(ADD_PROJECT));
  };
  // ONB-005: one plain session on the first available agent (the default first), empty prompt.
  // T-612 (audit F08-onboarding-look-misc.2): with no workspace yet (Continue on "Your work" makes none since kits went,
  // T-568), it leads to picking a folder, and the session opens there; a plain terminal opens with the folder anyway.
  const wizardSession = async () => {
    if (wizardClose.retry()) return;
    const agent = sessionAgent(agents, settings);
    if (!activeDir) return pickFolder(agent && isAiAgent(agent.id) ? agent : null);
    if (!agent) return setToast(NO_AGENT_NOTE);
    if ((await startIn(agent, activeDir, null, "", true)) !== null) endWizard("completed", startGridTour);
  };
  return { wizard, setWizard, wizardClose, endWizard, firstFolder, projectAdded, wizardSession, pickFolder };
}
