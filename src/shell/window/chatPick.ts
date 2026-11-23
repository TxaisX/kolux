import type { Pane } from "../../App";

/** A model or effort picked inside a chat (2026-11-21), written on the pane itself so the layout saved at
 *  quit carries the last pick and a restored tab comes back on it. A `null` model is the agent's own
 *  default, which is stored as no model at all. The same list when nothing changed. */
export function withChatPick(panes: readonly Pane[], key: number, pick: { model?: string | null; effort?: string }): Pane[] {
  return panes.map((x) => {
    if (x.key !== key) return x;
    const next: Pane = { ...x };
    if (pick.model !== undefined) {
      if (pick.model) next.chatModel = pick.model;
      else delete next.chatModel;
    }
    if (pick.effort !== undefined) {
      if (pick.effort) next.chatEffort = pick.effort;
      else delete next.chatEffort;
    }
    return next.chatModel === x.chatModel && next.chatEffort === x.chatEffort ? x : next;
  }) as Pane[];
}
