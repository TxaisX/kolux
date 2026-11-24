import type { Pane } from "../../App";

// What a chat pane's record keeps besides its model: who chose its name, and which conversation it is on.
// Pure list changes; the window writes what they return. The same list comes back when nothing changed.

/** A name the user chose (the tab menu, the sidebar, the rename key): marked, so the chat's own names never replace it.
 *  Clearing the name clears the mark, and the chat names itself again. */
export function withUserTitle(panes: readonly Pane[], key: number, title: string | undefined): Pane[] {
  return panes.map((x) => {
    if (x.key !== key) return x;
    const next: Pane = { ...x, title };
    if (title) next.titleByUser = true;
    else delete next.titleByUser;
    return next;
  });
}

/** A name the chat gave itself (its first message, then the history column's title). Never over a user's name.
 *  `null` takes the automatic name away: the chat it named has been left (New chat, or another chat opened). */
export function withAutoTitle(panes: readonly Pane[], key: number, title: string | null): Pane[] {
  const at = panes.find((x) => x.key === key);
  if (!at || at.titleByUser || (at.title ?? null) === title) return panes as Pane[];
  return panes.map((x) => {
    if (x.key !== key) return x;
    const next: Pane = { ...x };
    if (title === null) delete next.title;
    else next.title = title;
    return next;
  });
}

/** The conversation a chat pane is on, so a restart reopens it. `legacy` is the older Claude conversation this
 *  one continues: kept in its own field so its read-only transcript still shows above the new chat. A `null`
 *  id (a new chat) forgets both. */
export function withChatSession(panes: readonly Pane[], key: number, id: string | null, legacy: string | null): Pane[] {
  const at = panes.find((x) => x.key === key);
  if (!at) return panes as Pane[];
  const resume = id ?? undefined;
  const old = id === null ? undefined : (legacy ?? undefined);
  if (at.chatResume === resume && at.chatLegacy === old) return panes as Pane[];
  return panes.map((x) => {
    if (x.key !== key) return x;
    const next: Pane = { ...x };
    if (resume) next.chatResume = resume;
    else delete next.chatResume;
    if (old) next.chatLegacy = old;
    else delete next.chatLegacy;
    return next;
  });
}
