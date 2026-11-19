// The window's review actions, moved out of App.tsx as they were (cycle 2, the App.tsx split): answers from a
// Board card (VIEW-025) and the plan sheet's Approve and Request changes (SAFE-003/004/007). A plain function the window calls each render, as the closures were
// made each render; what the window makes later in its render is read from `late` (shell/windowLate.ts).
import type { Pane } from "../App";
import type { WindowState } from "../shell/windowStore";
import type { WindowLate } from "../shell/windowLate";
import { answeredElsewhere } from "../chat/ask";
import { answered as cardAnswered, hearingNow, writeTerminal } from "../chat/send";
import type { AgentState } from "../projects/rows";
import { bracketed } from "./paste";
import { draftKey, feedbackMessage, startFeedback, stillPending } from "./planReview";
import { invoke } from "@tauri-apps/api/core";

/** Said when Approve or Request changes is pressed after the agent has moved on from the plan the sheet shows. */
export const PLAN_STALE = "The agent is no longer waiting on this plan, so nothing was sent.";
/** Said when Kolux could not pass an Approve or Deny to the agent. */
export const answerFailed = (e: unknown) => `Kolux could not answer the agent: ${e instanceof Error ? e.message : String(e)}. Answer it in its terminal.`;

export function reviewActions(s: WindowState, late: WindowLate) {
  const { hookRef, planDrafts, ptys, setHook, setPlanDrafts, setReviewing, setStamp, setToast, turn } = s;
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
  return {
    toPane, answer, dropDraft, planLive, approvePlan, requestChanges,
  };
}

export type ReviewActions = ReturnType<typeof reviewActions>;
