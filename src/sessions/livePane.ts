// VIEW-088 (T-127-b): opening a past session that is still running focuses the pane it runs in
// instead of starting a second copy. A pane matches by the provider's session id; failing that,
// by its opening prompt when exactly one pane of that agent was started with the session's first
// prompt and has not reported an id of its own. Sleeping and retained panes are panes too: the
// caller passes every pane it keeps, not only the ones in view.

export type SeatLike = { key: number; agent: string; session?: string; typed?: string; kind?: string; seats?: unknown[] };

const words = (s: string): string => s.normalize("NFC").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** Whether a pane's opening line is the session's first prompt; a prompt cut with an ellipsis matches by its start. */
export function samePrompt(typed: string, prompt: string): boolean {
  const t = words(typed);
  const p = words(prompt);
  if (t === "" || p === "") return false;
  if (p.endsWith("…")) {
    const start = p.slice(0, -1).trimEnd();
    // A prompt that is only the cut marker has nothing to match by its start: it matches only a typed
    // line that is also just the marker. An empty prefix is not a wildcard.
    if (start === "") return t === p;
    return t.startsWith(start);
  }
  return t === p;
}

/** The key of the pane a listed session runs in, or null when no pane can be told to be it. */
export function livePane(panes: SeatLike[], s: { agent: string; id: string }, prompt: string | null): number | null {
  const agents = panes.filter((p) => !p.kind && !p.seats && p.agent === s.agent);
  const byId = agents.find((p) => p.session === s.id);
  if (byId) return byId.key;
  if (prompt === null) return null;
  const byPrompt = agents.filter((p) => !p.session && p.typed !== undefined && samePrompt(p.typed, prompt));
  return byPrompt.length === 1 ? byPrompt[0].key : null;
}
