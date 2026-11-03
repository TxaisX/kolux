// The Automations page rendered to HTML with no browser: each empty state is its own, a failed
// load offers Retry and never says nothing was created, and the first automation is selected
// with its runs below.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationsPage, { type Data } from "./AutomationsPage";

type Initial = NonNullable<Parameters<typeof AutomationsPage>[0]["initial"]>;
const render = (initial: Initial, o: { projects?: { id: string; name: string; path: string }[]; onClose?: () => void } = {}) =>
  renderToString(createElement(AutomationsPage, { projects: o.projects ?? [{ id: "p1", name: "shop", path: "C:\\src\\shop" }], agents: [], settings: {}, onSettings: () => {}, onClose: o.onClose, initial }));

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

// T-193-b: Hermes and OpenClaw jobs are listed as running on this computer.
const hermesRow = { id: "hermes:j1", jobId: "j1", source: "hermes" as const, local: true, name: "Nightly digest", prompt: "summarise the inbox", provider: "hermes", projectId: "", enabled: true, trigger: { kind: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" }, timetable: "Every day at 09:00 (UTC)", actions: ["run", "edit", "delete", "create", "pause", "resume"] };
const clawRow = { ...hermesRow, id: "openclaw:c1", jobId: "c1", source: "openclaw" as const, name: "Sweep", provider: "openclaw", enabled: false, actions: ["run", "delete", "pause", "resume"] };

test("T-193-b a Hermes row says it runs on this computer and has a pause switch", () => {
  const html = render({ data: { automations: [hermesRow], runs: [] }, open: "hermes:j1" });
  expect(html).toContain("Runs on this computer (Hermes)");
  expect(html).toContain('role="switch"');
  expect(html).toContain("Every day at 09:00 (UTC)");
  expect(html).not.toContain("If Kolux was away");
});

test("T-193-b a paused OpenClaw row reads Paused and carries the same label", () => {
  const html = render({ data: { automations: [clawRow], runs: [] }, open: "openclaw:c1" });
  expect(html).toContain("Runs on this computer (OpenClaw)");
  expect(html).toContain("Paused");
});

test("T-193-b a tool that is missing is one note above the list, never an error that hides the Kolux rows", () => {
  const warning = { id: "warning:hermes", kind: "warning" as const, source: "hermes" as const, warning: "hermes was not found on the PATH", name: "hermes", prompt: "", provider: "hermes", projectId: "", enabled: false, actions: [] };
  const html = render({ data: { automations: [{ id: "auto-1", name: "Kolux one", prompt: "p", provider: "claude", projectId: "p1", enabled: true }, warning], runs: [] } });
  expect(html.replace(/<!-- -->/g, "")).toContain("hermes was not found on the PATH. Its automations show here once that is fixed (install the tool, sign it in, or check its setup); then");
  expect(html).toMatch(/<button class="btn link" aria-label="Refresh automations"[^>]*>refresh<\/button>/); // T-694 (F10): the next step, not a bare line
  expect(html).toContain("Kolux one");
  expect(html).not.toContain("Automations could not be loaded");
  expect(html.match(/<tr /g)?.length).toBe(1);
});

test("T-193-b the agent filter lists Kolux agents only", () => {
  const html = render({ data: { automations: [hermesRow, clawRow, { id: "auto-1", name: "K1", prompt: "p", provider: "claude", projectId: "p1", enabled: true }, { id: "auto-2", name: "K2", prompt: "p", provider: "codex", projectId: "p1", enabled: true }], runs: [] } });
  const group = html.match(/aria-label="Agents">(.*?)<[/]span>/)?.[1] ?? "";
  expect(group).toContain(">claude<");
  expect(group).toContain(">codex<");
  expect(group).not.toMatch(/hermes|openclaw/i);
});

// UX audit 2: the opened page, menus, runs, errors, Close and Refresh.
test("UX2: the opened page shows the last action's note and the delete confirmation, and Edit and Delete in its header", () => {
  const html = render({ data: many, open: "auto-1", note: { text: "Run now: Nightly checks is queued" }, asking: "auto-1" });
  expect(html).toContain("Run now: Nightly checks is queued");
  expect(html).toContain("Delete Nightly checks?");
  expect(html).toContain("Its run history goes with it.");
  expect(html).toMatch(/<button class="btn"[^>]*>Edit<\/button>/);
  expect(html).toMatch(/<button class="btn"[^>]*>Delete<\/button>/);
});

test("UX2: a failing action reads as an alert, a good one as a status", () => {
  expect(render({ data: many, note: { text: "boom", bad: true } })).toMatch(/class="note warn" role="alert">boom/);
  expect(render({ data: many, note: { text: "fine" } })).toMatch(/class="note ok" role="status">fine/);
});

test("UX2: an open row menu has a backdrop to click outside of, and the dots say it is expanded", () => {
  const html = render({ data: many, menu: "auto-1" });
  expect(html).toContain('class="menu-backdrop"');
  expect(html).toContain('aria-expanded="true"');
  const shut = render({ data: many });
  expect(shut).not.toContain("menu-backdrop");
  expect(shut).not.toContain('aria-expanded="true"');
});

test("UX2: while Run now is being asked for, the button is disabled and says Starting, in the menu and in the page", () => {
  const html = render({ data: many, running: ["auto-1"], menu: "auto-1" });
  expect(html).toContain("Starting…");
  expect(html.split("disabled=\"\" title=\"Run now is already being started\"").length - 1).toBe(2); // the menu item and the page header
  const idle = render({ data: many });
  expect(idle).not.toContain("Starting…");
});

test("UX2: a failed runs read says so with Retry, and never No runs yet", () => {
  const html = render({ data: { automations: many.automations, runs: [], runsError: "the run history is unreadable" }, runs: true });
  expect(html).toContain("The runs could not be read");
  expect(html).toContain("the run history is unreadable");
  expect(html).toContain("Retry");
  expect(html).not.toContain("No runs yet");
});

test("UX2: every run row has a button that opens it, so the keyboard can reach it", () => {
  const html = render({ data: many, runs: true });
  expect(html).toContain('aria-label="Open run #1 of Nightly checks"');
  expect(html).toContain('aria-label="Open run #1 of On new PR"');
});

test("UX2: the bar has a Close button when the page can be closed, and Refresh shows busy", () => {
  expect(render({ data: many }, { onClose: () => {} })).toContain('aria-label="Close Automations"');
  expect(render({ data: many })).not.toContain('aria-label="Close Automations"');
  const busy = render({ data: many, refreshing: true });
  expect(busy).toMatch(/aria-label="Refresh" aria-busy="true" disabled=""/);
  expect(render({ data: many })).not.toContain('aria-busy="true"');
});

test("UX2: with no projects the bar and the empty state offer Add a project", () => {
  const html = render({ data: { automations: [], runs: [] } }, { projects: [] });
  expect(html.split(">Add a project</button>").length - 1).toBe(2);
  expect(html).toContain("none is added yet");
  expect(render({ data: many })).not.toContain("Add a project");
});

test("UX2: deleting a Hermes job says it is removed from Hermes itself", () => {
  const html = render({ data: { automations: [hermesRow], runs: [] }, open: "hermes:j1", asking: "hermes:j1" });
  expect(html).toContain("This removes the job from Hermes itself");
  expect(html).not.toContain("Its run history goes with it.");
});
