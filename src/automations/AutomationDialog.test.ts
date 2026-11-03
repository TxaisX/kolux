// The automation dialog rendered to HTML with no browser: a new one opens on the weekday preset with
// the keep-going note, and Save stays off until the project's worktrees are read (AUTO-005).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationDialog, { saveHint, setupChoice, unsaved, WorktreeError } from "./AutomationDialog";
import { canDo, EVENT_CHOICES, hermesSchedule, rowActions, type Automation } from "./model";
import { templates } from "./timetable";

const projects = [{ id: "p1", name: "shop", path: "C:\\src\\shop", base: "main" }];
const render = (editing: Automation | null) => renderToString(createElement(AutomationDialog, { projects, agents: [], editing, onClose: () => {}, onSaved: () => {} }));

test("a new automation opens on Monday to Friday with Save held until the worktrees are read", () => {
  const html = render(null);
  expect(html).toContain("New Automation");
  expect(html).toContain("keeps running on this timetable until you pause it");
  expect(html).toMatch(/<option value="weekdays" selected="">Monday to Friday/);
  expect(html).toMatch(/<button class="btn primary" disabled=""[^>]*>Save/);
  expect(html).toContain('aria-modal="true"');
});

test("editing opens with the saved copy: its name, prompt, base and custom line", () => {
  const html = render({
    id: "auto-1",
    name: "Leap",
    prompt: "check the calendar",
    provider: "codex",
    projectId: "p1",
    enabled: true,
    workspaceMode: "new-per-run",
    baseBranch: "release",
    trigger: { kind: "schedule", cron: "0 0 29 2 *", timezone: "UTC" },
    form: { preset: "custom", time: "", day: null, custom: "0 0 29 2 *" },
  });
  expect(html).toContain("Edit automation");
  expect(html).toContain('value="Leap"');
  expect(html).toContain("check the calendar");
  expect(html).toContain('value="release"');
  expect(html).toContain('value="0 0 29 2 *"');
  expect(html).toContain('value="UTC"');
});

test("the clock time is an hour box, a minute box and AM or PM; hourly keeps only the minutes (AUTO-003)", () => {
  const html = render(null);
  expect(html).toContain('aria-label="Hour"');
  expect(html).toContain('aria-label="Minute"');
  expect(html).toMatch(/<option value="AM" selected="">AM/);
  expect(html).toContain('value="9"');
  const hourly = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, form: { preset: "hourly", time: "00:15", day: null, custom: "" } });
  expect(hourly).not.toContain('aria-label="Hour"');
  expect(hourly).toContain('aria-label="Minute"');
  expect(hourly).toContain('value="15"');
  expect(hourly).not.toContain("AM or PM");
});

test("a custom line shows the five field chips (AUTO-002)", () => {
  const html = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, form: { preset: "custom", time: "", day: null, custom: "30 10 * * 2" } });
  expect(html.match(/class="chip"/g)).toHaveLength(5);
  expect(html).toContain("day of the week");
});

test("a template fills the new automation's form and the header offers the templates again (AUTO-006)", () => {
  const html = renderToString(createElement(AutomationDialog, { projects, agents: [], editing: null, template: templates[3], onClose: () => {}, onSaved: () => {} }));
  expect(html).toContain('value="Hourly upkeep"');
  expect(html).toMatch(/<option value="hourly" selected="">/);
  expect(html).toContain('value="15"');
  expect(html).toContain("Templates");
  // T-192-b: the template's grace window is filled in too (30 minutes for hourly upkeep).
  expect(html).toMatch(/<option value="30" selected="">Start it up to 30 minutes late/);
});

test("a precheck command and its 1, 2, 5 or 10 minute limit, run only ahead of timed runs (AUTO-008)", () => {
  const fresh = render(null);
  expect(fresh).toContain("Precheck command");
  expect(fresh).toMatch(/<option value="60" selected="">1 minute/);
  expect(fresh).toContain("never ahead of Run now");
  const html = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, precheck: "git diff --quiet", precheckTimeoutSeconds: 300, form: { preset: "hourly", time: "00:15", day: null, custom: "" } });
  expect(html).toContain('value="git diff --quiet"');
  expect(html).toMatch(/<option value="300" selected="">5 minutes/);
});

test("AUTO-004: an automation started by an event opens on Event with no timetable to fill in", () => {
  const html = render({ id: "auto-2", name: "Review PRs", prompt: "review it", provider: "claude", projectId: "p1", enabled: true, workspaceMode: "existing", trigger: { kind: "event", event: "pr-opened" } });
  expect(html).toMatch(/<option value="pr-opened" selected="">When a pull request opens/);
  expect(html).not.toContain("Time zone");
  expect(html).toContain("keeps running on each event until you pause it");
  // A new one starts on a timetable.
  expect(render(null)).toMatch(/<option value="schedule" selected="">On a timetable/);
});

test("AUTO-010: the setup choice shows only for a new worktree per run in a project with a setup", () => {
  expect(setupChoice("new-per-run", true, true)).toBe(true);
  expect(setupChoice("new-per-run", true, false)).toBe(false);
  expect(setupChoice("new-per-run", false, true), "no setup at all: no option").toBeNull();
  expect(setupChoice("new-per-run", null, true), "not known yet: no option").toBeNull();
  expect(setupChoice("existing", true, true), "an existing worktree never runs setup again").toBeNull();
  expect(render(null)).not.toContain("Run the project setup");
});

test("T-192-c: the keep-one-session choice shows for an existing worktree only and reopens as saved", () => {
  const saved = (reuseSession: boolean, workspaceMode: "existing" | "new-per-run"): Automation => ({ id: "auto-1", name: "Leap", prompt: "go", provider: "claude", projectId: "p1", enabled: true, workspaceMode, reuseSession });
  const say = "Continue in the session the last run left open";
  expect(render(null)).toContain(say);
  expect(render(null)).not.toMatch(/type="checkbox" checked=""[^>]*\/> Continue/);
  expect(render(saved(true, "existing"))).toMatch(/type="checkbox" checked=""[^>]*\/> Continue/);
  expect(render(saved(true, "new-per-run")), "a new worktree for every run always opens a new session").not.toContain(say);
});

test("T-085-f: the dialog offers pull request opens, checks fail and an agent finishes, each with its own note", () => {
  const fresh = render(null);
  for (const [value, label] of [["pr-opened", "When a pull request opens"], ["checks-failed", "When checks fail"], ["agent-finished", "When an agent finishes"]]) {
    expect(fresh).toContain(`<option value="${value}">${label}</option>`);
  }
  expect(EVENT_CHOICES.map((c) => c.value)).toEqual(["pr-opened", "checks-failed", "agent-finished"]);
  const row = (event: "pr-opened" | "checks-failed" | "agent-finished"): Automation => ({ id: "auto-3", name: "On event", prompt: "look", provider: "claude", projectId: "p1", enabled: true, workspaceMode: "existing", trigger: { kind: "event", event } });
  const red = render(row("checks-failed"));
  expect(red).toMatch(/<option value="checks-failed" selected="">When checks fail/);
  expect(red).toContain("go from pending to failing");
  expect(red).not.toContain("Time zone");
  const done = render(row("agent-finished"));
  expect(done).toMatch(/<option value="agent-finished" selected="">When an agent finishes/);
  expect(done).toContain("finishes its turn");
  expect(done).not.toContain("go from pending to failing");
  expect(render(row("pr-opened"))).toContain("A pull request opened from one of this project");
});

// T-193-b: the Kolux / Hermes switch. A Hermes job needs a cron timetable and none of Kolux's agent, session, event or precheck settings.
const hermesJob: Automation = { id: "hermes:j1", jobId: "j1", source: "hermes", local: true, name: "Nightly digest", prompt: "summarise the inbox", provider: "hermes", projectId: "", enabled: true, trigger: { kind: "schedule", cron: "0 9 * * *", timezone: "UTC" }, form: { preset: "daily", time: "09:00", day: null, custom: "" }, actions: ["run", "edit", "delete", "create", "pause", "resume"] };

test("T-193-b a new automation offers the Kolux / Hermes switch, on Kolux with the agent settings", () => {
  const html = render(null);
  expect(html).toContain("Runs in");
  expect(html).toMatch(/<option value="kolux" selected="">Kolux/);
  expect(html).toContain("Hermes");
  expect(html).toContain("Precheck command");
  expect(html).toContain("Continue in the session");
});

test("T-193-b a Hermes job opens on Hermes with its own name, prompt and timetable: a timetable, no agent, session reuse, event trigger, precheck or time zone", () => {
  expect(canDo(hermesJob, "edit")).toBe(true);
  expect(rowActions(hermesJob)).toEqual(["run", "toggle", "edit", "delete"]);
  const html = render(hermesJob);
  expect(html).toContain("Edit automation");
  expect(html).toContain('value="Nightly digest"');
  expect(html).toContain("summarise the inbox");
  expect(html).toContain("Cron timetable");
  expect(html).toMatch(/<option value="daily" selected="">/);
  expect(html).toContain("Hermes keeps this job");
  expect(html).not.toContain("Runs in");
  for (const gone of [">Agent<", "Continue in the session", "Precheck command", "Precheck time limit", "When a pull request opens", "If Kolux was away", "Workspace", "Work folder", "Time zone"]) expect(html).not.toContain(gone);
});

test("T-193-b editing a Hermes job with a cron line the presets cannot say opens it in Custom, not on the default timetable", () => {
  const job: Automation = { ...hermesJob, trigger: { kind: "schedule", cron: "*/30 * * * *", timezone: "UTC" }, form: { preset: "custom", time: "", day: null, custom: "*/30 * * * *" } };
  const html = render(job);
  expect(html).toMatch(/<option value="custom" selected="">/);
  expect(html).toContain('value="*/30 * * * *"');
  expect(html).not.toMatch(/<option value="weekdays" selected="">/);
});

test("T-193-b a Hermes job whose timetable is not cron shows it as text and offers no timetable fields to change", () => {
  const job: Automation = { ...hermesJob, trigger: { kind: "schedule", cron: "", timezone: "" }, form: undefined, timetable: "every 120m" };
  const html = render(job);
  expect(html).toContain("every 120m");
  expect(html).toContain("Hermes keeps this timetable");
  expect(html).not.toContain("Cron timetable");
  expect(html).not.toContain("Cron line or RRULE");
  expect(html).not.toContain('aria-label="Hour"');
  expect(html).not.toMatch(/<button class="btn primary" disabled=""/);
});

test("T-193-b the time zone field is hidden when Hermes is the target and shown for a Kolux automation", () => {
  expect(render(hermesJob)).not.toContain("Time zone");
  expect(render({ ...hermesJob, id: "auto-9", source: undefined, provider: "claude", projectId: "p1" })).toContain("Time zone");
  expect(render(null)).toContain("Time zone");
});

test("T-193-b hermesSchedule takes a five-field cron line and refuses an RRULE or a short line", () => {
  expect(hermesSchedule("0 9 * * 1-5")).toBe("0 9 * * 1-5");
  expect(hermesSchedule("  0   9 * * 1-5 ")).toBe("0 9 * * 1-5");
  expect(hermesSchedule("RRULE:FREQ=DAILY")).toBe(null);
  expect(hermesSchedule("0 9 * *")).toBe(null);
  expect(hermesSchedule("")).toBe(null);
});

test("UX2: Templates are offered for a new automation and hidden when editing a saved one", () => {
  expect(render(null)).toContain(">Templates<");
  const saved: Automation = { id: "auto-1", name: "Leap", prompt: "p", provider: "claude", projectId: "p1", enabled: true };
  expect(render(saved)).not.toContain(">Templates<");
});

test("UX2: leaving asks when any field the form submits changed, not only the name or prompt", () => {
  const first = { name: "a", prompt: "b", provider: "claude", grace: 0, precheck: "", form: { preset: "weekdays", time: "09:00" }, reuse: false };
  const same = () => ({ ...first, form: { ...first.form } });
  expect(unsaved(first, same())).toBe(false);
  expect(unsaved(first, { ...same(), name: "a!" })).toBe(true);
  expect(unsaved(first, { ...same(), prompt: "" })).toBe(true);
  expect(unsaved(first, { ...same(), provider: "codex" })).toBe(true);
  expect(unsaved(first, { ...same(), grace: 30 })).toBe(true);
  expect(unsaved(first, { ...same(), precheck: "test -f x" })).toBe(true);
  expect(unsaved(first, { ...same(), reuse: true })).toBe(true);
  expect(unsaved(first, { ...same(), form: { preset: "weekdays", time: "10:00" } })).toBe(true);
  expect(unsaved(first, { ...same(), extra: 1 })).toBe(true);
});

test("UX2: unreadable worktrees show the real reason with Try again, and Save's hint says to use it", () => {
  const html = renderToString(createElement(WorktreeError, { error: "git is not installed", onRetry: () => {} }));
  expect(html).toContain("git is not installed");
  expect(html).toContain("Try again");
  expect(html).toContain('role="alert"');
  expect(saveHint(true, null)).toBeUndefined();
  expect(saveHint(false, null)).toBe("Waiting for the project's worktrees");
  expect(saveHint(false, "x")).toContain("Try again");
});
