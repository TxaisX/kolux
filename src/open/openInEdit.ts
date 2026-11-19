// SET-039 (T-237-b): editing a row of the Open in apps list. A preset row is matched by id on every read
// (readOpenIn), so an edited preset becomes a custom row at the same place; a custom row keeps its place too.
// Both fields must be filled in, and an edit that would duplicate another row is refused.
import { draftReady, type OpenInApp } from "../settings/openIn";

const squash = (c: string) => c.trim().replace(/\s+/g, " ").toLowerCase();

export function editApp(list: OpenInApp[], id: string, edit: { name: string; command: string }): OpenInApp[] {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0 || !draftReady(edit)) return list;
  const old = list[i];
  const keep = edit.name.trim() === old.name && squash(edit.command) === squash(old.command);
  if (keep) return list;
  const next: OpenInApp = { id: "custom:" + squash(edit.command), name: edit.name.trim(), command: edit.command.trim() };
  if (list.some((a, j) => j !== i && a.id === next.id)) return list;
  return list.map((a, j) => (j === i ? next : a));
}

/** T-753: the row whose command the draft already is (a custom app is keyed by its command), other than the one
 * being edited. Adding or saving it would do nothing, so the card says so and keeps the fields. */
export const alreadyListed = (list: OpenInApp[], d: { name: string; command: string }, editing: string | null) =>
  draftReady(d) ? list.find((a) => a.id !== editing && a.id === "custom:" + squash(d.command)) : undefined;
