// C28-R5-01: a session a pane holds must not be deleted under it. Rust alone cannot tell: its live
// guard reads the transcript a hook reported, and a pane resumed from History has not been reported
// by any hook yet (or never is, with hooks not installed). The window knows, so it sends the pairs of
// (agent, session) every pane holds, and the delete refuses them.

type Held = { agent: string; agentId?: string; session?: string };

/**
 * The (agent, session) pairs of the panes that hold a session, as `session_delete` reads them.
 * A pane is named by its mark and by its catalogue id: a session row names its agent the way the
 * agent reports it, and a pane's mark can differ (Claude Agent Teams runs as `claude`).
 */
export function openSessions(panes: readonly Held[]): [string, string][] {
  const out: [string, string][] = [];
  for (const p of panes) {
    if (!p.session) continue;
    out.push([p.agent, p.session]);
    if (p.agentId && p.agentId !== p.agent) out.push([p.agentId, p.session]);
  }
  return out;
}
