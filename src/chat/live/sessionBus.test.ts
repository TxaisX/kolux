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

test("a pane that holds the chat is not sent to itself, and another holder is found instead", () => {
  claimSession("ses_x", 1, vi.fn());
  claimSession("ses_x", 2, vi.fn());
  expect(holderOf("ses_x", 1)).not.toBeNull();
  releaseSession("ses_x", 2);
  expect(holderOf("ses_x", 1)).toBeNull();
});

test("review 2 P3-9: a deleted chat is matched on its folder whatever the case, slashes or trailing slash", () => {
  expect(sameFolder("C:\\Work\\Demo\\", "c:/work/demo")).toBe(true);
  expect(sameFolder("C:/work/demo", "C:/work/other")).toBe(false);
  const heard = vi.fn();
  onSessionDeleted(heard);
  announceDeleted({ cwd: "C:\\Work\\Demo", id: "ses_x", source: null });
  expect(heard).toHaveBeenCalledTimes(1);
});
