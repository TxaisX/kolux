// The window's review actions, moved out of App.tsx as they were (cycle 2, the App.tsx split): answers from a
// Board card (VIEW-025), the plan sheet's Approve and Request changes (SAFE-003/004/007), and review notes
// sent to an agent (GIT-041, EDIT-020). A plain function the window calls each render, as the closures were
// made each render; what the window makes later in its render is read from `late` (shell/windowLate.ts).
import type { Pane } from "../App";
import type { WindowState } from "../shell/windowStore";
import type { useSettingsPlumbing } from "../settings/useSettingsPlumbing";
import type { launchActions } from "../launch/launchActions";
import type { WindowLate } from "../shell/windowLate";
import { answeredElsewhere } from "../chat/ask";
import { answered as cardAnswered, hearingNow, outcomeNote, pasteToPane, writeTerminal } from "../chat/send";
import type { AgentState } from "../projects/rows";
import { bracketed } from "../terminal/paste";
import { draftKey, feedbackMessage, startFeedback, stillPending } from "../terminal/planReview";
import { tabName } from "../terminal/tabName";
import { panesIn, sameDir } from "../workspaces";
import { markSent, noteBlocks } from "./diffNotes";
import { notesMarkdown } from "./notes";
import { invoke } from "@tauri-apps/api/core";

/** Said when Approve or Request changes is pressed after the agent has moved on from the plan the sheet shows. */
export const PLAN_STALE = "The agent is no longer waiting on this plan, so nothing was sent.";
/** Said when Kolux could not pass an Approve or Deny to the agent. */
export const answerFailed = (e: unknown) => `Kolux could not answer the agent: ${e instanceof Error ? e.message : String(e)}. Answer it in its terminal.`;

export function reviewActions(s: WindowState, p: ReturnType<typeof useSettingsPlumbing>, la: ReturnType<typeof launchActions>, late: WindowLate) {
  const {
    activeDir, agents, focused, hookRef, notes, panes, planDrafts, ptys, setHook, setNotes, setPlanDrafts, setReviewing, setStamp, setToast, titles, turn
  } = s;
  const { notesFor, saveNotes } = p;
  const { openIn } = la;
  // SKILL-008: a waiting role gets its prompt once the role it waits on has written this run's
  // marker and its session is found; once only, and a failed send is tried again next time.
  // Council FIX-2 (chat 8151d6f re-review, FS2): the window's own pastes (Send
  // notes, Request changes' feedback) go in only while the pane's hook readings say it is not asking.
  const toPane = { terminalOf: (k: number) => ptys.current[k], stateOf: (k: number) => hookRef.current[k], write: writeTerminal };
  // Council FIX-3 (FS2): the pane takes the state Kolux resolved after the answer (still "permission"
  // while a second sub-agent asks), unless a newer hook event came in meanwhile.
  const answer = (p: Pane, approve: boolean) => {
    answeredElsewhere(p.key); // chat review FIX-BEFORE 1: the chat card must not answer the same prompt again
    const since = hearingNow();
    return invoke<AgentState | null>("agent_answer", { paneKey: p.key, agent: p.agent, approve })
      .then((now) => {
        const state = typeof now === "string" ? now : "working";
        if (cardAnswered(p.key, state, since)) setHook((h) => ({ ...h, [p.key]: state }));
        setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
      })
      // A failed answer used to vanish; say it, and point at the terminal where the agent still waits.
      .catch((e) => setToast(answerFailed(e)));
  };
  // SAFE-003, SAFE-004: Approve is the agent's own yes; Request changes is its no, then the
  // feedback typed into its prompt as one paste once it has left the question.
  // SAFE-005: the drafts are per pane and exact plan text, in memory only.
  const dropDraft = (key: string) => setPlanDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
  // SAFE-007: an answer goes only while the pane still waits on the plan the sheet shows.
  const planLive = (p: Pane, plan: string) => stillPending(hookRef.current[p.key], turn[p.key], plan);
  const approvePlan = (p: Pane, plan: string) => {
    if (!planLive(p, plan)) return setToast(PLAN_STALE);
    setReviewing(null);
    dropDraft(draftKey(p.key, plan));
    void answer(p, true);
  };
  const requestChanges = async (p: Pane, plan: string) => {
    if (!planLive(p, plan)) return setToast(PLAN_STALE);
    const key = draftKey(p.key, plan);
    const d = planDrafts[key] ?? { comments: [], note: "" };
    // A write that did not reach the pane says false, so a failed paste is never followed by Enter.
    const write = (data: string) => {
      const id = ptys.current[p.key];
      return id === undefined ? Promise.resolve(false) : invoke("terminal_write", { id, data }).then(() => true, () => false);
    };
    // SAFE-004 / T-032-b: the send runs as a job (planReview) that the sheet can cancel until Enter.
    const job = startFeedback(feedbackMessage(d.comments, d.note), {
      // Claude has no hook for a deny inside its own menu, so the pane leaves "permission" here, as answer() does.
      // Council FIX-3 (FS2): the pane takes the state Kolux resolved after the deny, unless a newer hook event came in.
      deny: () => {
        const since = hearingNow();
        answeredElsewhere(p.key); // chat review FIX-BEFORE 1
        return invoke<AgentState | null>("agent_answer", { paneKey: p.key, agent: p.agent, approve: false }).then(
          (now) => {
            const state = typeof now === "string" ? now : "working";
            if (cardAnswered(p.key, state, since)) setHook((h) => ({ ...h, [p.key]: state }));
            return true;
          },
          () => false,
        );
      },
      asking: () => hookRef.current[p.key] === "waiting" || hookRef.current[p.key] === "permission",
      type: (text) => write(bracketed(text)),
      enter: () => write("\r"),
      alive: () => ptys.current[p.key] !== undefined && late.panesRef.current.some((x) => x.key === p.key),
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    setReviewing((r) => (r && r.key === p.key ? { ...r, send: job } : r));
    const { outcome, answered, typed } = await job.done;
    // Any end closes the sheet; the draft is kept unless the feedback was sent. A cancel can never
    // land before the agent's no went out (stand-in review of lane/marks ee2bfbc, FIX-BEFORE 1).
    setReviewing((r) => (r?.send === job ? null : r));
    if (outcome === "sent") {
      dropDraft(key); // SAFE-004: sending wipes the saved draft; a cancelled send keeps it.
      setHook((h) => ({ ...h, [p.key]: "working" }));
      setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
    } else if (outcome === "no-answer") setToast("Kolux could not answer the agent. Answer it in its terminal; your feedback was not typed.");
    else if (outcome === "write-failed") setToast(typed ? "Kolux could not press Enter in the agent's terminal: your feedback is typed but was not sent." : "Kolux could not type into the agent's terminal: Claude's plan prompt was dismissed and your feedback was not typed.");
    else if (outcome === "still-asking") setToast(`The agent is still asking. Answer it in its terminal; your feedback was not ${typed ? "sent" : "typed"}.`);
    else if (outcome === "cancelled" && answered) setToast(typed ? "Cancelled before sending: your feedback is typed in the agent's prompt but was not sent." : "Cancelled: Claude's plan prompt was dismissed and your feedback was not typed.");
  };
  // GIT-041: every note goes to the workspace's agent (the focused one, else the first) as one
  // pasted message; a note edited while the send was in flight is not marked sent.
  const pasteInto = async (key: number, text: string) => {
    const got = await pasteToPane(key, text, toPane);
    if (got !== "sent") throw outcomeNote(got, key, toPane);
  };
  const sendNotes = async (dir: string): Promise<string | null> => {
    const notes = notesFor(dir);
    if (notes.length === 0) return "There are no notes to send.";
    const agent = [...panes].sort((a, b) => Number(b.key === focused) - Number(a.key === focused)).find((p) => !p.kind && p.agent !== "shell" && sameDir(p.cwd, dir) && ptys.current[p.key] !== undefined);
    if (!agent) return "No agent is running in this workspace. Start one, or copy the notes instead.";
    try {
      await pasteInto(agent.key, noteBlocks(notes, dir));
    } catch (err) {
      return `The notes were not sent: ${String(err)}`;
    }
    saveNotes(dir, markSent(notesFor(dir), notes));
    return null;
  };
  // EDIT-020: the agents in this worktree the Markdown and file notes can go to.
  const inWorktree = (p: Pane) => activeDir !== null && sameDir(p.cwd, activeDir) && ptys.current[p.key] !== undefined;
  // The chosen agent is checked again at the click; a failed delivery keeps the notes.
  const sendReview = async (key: number): Promise<string | null> => {
    const p = late.panesRef.current.find((x) => x.key === key);
    if (!p || !inWorktree(p)) return "That agent is no longer running, so nothing was sent. The notes are kept.";
    try {
      await pasteInto(key, notesMarkdown(notes));
    } catch (err) {
      return `The notes were not sent, so they are kept: ${String(err)}`;
    }
    setNotes([]);
    setToast(`The review notes were sent to ${tabName(p, titles)}.`);
    return null;
  };
  // EDIT-020 (T-132-b): the Send menu can start a new agent in this worktree with the notes as its
  // first prompt; a start that fails keeps the notes.
  const startReview = async (id: string): Promise<string | null> => {
    const a = agents.find((x) => x.id === id && x.installed);
    if (!a) return "That agent is not installed, so nothing was sent. The notes are kept.";
    if (activeDir === null) return "Open a workspace first. The notes are kept.";
    try {
      await openIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, notesMarkdown(notes), true);
    } catch (err) {
      return `${a.name} did not start, so the notes are kept: ${String(err)}`;
    }
    setNotes([]);
    return `Started ${a.name} with the review notes.`;
  };
  return {
    toPane, answer, dropDraft, planLive, approvePlan, requestChanges, pasteInto, sendNotes, inWorktree, sendReview, startReview,
  };
}

export type ReviewActions = ReturnType<typeof reviewActions>;
