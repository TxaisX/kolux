// Job 9 F15: while Kolux is still looking for agents, the empty Agents screen says so instead of "No agents yet.".
// Its New session button stays as job 11 left it.
import { expect, test } from "vitest";
import contentSrc from "./Content.tsx?raw";

test("F15: the empty Agents screen says Looking for agents… until the search ends", () => {
  expect(contentSrc).toContain('agentPass.looking ? "Looking for agents…" : "No agents yet. Start one to begin."');
  const block = contentSrc.slice(contentSrc.indexOf("<h2>Agents</h2>"), contentSrc.indexOf("New session", contentSrc.indexOf("<h2>Agents</h2>")));
  expect(block).toContain('<button className="btn primary" onClick={addChooser}>');
});
