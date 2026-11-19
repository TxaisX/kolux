// VIEW-017 acceptance: the Agents rail's status word. MIRROR src/App.tsx:2777 (statusOf = rowStatus(p, chipFor(p)))
// and src/App.tsx:2299 (chipFor); a preset pane has `seats` (App.tsx addPreset).
import { expect, test } from "vitest";
import { chipOf } from "../../status/chip";
import { rowStatus } from "../rail";

const MIN = 60_000;
const now = 10_000 * MIN;
const chip = (over: Record<string, unknown>) => chipOf({ agent: "claude", running: true, stale: false, since: now - MIN, ...over } as never, now);

test("box 1 (label part): a working reading with no process left and no done signal reads Stopped, not Working", () => {
  expect(rowStatus({}, chip({ state: "working" })).word).toBe("Working");
  expect(rowStatus({}, chip({ state: "working", running: false })).word).toBe("Stopped");
  // a stale working reading is never Working either
  expect(rowStatus({}, chip({ state: "working", stale: true })).word).not.toBe("Working");
});

test("box 2: a preset that was never launched reads Not started", () => {
  const preset = { seats: [{ agent: "claude" }] };
  expect(rowStatus(preset, null).word).toBe("Not started");
  expect(rowStatus(preset, chip({ running: undefined })).word).toBe("Not started");
});
