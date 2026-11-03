// 49-ux2 (lane C): the pure rules behind the onboarding fixes: the checklist's hide flag, the agent
// Open a session needs, the focus helper every dialog shares, the shortcut label, and the tour notice.
import { describe, expect, it, vi } from "vitest";
import { checklistHidden, HIDE_PATCH, legacyProfile } from "./guide";
import { followAgents, lastMain, NO_AGENT_WHY, sessionAgent } from "./sessionAgent";
import { enterDialog, isModal, isTopDialog, wrapTab } from "./dialogFocus";
import { submitKeys } from "./submitKeys";
import { tourNotice, type Want } from "./tour";
import { mainOff } from "./Wizard";
import { recordsHooks } from "./hooksOn";
import { failedNote } from "./StepPanels";
import { GH_LOGIN } from "./integrations";

const claude = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:/bin/claude" };

describe("row 1: the checklist's hide flag", () => {
  it("is its own key, not the legacy all-done one", () => {
    expect(HIDE_PATCH).toEqual({ setupChecklistHidden: true });
    expect(checklistHidden({ setupChecklistHidden: true })).toBe(true);
    expect(checklistHidden({})).toBe(false);
    expect(checklistHidden(null)).toBe(false);
    expect(legacyProfile({ setupChecklistHidden: true }, [])).toBe(false);
    expect(legacyProfile({ setupChecklist: false }, [])).toBe(true); // old profiles keep their meaning
  });
});

describe("row 3: Open a session needs an agent", () => {
  it("is null with no agent installed, and the wizard holds the button back with a reason", () => {
    expect(sessionAgent([], {})).toBeNull();
    expect(sessionAgent([{ ...claude, installed: false }], {})).toBeNull();
    expect(sessionAgent([claude], {})?.id).toBe("claude");
    expect(mainOff(3, true)).toBe(false); // never greyed out: with no agent it picks a folder (a plain terminal)
    expect(lastMain(true)).toBe("Pick a folder");
    expect(lastMain(false)).toBe("Open a session");
    expect(NO_AGENT_WHY).toMatch(/Settings > Agents/);
  });

  it("follows the agent list: an agent installed after the wizard opened counts, and the stop unsubscribes", async () => {
    let fire: (l: unknown) => void = () => {};
    const off = vi.fn();
    const seen: unknown[] = [];
    const stop = followAgents(() => Promise.resolve([]), (cb) => ((fire = cb), Promise.resolve(off)), (l) => seen.push(l));
    await Promise.resolve();
    fire([claude]);
    fire(null); // a malformed event changes nothing
    expect(seen).toEqual([[], [claude]]);
    stop();
    fire([]);
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(off).toHaveBeenCalled();
  });
});

describe("row 5: hooks consent only on an explicit move on", () => {
  it("a later skip records nothing", () => {
    const connect = [0, 1, 2, 3, 4].find((s) => recordsHooks(s, s + 1))!;
    expect(recordsHooks(connect, connect + 1)).toBe(true);
    expect(recordsHooks(connect, connect + 1, true)).toBe(false);
  });
});

describe("rows 7, 8: the dialogs take the focus and Escape works from anywhere", () => {
  it("a docked tip card (aria-modal=false) after the dialog does not take its Escape", () => {
    const modal = { getAttribute: (n: string) => (n === "aria-modal" ? "true" : null) };
    const tip = { getAttribute: (n: string) => (n === "aria-modal" ? "false" : null) };
    const list = [modal, tip].filter(isModal) as unknown as Element[];
    expect(isTopDialog(modal as unknown as Element, list)).toBe(true);
  });
  it("the floating workspace panel (role=dialog, no aria-modal) later on the page does not take Explore's Escape; a confirmation over it does", () => {
    const attrs = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null });
    const explore = attrs({ role: "dialog", "aria-modal": "true" });
    const floating = attrs({ role: "dialog" });
    const review = attrs({ role: "dialog", "aria-label": "Add review note" });
    const confirm = attrs({ role: "alertdialog" });
    const top = (list: ReturnType<typeof attrs>[]) => isTopDialog(explore as unknown as Element, list.filter(isModal) as unknown as Element[]);
    expect(top([explore, floating, review])).toBe(true);
    expect(top([explore, floating, confirm])).toBe(false);
  });
  it("Tab wraps at both ends and stays inside", () => {
    const [a, b, c] = ["a", "b", "c"];
    expect(wrapTab([a, b, c], c, false)).toBe(a);
    expect(wrapTab([a, b, c], a, true)).toBe(c);
    expect(wrapTab([a, b, c], b, false)).toBeNull(); // the browser moves inside the dialog
    expect(wrapTab([a, b, c], "outside", false)).toBe(a);
    expect(wrapTab([a, b, c], "outside", true)).toBe(c);
    expect(wrapTab([], a, false)).toBeNull();
  });
  const el = (id: string) => ({ id, focus: vi.fn() }) as unknown as Element & { focus: () => void };
  it("only the top dialog answers Escape", () => {
    const a = el("a");
    const b = el("b");
    expect(isTopDialog(b, [a, b])).toBe(true);
    expect(isTopDialog(a, [a, b])).toBe(false);
    expect(isTopDialog(null, [a])).toBe(false);
    expect(isTopDialog(a, [])).toBe(false);
  });
  it("focuses the dialog on open, closes on a window-level Escape, and gives the focus back", async () => {
    const root = el("root");
    const back = { isConnected: true, focus: vi.fn() };
    const listeners: Array<(e: Event) => void> = [];
    const win = { addEventListener: (_t: string, f: EventListenerOrEventListenerObject) => void listeners.push(f as (e: Event) => void), removeEventListener: vi.fn() };
    const close = vi.fn();
    const stop = enterDialog({ root, active: back, win, dialogs: () => [root], find: () => null }, close);
    expect(root.focus).toHaveBeenCalled();
    listeners[0]({ key: "Escape", stopPropagation() {}, preventDefault() {} } as unknown as Event);
    expect(close).toHaveBeenCalledTimes(1);
    listeners[0]({ key: "a", stopPropagation() {}, preventDefault() {} } as unknown as Event);
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(back.focus).toHaveBeenCalled();
    // An Escape typed in a terminal inside the dialog (a sign-in) is the terminal's.
    const l2: Array<(e: Event) => void> = [];
    const close2 = vi.fn();
    enterDialog({ root, active: null, win: { addEventListener: (_t: string, f: EventListenerOrEventListenerObject) => void l2.push(f as (e: Event) => void), removeEventListener() {} }, dialogs: () => [root], find: () => null, inTerminal: () => true }, close2);
    l2[0]({ key: "Escape", stopPropagation() {}, preventDefault() {} } as unknown as Event);
    expect(close2).not.toHaveBeenCalled();
    expect(win.removeEventListener).toHaveBeenCalled();
  });
});

describe("row 17: the shortcut label follows the platform", () => {
  it("is Ctrl+Enter on Windows and Cmd+Enter on a Mac", () => {
    expect(submitKeys("win32")).toEqual(["Ctrl", "Enter"]);
    expect(submitKeys("darwin")).toEqual(["Cmd", "Enter"]);
  });
});

describe("row 9: a tour replay that cannot start says why", () => {
  const forced: Want = { id: "tasks", forced: true, tries: 9, page: "p" };
  it("speaks for a forced replay that gave up or whose feature is off, and not for the rest", () => {
    expect(tourNotice("Tasks", forced, "miss", true, false)).toMatch(/needs its screen showing/);
    expect(tourNotice("Tasks", forced, "miss", false, false)).toBeNull();
    expect(tourNotice("Tasks", forced, "drop", false, true)).toMatch(/switched off in Settings/);
    expect(tourNotice("Tasks", forced, "drop", false, false)).toBeNull(); // the user moved on themselves
    expect(tourNotice("Tasks", { ...forced, forced: false }, "miss", true, false)).toBeNull(); // an automatic tour stays quiet
  });
});

describe("rows 12, 15: the error and connect words", () => {
  it("names what failed", () => {
    expect(failedNote(new Error("boom"))).toBe("Could not start a workspace: boom. Try again.");
    expect(failedNote("x")).toContain("x");
    expect(GH_LOGIN).toBe("gh auth login");
  });
});
