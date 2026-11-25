import { beforeEach, expect, test, vi } from "vitest";
import { announceDeleted, claimSession, holderOf, onSessionDeleted, releaseSession, resetSessionBus, sameFolder } from "./sessionBus";

beforeEach(() => resetSessionBus());

test("review 2 P3-9: two panes on one chat - closing one does not release it while the other still holds it", () => {
  const a = vi.fn();
  const b = vi.fn();
  claimSession("ses_x", 1, a);
  claimSession("ses_x", 2, b);
  releaseSession("ses_x", 2);
  // Pane 1 still holds it, so a third pane is still sent there.
  expect(holderOf("ses_x", 3)).not.toBeNull();
  holderOf("ses_x", 3)!.focus();
  expect(a).toHaveBeenCalledTimes(1);
  releaseSession("ses_x", 1);
  expect(holderOf("ses_x", 3)).toBeNull();
});

test("round 3 P3: a pane that holds the chat is not sent to itself, and the other holder is found instead (newest claim is the asking pane's own)", () => {
  const first = vi.fn();
  const second = vi.fn();
  claimSession("ses_x", 2, first);
  claimSession("ses_x", 1, second); // pane 1 claimed last: with one holder per chat, only pane 1 would be known
  expect(holderOf("ses_x", 1)?.paneKey).toBe(2);
  expect(holderOf("ses_x", 2)?.paneKey).toBe(1);
  releaseSession("ses_x", 2);
  expect(holderOf("ses_x", 1)).toBeNull();
  expect(holderOf("ses_x", 2)?.paneKey).toBe(1);
});

test("review 2 P3-9: folders match whatever the case, slashes or trailing slash", () => {
  expect(sameFolder("C:\\Work\\Demo\\", "c:/work/demo")).toBe(true);
  expect(sameFolder("C:/work/demo", "C:/work/other")).toBe(false);
});

test("round 3 P3: a deleted chat is announced to every hearer with its folder, and every pane holding it lets it go", () => {
  const heard = vi.fn();
  const alsoHeard = vi.fn();
  onSessionDeleted(heard);
  onSessionDeleted(alsoHeard);
  claimSession("ses_x", 1, vi.fn());
  claimSession("ses_x", 2, vi.fn());
  claimSession("ses_y", 3, vi.fn());
  // both panes are known holders before the news
  expect(holderOf("ses_x", 1)?.paneKey).toBe(2);
  expect(holderOf("ses_x", 2)?.paneKey).toBe(1);
  announceDeleted({ cwd: "C:\\Work\\Demo", id: "ses_x", source: 1 });
  expect(heard).toHaveBeenCalledWith({ cwd: "C:\\Work\\Demo", id: "ses_x", source: 1 });
  expect(alsoHeard).toHaveBeenCalledTimes(1);
  // neither holder of the deleted chat is left, whichever pane asks; another chat's holder is untouched
  expect(holderOf("ses_x", 9)).toBeNull();
  expect(holderOf("ses_x", 1)).toBeNull();
  expect(holderOf("ses_x", 2)).toBeNull();
  expect(holderOf("ses_y", 9)?.paneKey).toBe(3);
  // a pane letting go of the deleted chat afterwards changes nothing
  releaseSession("ses_x", 1);
  expect(holderOf("ses_x", 9)).toBeNull();
});
