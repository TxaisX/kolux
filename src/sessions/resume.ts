// VIEW-085 (T-169): resuming a past session. The Rust side builds the start line and the copyable
// command (session_resume_plan); this is what the window does with them: who may be resumed, which
// shell the copied command is written for, and the plain reasons shown when it cannot be.
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./model";

/** The back end's answer: the start line to open in a terminal and the same command as one line. */
export type ResumePlan = {
  line: { args: string[]; typed: string | null; program: string | null; env: [string, string][]; resumed: boolean };
  cwd: string | null;
  program: string;
  copy: string;
};

export const NO_TURNS = "This session has no messages yet, so there is nothing to resume.";

/** Why a listed session cannot be resumed, or null when it can (sessions with no turns cannot; copy is a separate button). */
export const resumeBlock = (s: Pick<Session, "turns">): string | null => (s.turns === 0 ? NO_TURNS : null);

/** The program the target tab really runs, the way the workspace runs it: unknown means the platform's own shell. */
export const shellProgram = (tabShell: string | null | undefined, hostShell: string | null | undefined): string | null => {
  const pick = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
  return pick(tabShell) ?? pick(hostShell);
};

export const planFor = (s: Pick<Session, "agent" | "id">, workspace: string | null, shell: string | null) =>
  invoke<ResumePlan>("session_resume_plan", { agent: s.agent, id: s.id, workspace, shell });

/** C28-R5-01: the pane fields of a resume. The id goes on the pane at once, so the live guard sees the
 *  session before any hook has reported it (a resumed pane used to record no id at all, and History
 *  could delete the transcript the agent was writing). A resume with no id is unchanged. */
export const resumedFields = (id: string | undefined): { session?: string; resumed: true } => (id ? { session: id, resumed: true } : { resumed: true });

/** What a drag of a session row carries (VIEW-085 drop onto a pane reads it). */
export const SESSION_DRAG = "application/x-kolux-session";
export const dragPayload = (s: Pick<Session, "agent" | "id">): string => JSON.stringify({ agent: s.agent, id: s.id });
export function readDrag(text: string): { agent: string; id: string } | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    return typeof v.agent === "string" && typeof v.id === "string" && v.id !== "" ? { agent: v.agent, id: v.id } : null;
  } catch {
    return null;
  }
}
