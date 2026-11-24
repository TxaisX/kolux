// LAND-05: where a workspace's work stands on its way to main (src-tauri/src/land.rs), as the pane
// shows it: a small chip in the header and a "Send to main" item in the pane menu. Pure: no React,
// no tauri. Everything the backend sends is read defensively, so a changed or missing field shows
// nothing rather than a wrong claim.

/** The event the backend emits after every land, with the `LandOutcome`. */
export const LAND_EVENT = "workspace-land";
/** The pane menu item's id (the menu only draws it, PaneMenu.tsx does not know it). */
export const SEND_TO_MAIN_ID = "sendToMain";
export const SEND_TO_MAIN = "Send to main";
export const SEND_TO_MAIN_TIP = "Sends this workspace's finished work to main on this computer. Nothing goes to GitHub.";

/** The backend's JSON (serde rename_all = "camelCase" in land.rs). */
export type LandStateName = "landed" | "nothingNew" | "ready" | "refused" | "clashed";
export type SiblingStateName = "updated" | "current" | "behind";
export type LandSibling = { path: string; state: SiblingStateName; why: string | null };
export type LandOutcome = { path: string; branch: string | null; state: LandStateName; message: string; files: string[]; siblings: LandSibling[] };
export type LandRecord = { state: string; why?: string; at: number }; // why is left out when the backend has none
export type LandPreview = { uncommitted: number; ahead: number; landable: boolean; why: string | null };

export type LandChip = { text: "Not in main" | "Behind main" | "Finished"; color: "var(--warn)" | "var(--working)"; tip: string };
export type LandStep = { kind: "stop"; text: string } | { kind: "ask"; question: { title: string; body: string; confirm: string } } | { kind: "go" };

const UNREAD = "Not sent to main: Kolux could not check this workspace.";

/** A non-array object, the only shape the backend's answers may take. */
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A non-empty string, or null. */
const said = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** The backend's `projects::name_key`: `/` to `\`, every trailing `\` stripped, lower-case. */
export function landKey(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** The workspace's last land or take-in, or null when the store has none (or shows garbage). */
export function recordFor(records: unknown, folder: string | null | undefined): LandRecord | null {
  if (!isObject(records) || typeof folder !== "string" || folder.length === 0) return null;
  const found = records[landKey(folder)];
  if (!isObject(found) || typeof found.state !== "string") return null;
  const at = typeof found.at === "number" ? found.at : 0;
  const why = said(found.why);
  return why === null ? { state: found.state, at } : { state: found.state, why, at };
}

/** The chip in the pane header for a record, or null when the workspace has nothing to say. */
export function landChip(record: unknown): LandChip | null {
  if (!isObject(record) || typeof record.state !== "string") return null;
  const why = said(record.why);
  switch (record.state) {
    case "clashed":
      return { text: "Not in main", color: "var(--warn)", tip: why ?? "Its work clashes with main, so it was not sent." };
    case "ready":
      return { text: "Not in main", color: "var(--warn)", tip: why ?? "Its task is finished and waits to be sent. Choose Send to main in the pane menu." };
    case "behind":
      return { text: "Behind main", color: "var(--warn)", tip: why ?? "Main has newer work this workspace could not take in yet." };
    case "landed":
    case "nothingNew":
      return { text: "Finished", color: "var(--working)", tip: "Its work is in main." };
    default:
      return null;
  }
}

/** Send to main is only for a workspace that is not the project's main folder. */
export function canSendToMain(worktree: { path: string; isMain: boolean } | null | undefined): boolean {
  return isObject(worktree) && typeof worktree.path === "string" && worktree.path.length > 0 && worktree.isMain === false;
}

/** What choosing Send to main does next: stop with a reason, ask about uncommitted work, or go. */
export function landStep(preview: unknown): LandStep {
  if (!isObject(preview) || typeof preview.landable !== "boolean") return { kind: "stop", text: UNREAD };
  if (!preview.landable) {
    const why = said(preview.why);
    return { kind: "stop", text: why === null ? UNREAD : `Not sent to main: ${why}.` };
  }
  const n = preview.uncommitted;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return { kind: "stop", text: UNREAD };
  if (n === 0) return { kind: "go" };
  const body =
    n === 1
      ? "1 file in this workspace has changes that are not committed. Kolux commits them first, then sends the work to main on this computer. Nothing goes to GitHub."
      : `${n} files in this workspace have changes that are not committed. Kolux commits them first, then sends the work to main on this computer. Nothing goes to GitHub.`;
  return { kind: "ask", question: { title: "Send to main?", confirm: "Send to main", body } };
}

/** What the pane's notice line says after a land: the backend's own words, else that it failed. */
export function landFlash(outcome: unknown): string {
  const message = isObject(outcome) ? said(outcome.message) : null;
  return message ?? "Kolux could not send this workspace to main.";
}
