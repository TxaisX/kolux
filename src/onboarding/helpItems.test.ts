// T-248-c-rest (APP-010): the help menu's list, its three fixed web addresses, Copy terminal
// diagnostics and the Restart Kolux click that fires once.
import { describe, expect, it, vi } from "vitest";
import sheet from "./HelpSheet.tsx?raw";
import { PAGES } from "../settings/pages";
import { CHANGELOG_URL, copyDiagnostics, createRestart, DIAG_COPIED, DOCS_URL, GITHUB_URL, helpItems, HINTS, RESTARTING, TOURS_HINT, type HelpCtx } from "./helpItems";

/** Every action is a spy; `invoke` records what the three web links hand to the back end. */
function ctx(over: Partial<HelpCtx> = {}) {
  const invoke = vi.fn();
  const c = {
    milestones: { shown: true, done: 2, total: 6 },
    restarting: false,
    openSettings: vi.fn(),
    openExternal: (url: string) => invoke("open_external", { url }),
    openGuide: vi.fn(),
    openExplore: vi.fn(),
    reopenWizard: vi.fn(),
    requestFeedback: vi.fn(),
    reportCrash: vi.fn(),
    copyDiagnostics: vi.fn(),
    checkForUpdates: vi.fn(),
    restart: vi.fn(),
    ...over,
  } satisfies HelpCtx;
  return { c, invoke };
}
const label = (c: HelpCtx, id: string) => helpItems(c).find((i) => i.id === id)!;

describe("49-ux2 the help menu says what each entry is", () => {
  it("has a Report Crash row after Send Feedback that runs reportCrash", () => {
    const { c } = ctx();
    const ids = helpItems(c).map((i) => i.id);
    expect(ids.indexOf("report-crash")).toBe(ids.indexOf("feedback") + 1);
    label(c, "report-crash").run();
    expect(c.reportCrash).toHaveBeenCalledTimes(1);
  });
  it("tells the checklist from the wizard in visible text, and the tours' wait is no hover title", () => {
    const { c } = ctx();
    expect(label(c, "getting-started").hint).toBe(HINTS["getting-started"]);
    expect(label(c, "onboarding").hint).toBe(HINTS.onboarding);
    expect(HINTS["getting-started"]).not.toBe(HINTS.onboarding);
    expect(TOURS_HINT).toMatch(/screen is showing/);
    expect(sheet).not.toMatch(/title="Runs once/);
    expect(sheet).toMatch(/TOURS_HINT/);
  });
});

describe("APP-010 the help menu list", () => {
  it("has every named entry, in the card's order, Settings first", () => {
    const names = helpItems(ctx().c).map((i) => i.label);
    const card = ["Settings", "Docs", "Changelog", "GitHub", "Milestones", "Keyboard Shortcuts", "Onboarding", "Send Feedback", "Copy terminal diagnostics", "Check for Updates", "Restart Kolux"];
    expect(names.filter((n) => card.includes(n))).toEqual(card);
    expect(names[0]).toBe("Settings");
    expect(helpItems(ctx().c).find((i) => i.id === "settings")!.group).toBe("top");
    expect(helpItems(ctx().c).filter((i) => i.id !== "settings").every((i) => i.group === "help")).toBe(true);
  });

  it("drops Milestones once the core steps are done and keeps the rest", () => {
    const names = helpItems(ctx({ milestones: { shown: false, done: 6, total: 6 } }).c).map((i) => i.label);
    expect(names).not.toContain("Milestones");
    expect(names).toContain("Onboarding");
  });

  it("Docs, Changelog and GitHub hand a fixed https address to open_external", () => {
    const { c, invoke } = ctx();
    for (const id of ["docs", "changelog", "github"]) label(c, id).run();
    expect(invoke.mock.calls).toEqual([
      ["open_external", { url: DOCS_URL }],
      ["open_external", { url: CHANGELOG_URL }],
      ["open_external", { url: GITHUB_URL }],
    ]);
    expect(GITHUB_URL).toBe("https://github.com/TxaisX/kolux");
    expect(CHANGELOG_URL).toBe("https://github.com/TxaisX/kolux/releases");
    expect(DOCS_URL).toBe("https://github.com/TxaisX/kolux/tree/main/docs");
    for (const u of [DOCS_URL, CHANGELOG_URL, GITHUB_URL]) expect(u.startsWith("https://")).toBe(true);
  });

  it("Settings, Keyboard Shortcuts, Send Feedback, Check for Updates and Onboarding reach their own actions", () => {
    const { c } = ctx();
    label(c, "settings").run();
    label(c, "shortcuts").run();
    label(c, "feedback").run();
    label(c, "updates").run();
    label(c, "onboarding").run();
    label(c, "milestones").run();
    expect(c.openSettings).toHaveBeenNthCalledWith(1, "general");
    expect(c.openSettings).toHaveBeenNthCalledWith(2, "shortcuts");
    expect("shortcuts" in PAGES, "the Shortcuts page id exists").toBe(true);
    expect(c.requestFeedback).toHaveBeenCalledOnce();
    expect(c.checkForUpdates).toHaveBeenCalledOnce();
    expect(c.reopenWizard).toHaveBeenCalledOnce();
    expect(c.openGuide).toHaveBeenCalledOnce();
  });

  it("Copy terminal diagnostics and Restart keep the sheet open for their status line", () => {
    const { c } = ctx();
    expect(label(c, "diagnostics").keepOpen).toBe(true);
    expect(label(c, "restart").keepOpen).toBe(true);
    expect(label(c, "updates").keepOpen).toBeUndefined();
  });
});

describe("APP-010 Restart Kolux", () => {
  it("shows Restarting… and is disabled, so a click cannot reach it again", () => {
    const { c } = ctx({ restarting: true });
    const item = label(c, "restart");
    expect(item.label).toBe(RESTARTING);
    expect(item.disabled).toBe(true);
    expect(label(ctx().c, "restart").label).toBe("Restart Kolux");
  });

  it("fires the back end once however many times it is clicked, and shows the restarting state", () => {
    const call = vi.fn(() => new Promise<void>(() => {})); // the app is gone: it never answers
    const states: string[] = [];
    const go = createRestart(call, (s) => states.push(s), () => {});
    go();
    go();
    go();
    expect(call).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["restarting"]);
  });

  it("goes back to idle with the reason when the save point cancels it, and can be tried again", async () => {
    const call = vi.fn().mockRejectedValueOnce("The restart was cancelled: agent status could not be saved.").mockImplementation(() => new Promise<void>(() => {}));
    const states: string[] = [];
    const why: string[] = [];
    const go = createRestart(call, (s) => states.push(s), (w) => why.push(w));
    go();
    await new Promise((r) => setTimeout(r, 0));
    expect(states).toEqual(["restarting", "idle"]);
    expect(why[0]).toContain("cancelled");
    go();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("the sheet asks for app_restart, diag_summary and open_external by those names", () => {
    expect(sheet).toContain('invoke("app_restart")');
    expect(sheet).toContain('invoke<string>("diag_summary")');
    expect(sheet).toContain('invoke("open_external", { url })');
  });
});

describe("APP-010 Copy terminal diagnostics", () => {
  it("puts the back end's summary on the clipboard and says so", async () => {
    const clip = vi.fn().mockResolvedValue(undefined);
    const note = await copyDiagnostics(async () => "Kolux 0.1.0 diagnostics summary", clip);
    expect(clip).toHaveBeenCalledWith("Kolux 0.1.0 diagnostics summary");
    expect(note).toBe(DIAG_COPIED);
  });

  it("reports a failure instead of claiming a copy", async () => {
    const note = await copyDiagnostics(() => Promise.reject("no profile folder"), vi.fn());
    expect(note).toBe("Copy terminal diagnostics failed: no profile folder");
  });
});
