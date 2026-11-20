// A session's row text: the one piece of the old Agents rail the chat view still uses. Pure.
import { folderName } from "../projects/model";

export type Session = { key: number; title?: string; cwd: string | null };

/** A row's text: the display name or title the launcher gave it; else, for an orchestrator-started
 * session (T-050-b), its worker label (orchestration's worker_labels: the task's display name, title
 * or text, else the brief's task text, never the wrapper); else the folder it works in, else its number. */
export const sessionLabel = (p: Pick<Session, "key" | "title" | "cwd">, task?: string): string => p.title || task?.trim() || (p.cwd ? folderName(p.cwd) : "") || `Session ${p.key}`;
