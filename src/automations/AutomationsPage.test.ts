// The Automations page rendered to HTML with no browser: each empty state is its own, a failed
// load offers Retry and never says nothing was created, and the first automation is selected
// with its runs below.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationsPage, { type Data } from "./AutomationsPage";

const render = (initial: { data?: Data; error?: string; runs?: boolean; open?: string }) =>
  renderToString(createElement(AutomationsPage, { projects: [{ id: "p1", name: "shop", path: "C:\\src\\shop" }], agents: [], settings: {}, onSettings: () => {}, initial }));

test("a failed load is an error with Retry, not a nothing-created message", () => {
  const html = render({ error: "the saved automations could not be read" });
  expect(html).toContain("Automations could not be loaded");
  expect(html).toContain("Retry");
  expect(html).not.toContain("No automations yet");
});

test("nothing created yet has its own empty state", () => {
  const html = render({ data: { automations: [], runs: [] } });
  expect(html).toContain("No automations yet");
  expect(html).not.toContain("Retry");
  expect(html).toContain("New Automation");
  expect(html).toContain("Runs");
});

test("opening the page selects the first automation in sort order and shows its numbered runs", () => {
  const data: Data = {
    automations: [
      { id: "auto-2", name: "Report 10", prompt: "weekly report", provider: "claude", projectId: "p1", enabled: true },
      { id: "auto-1", name: "Report 2", prompt: "nightly checks", provider: "claude", projectId: "p1", enabled: false },
    ],
    runs: [{ id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "dispatched", at: Date.now() }],
  };
  const html = render({ data });
  expect(html.indexOf("Report 2")).toBeLessThan(html.indexOf("Report 10"));
  expect(html).toMatch(/aria-selected="true"[^>]*>.*?Report 2/);
  expect(html).toContain("nightly checks");
  expect(html).toContain("#<!-- -->1");
  expect(html).toContain("by hand");
  expect(html).not.toContain('role="menu"'); // no row's menu is open
});

const many: Data = {
  automations: [
    { id: "auto-1", name: "Nightly checks", prompt: "", provider: "claude", projectId: "p1", enabled: true },
    { id: "auto-2", name: "On new PR", prompt: "", provider: "claude", projectId: "p1", enabled: true, trigger: { kind: "event", event: "pr-opened" } },
  ],
  runs: [
    { id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "failed", at: Date.now() - 60000, detail: "claude did not start" },
    { id: "run-2", automationId: "auto-2", number: 1, trigger: "event", status: "completed", at: Date.now() - 120000 },
  ],
};

test("AUTO-015: Runs opens one table of every automation's runs, with tiles and the event named on hover", () => {
  const html = render({ data: many, runs: true });
  expect(html).toContain("Nightly checks");
  expect(html).toContain("On new PR");
  expect(html).toContain('title="When a pull request opens"');
  expect(html).toMatch(/<b>1<\/b> succeeded in 24 h/);
  expect(html).toMatch(/<b>1<\/b> failed in 7 days/);
  expect(html).toContain("Automations</button>");
  expect(html).not.toContain("New Automation");
});

test("AUTO-015: with no runs at all the dashboard says so plainly", () => {
  const html = render({ data: { automations: many.automations, runs: [] }, runs: true });
  expect(html).toContain("No runs yet");
});

test("AUTO-015: the Runs button is live on the Automations page", () => {
  const html = render({ data: many });
  expect(html).toMatch(/<button class="btn" title="Every automation&#x27;s runs in one place">Runs<\/button>/);
});

test("with no automations yet, four template cards and a blank choice appear (AUTO-006)", () => {
  const html = render({ data: { automations: [], runs: [] } });
  for (const name of ["Weekday repo audit", "Weekly release check", "Daily review", "Hourly upkeep", "Start from blank"]) expect(html).toContain(name);
});

test("the overview: timetable, upcoming, worktree, agent, run count and a paused marker, with Runs as a second tab (AUTO-018)", () => {
  const data: Data = {
    automations: [{ id: "auto-1", name: "Nightly", prompt: "audit", provider: "claude", projectId: "p1", enabled: false, workspaceMode: "existing", workspace: "C:/src/shop", trigger: { kind: "schedule", cron: "0 2 * * *" }, timetable: "Every day at 02:00 (UTC)" }],
    runs: [{ id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "completed", at: Date.now() }],
  };
  const html = render({ data });
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Overview/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Runs/);
  expect(html).toContain("Every day at 02:00 (UTC)");
  expect(html).toMatch(/Runs<\/dt><dd>1<\/dd>/);
  expect(html).toContain(">Paused<");
  expect(html).toContain(">shop<");
});

test("history that failed to load reads unknown, never 0; an opened automation has its breadcrumb (AUTO-017, AUTO-018)", () => {
  const data: Data = { automations: [{ id: "auto-1", name: "Nightly", prompt: "audit", provider: "claude", projectId: "p1", enabled: true }], runs: [], runsError: "the saved runs could not be read" };
  const html = render({ data, open: "auto-1" });
  expect(html).toMatch(/Runs<\/dt><dd>unknown<\/dd>/);
  expect(html).toMatch(/<nav[^>]*aria-label="Breadcrumb"/);
  expect(html).toMatch(/aria-current="page"[^>]*>Nightly/);
  expect(html).not.toContain("autos-table"); // the opened automation fills the page
});

test("a long prompt starts folded behind an expand control; a short one is shown whole (AUTO-018)", () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const html = render({ data: { automations: [{ id: "auto-1", name: "Long", prompt: long, provider: "claude", projectId: "p1", enabled: true }], runs: [] } });
  expect(html).toContain("Show the whole prompt");
  expect(html).toMatch(/class="autos-prompt folded"/);
  expect(render({ data: { automations: [{ id: "auto-1", name: "Short", prompt: "audit", provider: "claude", projectId: "p1", enabled: true }], runs: [] } })).not.toContain("Show the whole prompt");
});

test("AUTO-013: the Runs tab is a list to step through; a failed run offers Rerun, a gone worktree its snapshot, and unread history a way to try again", () => {
  const data: Data = {
    automations: [{ id: "auto-1", name: "Nightly checks", prompt: "", provider: "claude", projectId: "p1", enabled: true }],
    runs: [
      { id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "failed", at: Date.now() - 60000, detail: "claude did not start" },
      { id: "run-2", automationId: "auto-1", number: 2, trigger: "schedule", status: "completed", at: Date.now(), worktree: "C:/gone", worktreeName: "nightly-2", worktreeGone: true },
    ],
  };
  const html = render({ data, open: "auto-1" });
  expect(html).toContain('role="listbox"');
  expect(html.match(/role="option"/g)?.length).toBe(2);
  expect(html).toContain("Rerun");
  expect(html).toContain("Saved output");
  const broken = render({ data: { ...data, runs: [], runsError: "the saved runs could not be read" }, open: "auto-1" });
  expect(broken).toContain("Try again");
  expect(broken).not.toContain("No runs yet");
});
