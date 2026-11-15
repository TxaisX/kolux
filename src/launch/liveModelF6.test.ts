// Job 13 F6: a remembered Grok or Cursor model that only the live model search lists is not dropped while that
// search is still running, so the seat comes back with its model and Start is on.
import { expect, test } from "vitest";
import { applyLineup, lineupOf, seatReady, setDiscovered } from "./seats";

const live = { agent: "cursor", model: "cursor-live-only" };

test("F6: before the live list is in, the remembered model stays; once it is in, a model it lacks is dropped", () => {
  const before = applyLineup(lineupOf("custom", "shared", [live] as never), ["cursor"]).seats[0];
  expect(before.model).toBe("cursor-live-only");
  expect(seatReady(before)).toBe(true);
  setDiscovered("cursor", [{ id: "cursor-live-only", label: "Live only" }]);
  expect(applyLineup(lineupOf("custom", "shared", [live] as never), ["cursor"]).seats[0].model).toBe("cursor-live-only");
  setDiscovered("grok", [{ id: "grok-a", label: "A" }]);
  expect(applyLineup(lineupOf("custom", "shared", [{ agent: "grok", model: "grok-gone" }] as never), ["grok"]).seats[0].model).toBeNull();
});
