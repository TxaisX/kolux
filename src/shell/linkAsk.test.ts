import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
import { answerLinks, dismissLinks, answerPatch, applyLinkState, askLink, ASKED_FIELD, dialogWords, dismissed, KOLUX_FIELD, linkState, needsAsk, readLinkState, siteOf, switchPatch, setSaver, waitingCount, waitingLink } from "./linkAsk";

const saved: Record<string, boolean>[] = [];
beforeEach(() => {
  saved.length = 0;
  setSaver((set) => (saved.push(set), Promise.resolve()));
  applyLinkState({});
  if (waitingCount()) answerLinks("system");
  saved.length = 0;
});

describe("TERM-135 rules", () => {
  it("asks only on a fresh profile and only for a click that names no destination", () => {
    expect(needsAsk(readLinkState({}), false)).toBe(true);
    expect(needsAsk(readLinkState({}), true)).toBe(false); // Shift or Alt with the link modifier
    expect(needsAsk(readLinkState({ [ASKED_FIELD]: true }), false)).toBe(false);
  });
  it("an answer saves the destination and marks it asked", () => {
    expect(answerPatch("system")).toEqual({ [KOLUX_FIELD]: false, [ASKED_FIELD]: true });
    expect(answerPatch("kolux")).toEqual({ [KOLUX_FIELD]: true, [ASKED_FIELD]: true });
  });
  it("turning the switch by hand counts as answered", () => {
    expect(switchPatch(true)).toEqual({ [KOLUX_FIELD]: true, [ASKED_FIELD]: true });
    expect(switchPatch(false)).toEqual({ [KOLUX_FIELD]: false, [ASKED_FIELD]: true });
  });
  it("shows the site, and offers keeping the Kolux browser when links already go there", () => {
    expect(siteOf("https://github.com/a/b?x=1")).toBe("github.com");
    const fresh = dialogWords({ inKolux: false, asked: false }, "https://example.org/p");
    expect([fresh.keep, fresh.other]).toEqual(["Kolux browser", "System browser"]);
    expect(fresh.lead).toContain("example.org");
    const kept = dialogWords({ inKolux: true, asked: false }, "https://example.org/p", true);
    expect([kept.keep, kept.other]).toEqual(["Keep the Kolux browser", "Use the system browser"]);
    expect(kept.tip).toContain("Shift with Cmd");
    expect(kept.tip).toContain("Terminal & sessions");
  });
  it("Escape or a click outside is the system browser", () => {
    expect(dismissed).toBe("system");
  });
});

describe("TERM-135 the one shared question", () => {
  it("takes plain clicks, shares one question, opens each waiting link with the answer and never asks again", () => {
    const opened: string[] = [];
    expect(askLink("https://a.test/1", false, (to) => opened.push(`a:${to}`))).toBe(true);
    expect(askLink("https://b.test/2", false, (to) => opened.push(`b:${to}`))).toBe(true);
    expect(waitingCount()).toBe(2);
    expect(waitingLink()).toBe("https://a.test/1");
    expect(askLink("https://c.test/3", true, () => opened.push("never"))).toBe(false); // Shift-click opens at once
    answerLinks("system");
    expect(opened).toEqual(["a:system", "b:system"]);
    expect(saved).toEqual([{ [KOLUX_FIELD]: false, [ASKED_FIELD]: true }]);
    expect(waitingLink()).toBeNull();
    expect(askLink("https://d.test/4", false, () => {})).toBe(false); // answered: no dialog, also after a restart
    applyLinkState({ [KOLUX_FIELD]: false, [ASKED_FIELD]: true }); // what a restart reads back
    expect(askLink("https://d.test/4", false, () => {})).toBe(false);
  });
  it("a switch set by hand (settings read back) stops the dialog", () => {
    applyLinkState(switchPatch(true));
    expect(linkState()).toEqual({ inKolux: true, asked: true });
    expect(askLink("https://e.test", false, () => {})).toBe(false);
  });
  it("dismissing opens the waiting links in the system browser once, saves nothing and asks again next time", () => {
    const opened: string[] = [];
    expect(askLink("https://f.test/1", false, (to) => opened.push(to))).toBe(true);
    dismissLinks();
    expect(opened).toEqual(["system"]);
    expect(saved).toEqual([]); // no permanent answer written
    expect(linkState().asked).toBe(false);
    expect(waitingLink()).toBeNull();
    expect(askLink("https://f.test/2", false, () => {})).toBe(true); // the question comes back
  });
});
