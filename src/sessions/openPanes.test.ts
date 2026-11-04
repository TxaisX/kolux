// C28-R5-01: a pane resumed from History used to record no session id, so nothing stood between a
// History Delete and the transcript the agent was writing (Rust's live guard reads only what a hook
// reported, and a resumed pane has not been reported in that window, or ever without hooks). The id
// now goes on the pane at once, and the window tells the delete which sessions its panes hold.
import { expect, test } from "vitest";
import { livePane } from "./livePane";
import { openSessions } from "./openPanes";
import { resumedFields } from "./resume";

const id = "a489d9fb-1111-2222-3333-444455556666";

test("C28-R5-01: a pane resumed from History carries the session's id at once", () => {
  const pane = { key: 7, agent: "claude", ...resumedFields(id) };
  expect(livePane([pane], { agent: "claude", id }, null)).toBe(7); // the guard sees it with no hook reported
  const noId = { key: 8, agent: "claude", ...resumedFields(undefined) };
  expect(livePane([noId], { agent: "claude", id }, null)).toBeNull();
  // A carried or new start is unchanged, and a resume with no id keeps the old shape.
  expect(resumedFields(undefined)).toEqual({ resumed: true });
  expect(resumedFields(id)).toEqual({ session: id, resumed: true });
});

test("C28-R5-01: the open list names every pane's session by its mark and its catalogue id", () => {
  const panes = [
    { key: 1, agent: "claude", agentId: "claude", session: "s-1" },
    { key: 2, agent: "claude", agentId: "claude-agent-teams", session: "s-2" }, // a mark that differs from the id
    { key: 3, agent: "codex", agentId: "codex" }, // no session yet: nothing to hold
    { key: 4, agent: "shell", session: "s-4" },
  ];
  expect(openSessions(panes)).toEqual([
    ["claude", "s-1"],
    ["claude", "s-2"],
    ["claude-agent-teams", "s-2"],
    ["shell", "s-4"],
  ]);
  expect(openSessions([])).toEqual([]);
});
