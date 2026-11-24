// AUD-S2 / S2-F02: a new workspace opens the session chooser (src/launch/ChooserPane.tsx), so
// startProve must pick Terminal and press Start the way startPlain does before it waits for a
// Claude pane. It does not, and every scenario() proof stops with
// "timed out after 30000 ms waiting for the first shell pane" instead of starting its agent.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const src = read("scripts/prove/live-common.mjs");
const at = src.indexOf("export async function startProve");
const next = src.indexOf("\nexport ", at + 10);
const body = at === -1 ? "" : src.slice(at, next === -1 ? undefined : next);

describe("audit S2 > live-common startProve", () => {
  it("[S2-F02] startProve answers the session chooser before it waits for a pane", () => {
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('waitFor("the first shell pane"');
    expect(
      body,
      "a fresh workspace shows the session chooser; startProve must pick Terminal (TID.seatTerminal) and press Start (TID.chooserStart) as startPlain does",
    ).toMatch(/TID\.(chooser|chooserStart|seats|seatTerminal)\b/);
  });
});
