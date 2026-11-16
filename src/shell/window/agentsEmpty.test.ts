// Job 9 F15: while Kolux is still looking for agents, the empty Agents screen says so instead of "No agents yet.".
// Its button stays as job 11 left it; job 50 renamed it Start agents.
import { expect, test } from "vitest";
import contentSrc from "./Content.tsx?raw";

test("F15: the empty Agents screen says Looking for agents… until the search ends", () => {
  expect(contentSrc).toContain('agentPass.looking ? "Looking for agents…" : "No agents yet. Start one to begin."');
  const block = contentSrc.slice(contentSrc.indexOf("<h2>Agents</h2>"), contentSrc.indexOf("Start agents", contentSrc.indexOf("<h2>Agents</h2>")));
  expect(block).toContain('<button className="btn primary" onClick={addChooser}>');
  expect(block.length, "the Agents block reaches its Start agents button").toBeLessThan(600);
});
