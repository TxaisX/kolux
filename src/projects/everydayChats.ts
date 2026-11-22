// Everyday chats that outlive their tab (2026-11-21). Owner ask: a chat made in the Everyday folder stays in
// the sidebar after its tab is closed or Kolux quits, clicking it resumes the same conversation, and a
// right-click Delete removes the row and the conversation file.
//
// One record per chat, kept in the settings file under `everydayChats` (the same door savedLayout uses), so
// it travels with the profile and needs no second store. A record names the AI and model the chat started
// with, the folder it answers in and the agent's own conversation id (`session`), which is what `--resume`
// takes. A live tab and its record are one row: the pane carries the record's id (`Pane.everyday`), never a
// copy of the record.
//
// Pure: read, upsert, rename and drop. The window saves what these return.

/** The settings key the list lives under. */
export const EVERYDAY_CHATS_FIELD = "everydayChats";

/** One kept Everyday chat. `name` is empty until the first message names it; `session` until the agent
 *  reports its conversation id. `model` and `effort` are the pair the chat last ran at, so reopening
 *  comes back on it. `at` is when it was last opened or used, so the newest row is first. */
export type EverydayChat = {
  id: string;
  name?: string;
  agent: string;
  model?: string;
  effort?: string;
  cwd: string;
  session?: string;
  at: number;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The kept chats, newest first. Anything malformed is dropped rather than drawn as a broken row: a record
 *  needs its id, its AI and its folder; a name and a session arrive later. */
export function readEverydayChats(s: Record<string, unknown>): EverydayChat[] {
  const raw = s[EVERYDAY_CHATS_FIELD];
  if (!Array.isArray(raw)) return [];
  const out: EverydayChat[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = text(r.id);
    const agent = text(r.agent);
    const cwd = text(r.cwd);
    if (!id || !agent || !cwd || seen.has(id)) continue;
    seen.add(id);
    const name = text(r.name);
    const model = text(r.model);
    const effort = text(r.effort);
    const session = text(r.session);
    out.push({
      id,
      ...(name === null ? {} : { name }),
      agent,
      ...(model === null ? {} : { model }),
      ...(effort === null ? {} : { effort }),
      cwd,
      ...(session === null ? {} : { session }),
      at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
    });
  }
  // Newest first; a saved order is by time, never by name.
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.at - a.c.at || a.i - b.i)
    .map((x) => x.c);
}

/** The kept chats from one settings value alone: the `saveSetting` functional form is handed one key's
 *  latest value, so a write made before the next render still builds on every chat kept so far. */
export function everydayChatsOf(prev: unknown): EverydayChat[] {
  return readEverydayChats({ [EVERYDAY_CHATS_FIELD]: prev });
}

/** A record for a chat about to start: no name and no session yet, both arrive from the chat itself. */
export function newEverydayChat(agent: string, cwd: string, model: string | null, now = Date.now()): EverydayChat {
  return { id: `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, agent, ...(model ? { model } : {}), cwd, at: now };
}

/** The list with `rec` added, or its same id replaced (newest first). Returns the same list when nothing
 *  changed, so a caller never writes settings for no reason. */
export function putEverydayChat(list: readonly EverydayChat[], rec: EverydayChat): EverydayChat[] {
  const i = list.findIndex((c) => c.id === rec.id);
  const next = i < 0 ? [rec, ...list] : list.map((c, at) => (at === i ? rec : c));
  return sameChats(list, next) ? (list as EverydayChat[]) : sortChats(next);
}

/** The list with one chat's conversation id written down; the same list when it already says so. */
export function setEverydaySession(list: readonly EverydayChat[], id: string, session: string): EverydayChat[] {
  if (!session) return list as EverydayChat[];
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== id || c.session === session) return c;
    changed = true;
    return { ...c, session };
  });
  return changed ? next : (list as EverydayChat[]);
}

/** The list with one chat's model and effort written down: a pick in the chat box applies to this
 *  conversation, and the row comes back on the same pair when it is opened again. A `null` model means
 *  the agent's own default, which is written as no model at all. The same list when nothing changed. */
export function setEverydayChoice(list: readonly EverydayChat[], id: string, pick: { model?: string | null; effort?: string | null }): EverydayChat[] {
  const rec = list.find((c) => c.id === id);
  if (!rec) return list as EverydayChat[];
  const model = pick.model === undefined ? rec.model : pick.model || undefined;
  const effort = pick.effort === undefined ? rec.effort : pick.effort || undefined;
  if (model === rec.model && effort === rec.effort) return list as EverydayChat[];
  const next: EverydayChat = { ...rec };
  if (model) next.model = model;
  else delete next.model;
  if (effort) next.effort = effort;
  else delete next.effort;
  return list.map((c) => (c.id === id ? next : c));
}

/** The list with one chat moved to the top: it was opened or used just now. */
export function touchEverydayChat(list: readonly EverydayChat[], id: string, now = Date.now()): EverydayChat[] {
  const rec = list.find((c) => c.id === id);
  if (!rec) return list as EverydayChat[];
  return [{ ...rec, at: now }, ...list.filter((c) => c.id !== id)];
}

/** The list with one chat named; the same list when the name is already that. An empty name is ignored. */
export function setEverydayName(list: readonly EverydayChat[], id: string, name: string): EverydayChat[] {
  const clean = name.trim();
  if (!clean) return list as EverydayChat[];
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== id || c.name === clean) return c;
    changed = true;
    return { ...c, name: clean };
  });
  return changed ? next : (list as EverydayChat[]);
}

/** The list without one chat; the same list when it held no such id. */
export function dropEverydayChat(list: readonly EverydayChat[], id: string): EverydayChat[] {
  const next = list.filter((c) => c.id !== id);
  return next.length === list.length ? (list as EverydayChat[]) : next;
}

/** The row's words: "New chat" until the first message names it. */
export const everydayChatName = (c: EverydayChat): string => c.name || "New chat";

const sortChats = (list: readonly EverydayChat[]): EverydayChat[] => [...list].sort((a, b) => b.at - a.at);

const sameChats = (a: readonly EverydayChat[], b: readonly EverydayChat[]): boolean =>
  a.length === b.length && a.every((c, i) => c.id === b[i].id && c.name === b[i].name && c.agent === b[i].agent && c.model === b[i].model && c.effort === b[i].effort && c.session === b[i].session && c.cwd === b[i].cwd && c.at === b[i].at);
