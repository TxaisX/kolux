// VIEW 089 (T-153-d): what a past session's Show file, Open file and Delete buttons ask of the back
// end (sessions::files). The back end finds the files from the agent and id alone and refuses
// anything outside the folder the agent keeps its sessions in.
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./model";

export type FileAction = "reveal" | "open" | "delete";

const COMMAND: Record<FileAction, string> = { reveal: "session_reveal", open: "session_open", delete: "session_delete" };

export const DELETE_WARNING = "Delete this session's files? This cannot be undone.";

/** The delete question, naming the session so a click on the wrong row is noticed before Delete. */
export const deleteQuestion = (title?: string): string => {
  const name = (title ?? "").replace(/\s+/g, " ").trim();
  if (!name) return DELETE_WARNING;
  return `Delete "${name.length > 60 ? name.slice(0, 59) + "…" : name}" and its files? This cannot be undone.`;
};

/** The one-line result shown after an action. */
export const doneNote = (action: FileAction, removed: number | null): string =>
  action === "delete" ? `Session deleted (${removed ?? 0} item${removed === 1 ? "" : "s"} removed).` : action === "reveal" ? "Shown in the file manager." : "Opened.";

/** Runs one action on a session's files. A delete must already have been confirmed by the person. */
export async function runFileAction(action: FileAction, s: Pick<Session, "agent" | "id">): Promise<string> {
  const answer = await invoke<number | null>(COMMAND[action], { agent: s.agent, id: s.id });
  return doneNote(action, typeof answer === "number" ? answer : null);
}
