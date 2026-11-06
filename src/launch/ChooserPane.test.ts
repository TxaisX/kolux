// The chooser rendered to HTML with no browser: Start follows the seats' readiness, the close
// button follows `closable`, the model row appears once an AI is picked.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane, { sheetKey } from "./ChooserPane";
import type { AgentInfo } from "./PlusMenu";
import { defaultCopies, pickShape, sheetStart, TERMINAL, type Copies, type SavedShape, type Seat, type Shape } from "./seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\bin\\claude.exe", docs: true };
const render = (seats: Seat[], closable = true, inGit = true, copies: Copies = defaultCopies(seats.length, inGit), shape: Shape = "custom", task = "", saved: SavedShape[] = []) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape, task, onTask: () => {}, onStart: () => {}, copies, inGit, onCopies: () => {}, closable, onClose: () => {}, saved, onSaved: () => {}, onPickSaved: () => {} }));
const startButton = (html: string) => html.split("<button").find((b) => b.includes(">Start"))!;

test("SESS-007: Claude without a model keeps Start disabled, a model enables it, Terminal is enabled at once", () => {
  const noModel = render([{ agent: "claude", model: null }]);
  expect(startButton(noModel)).toContain("disabled");
  expect(noModel).toContain("Pick a model");
  expect(noModel).toContain("Claude Opus");
  const withModel = render([{ agent: "claude", model: "opus" }]);
  expect(startButton(withModel)).not.toContain("disabled");
  const term = render([{ agent: TERMINAL, model: null }]);
  expect(startButton(term)).not.toContain("disabled");
  expect(term).not.toContain("Pick a model");
  expect(render([{ agent: null, model: null }])).toContain("Session 2");
});

test("SESS-051: an AI seat offers an opening prompt field; a Terminal seat has none", () => {
  const ai = render([{ agent: "claude", model: "opus", prompt: "Fix it" }]);
  expect(ai).toContain("Opening prompt (optional)");
  expect(ai).toContain("Fix it");
  expect(render([{ agent: TERMINAL, model: null }])).not.toContain("Opening prompt");
  expect(render([{ agent: null, model: null }])).not.toContain("Opening prompt");
});

test("SESS-015: three blank seats keep Start disabled and the old no-guessing caption is gone (T-571); Same for all waits for a finished seat", () => {
  const blank = render([{ agent: null, model: null }, { agent: null, model: null }, { agent: null, model: null }]);
  expect(startButton(blank)).toContain("disabled");
  expect(blank).not.toContain("Kolux never picks an AI or a model for you");
  expect(blank).not.toContain("Every seat starts blank");
  expect(blank.split("<button").find((b) => b.includes("Same for all"))?.split("</button>")[0]).toContain("disabled");
  const one = render([{ agent: "claude", model: "opus" }, { agent: null, model: null }, { agent: null, model: null }]);
  expect(one.split("<button").find((b) => b.includes("Same for all"))?.split("</button>")[0]).not.toContain("disabled");
  expect(render([{ agent: "claude", model: "opus" }]).split("<button").find((b) => b.includes("Same for all"))?.split("</button>")[0]).toContain("disabled");
  expect(render([{ agent: null, model: null, title: "Review" }])).toContain('value="Review"');
});

test("the grid's only pane has no close button; otherwise it does", () => {
  expect(render([{ agent: null, model: null }], false)).not.toContain("Close this chooser");
  expect(render([{ agent: null, model: null }], true)).toContain("Close this chooser");
});

test("SESS-013: the count row shows the quick picks and one seat block per seat", () => {
  const html = render([{ agent: null, model: null }, { agent: null, model: null }, { agent: null, model: null }]);
  for (const n of [1, 2, 3, 4, 6, 8]) expect(html).toContain(`>${n}</button>`);
  expect(html).toContain("Seat 3");
  expect(html).not.toContain("Seat 4");
  expect(html).toContain('value="3"');
  expect(html).toContain("Start 3");
});

test("SESS-014 (owner change 2026-11-05): every launch works in one project folder", () => {
  const three: Seat[] = [{ agent: "claude", model: "opus" }, { agent: "claude", model: "opus" }, { agent: "claude", model: "opus" }];
  const html = render(three);
  expect(html).toContain("Every seat works in this project folder");
  expect(html).not.toContain("Separate copy for each AI");
  expect(html).toContain("Several AIs will edit the same files");
  const one = render([three[0]]);
  expect(one).toContain("Every seat works in this project folder");
  expect(one).not.toContain("Several AIs will edit the same files");
  const outside = render(three, true, false);
  expect(outside).toContain("Every seat works in this project folder");
});

test("SESS-012: the lineup shows the shape row, a task for every seat, and each seat with its role before anything starts", () => {
  const swarm = pickShape("swarm", [{ agent: "claude", model: "opus" }]);
  const html = render(swarm, true, true, "separate", "swarm", "Fix the login page");
  for (const s of ["Solo", "Pair", "Workbench", "Swarm", "Custom"]) expect(html).toContain(`>${s}</button>`);
  expect(html.split("<button").find((b) => b.includes(">Swarm<"))).toContain('aria-pressed="true"');
  expect(html).toContain("Task for every seat");
  expect(html).toContain("Fix the login page");
  const roles = [...html.matchAll(/class="chip seat-role"[^>]*>([a-z]+)</g)].map((m) => m[1]);
  expect(roles).toEqual(["scout", "builder", "builder", "tester", "reviewer"]);
  const custom = render(swarm.slice(0, 2).map((s) => ({ ...s, role: undefined })));
  expect(custom.split("<button").find((b) => b.includes(">Custom<"))).toContain('aria-pressed="true"');
  expect(custom).not.toContain("seat-role");
});

// In a small pane (the 4- and 6-pane grids) the choices scroll; Start must sit below them, not
// at their end, or picking Terminal is followed by a Start the user cannot see.
test("SESS-007: Start sits in a footer after the scrolling choices", () => {
  const html = render([{ agent: TERMINAL, model: null }]);
  const body = html.indexOf('class="chooser-body"');
  const foot = html.indexOf('class="chooser-foot');
  expect(body).toBeGreaterThan(-1);
  expect(foot).toBeGreaterThan(body);
  expect(html.indexOf(">Start<", foot)).toBeGreaterThan(foot);
});

test("SESS-022: no usage figures, no warning line above Start", () => {
  expect(render([{ agent: "claude", model: "opus" }])).not.toContain("note warn");
});

test("SESS-020: Save as team waits until every seat is picked; saved shapes sit after the built-in ones", () => {
  const save = (html: string) => html.split("<button").find((b) => b.includes("Save as team"))!;
  expect(save(render([{ agent: "claude", model: null }]))).toContain("disabled");
  expect(save(render([{ agent: "claude", model: "opus" }]))).not.toContain("disabled");
  const html = render([{ agent: "claude", model: "opus" }], true, true, "shared", "custom", "", [{ name: "Review crew", seats: [{ agent: "claude", model: "opus", role: "builder" }], copies: "shared" }]);
  expect(html.indexOf("Review crew")).toBeGreaterThan(html.indexOf("Custom"));
  expect(html).toContain("Rename or delete Review crew");
});

test("SESS-002: Start waits for a search that succeeded, and an errored one says so", () => {
  const seats: Seat[] = [{ agent: TERMINAL, model: null }];
  const view = (pass: { looking: boolean; done: boolean; error: string | null }) =>
    renderToString(createElement(ChooserPane, { saved: [], onSaved: () => {}, onPickSaved: () => {}, number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: false, onCopies: () => {}, closable: true, onClose: () => {}, pass, onRefresh: () => {} }));
  const start = (html: string) => html.split("</button>").find((b) => b.includes(">Start"))!;
  expect(start(view({ looking: false, done: true, error: null }))).not.toContain("disabled");
  const failed = view({ looking: false, done: true, error: "IPC down" });
  expect(failed.replace(/<!-- -->/g, "")).toContain("could not look for agents (IPC down)");
  expect(start(failed)).toContain("disabled");
  const first = view({ looking: true, done: false, error: null });
  expect(first).toContain("Looking for agents");
  expect(start(first)).toContain("disabled");
  expect(view({ looking: false, done: true, error: null })).toContain("Refresh agents");
});

test("SESS-016: the effort picker and fast mode show on the seat whose model has them, and no other", () => {
  const html = render([{ agent: "claude", model: "opus" }, { agent: "claude", model: "haiku" }]);
  expect(html).toContain("Seat 1: effort");
  expect(html).toContain("Seat 1: fast mode");
  expect(html).not.toContain("Seat 2: effort");
  expect(html).not.toContain("Seat 2: fast mode");
  expect(render([{ agent: "claude", model: "sonnet" }])).not.toContain("fast mode");
});

test("SESS-021: Use last lineup shows only when offered, naming the remembered agents", () => {
  const props = { saved: [], onSaved: () => {}, onPickSaved: () => {}, number: 2, agents: [claude], seats: [{ agent: null, model: null }], onSeats: () => {}, onLineup: () => {}, shape: "custom" as Shape, task: "", onTask: () => {}, onStart: () => {}, copies: "shared" as Copies, inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, onUseLineup: () => {} };
  const lineup = { shape: "pair" as Shape, copies: "separate" as Copies, seats: [{ agent: "codex", model: "gpt-5" }, { agent: "claude", model: "opus" }] };
  expect(renderToString(createElement(ChooserPane, { ...props, lastLineup: lineup }))).toContain("Use last lineup: codex, Claude Code");
  expect(renderToString(createElement(ChooserPane, { ...props, lastLineup: null }))).not.toContain("Use last lineup");
});

const agent = (id: string, name: string, installed: boolean): AgentInfo => ({ id, name, program: id, args: [], installed, path: installed ? `C:/bin/${id}.exe` : null, docs: ["claude", "codex", "grok"].includes(id) });
const renderWith = (agents: AgentInfo[], detecting = false, seats: Seat[] = [{ agent: null, model: null }]) =>
  renderToString(createElement(ChooserPane, { saved: [], onSaved: () => {}, onPickSaved: () => {}, number: 2, agents, detecting, seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {}, closable: true, onClose: () => {} }));

const optionsOf = (html: string) => [...html.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);

test("T-570: one dropdown per seat lists every agent A to Z (T-664); a missing one reads (not installed) and can still be picked", () => {
  const list = [agent("aider", "Aider", true), agent("grok", "Grok", false), agent("codex", "Codex", true), claude, agent("goose", "Goose", false)];
  const html = renderWith(list);
  expect(html.match(/<select[^>]*which AI/g)).toHaveLength(1);
  expect(optionsOf(html).map((o) => o[1])).toEqual(["Choose an AI…", "Aider", "Claude Code", "Codex", "Goose (not installed)", "Grok (not installed)", "Terminal"]);
  expect(html).not.toContain('type="radio" name="seat-2-0-ai"');
  expect(html).not.toContain("More agents");
  expect(html).not.toContain(">Install<");
  expect(startButton(renderWith(list))).toContain("disabled");
  expect(startButton(renderWith(list, false, [{ agent: "claude", model: "opus" }]))).not.toContain("disabled");
});

test("T-570: the dropdown shows the seat's pick; a picked agent with docs links to them", () => {
  const html = renderWith([claude, agent("grok", "Grok", true)], false, [{ agent: "claude", model: "opus" }]);
  expect(html).toMatch(/<option[^>]*value="claude"[^>]*selected/);
  expect(html).toContain("Claude Code docs");
  expect(renderWith([claude], false, [{ agent: TERMINAL, model: null }])).toMatch(/<option[^>]*value="terminal"[^>]*selected/);
});

test("T-201-c SESS-017: any agent with its own page links out to it, the folded ones too", () => {
  const list = [claude, agent("codex", "Codex", true), agent("grok", "Grok", true), { ...agent("aider", "Aider", true), docs: true }, agent("trae", "Trae", true)];
  const html = renderWith(list, false, [{ agent: "aider", model: null }]);
  expect(html).toContain("Aider docs");
  expect(renderWith(list, false, [{ agent: "trae", model: null }])).not.toContain("Trae docs");
});

test("SESS-017: nothing reads not installed while detection runs, and finding no AI at all says so", () => {
  const looking = renderWith([], true);
  expect(looking).not.toContain("not installed");
  expect(looking).toContain("Looking for AI programs");
  const none = renderWith([agent("claude", "Claude Code", false), agent("codex", "Codex", false), agent("grok", "Grok", false)]);
  expect(none).toContain("No AI programs have been found yet");
  expect(optionsOf(none).find((o) => o[1] === "Terminal")).toBeDefined();
  expect(none).not.toMatch(/<option[^>]*value="terminal"[^>]*disabled/);
});

const renderSeats = (seats: Seat[]) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {} }));
test("SESS-019: with kits gone, the launch shape, session count, folders and task controls stay in the open", () => {
  const html = renderSeats([{ agent: null, model: null }]);
  expect(html).not.toContain("Starter kits");
  expect(html).not.toContain("Advanced");
  for (const part of ['aria-label="Launch shape"', 'aria-label="How many sessions"', 'aria-label="Where the AIs work"', "Task for every seat"]) expect(html).toContain(part);
});

test("SESS-019: the footer counts the sessions and names the first seat still lacking an AI", () => {
  const two = renderSeats([{ agent: "claude", model: "opus" }, { agent: null, model: null }]);
  expect(startButton(two)).toContain("disabled");
  expect(two).toContain("2 sessions");
  expect(two).toContain("Seat 2 still needs an AI");
  expect(renderSeats([{ agent: "claude", model: null }])).toContain("Seat 1 still needs a model");
  const ready = renderSeats([{ agent: "claude", model: "opus" }]);
  expect(ready).toContain("1 session");
  expect(ready).not.toContain("still needs");
});

test("SESS-018: the New session page shows the project and its path, the add-agents link, Cancel and the launch shortcut", () => {
  const html = renderToString(createElement(ChooserPane, { number: 7, agents: [claude], seats: [{ agent: null, model: null }], onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "separate", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {}, sheet: { project: "demo", path: "G:\Temp\demo" } }));
  expect(html).toContain("New session");
  expect(html).toContain("demo");
  expect(html).toContain("G:\Temp\demo");
  expect(html).not.toContain("Session 7");
  expect(html).toContain("Add more agents");
  expect(html).toContain(">Cancel<");
  expect(startButton(html)).toContain("disabled");
  expect(html).toContain("Ctrl");
  expect(html).toContain("Seat 1 still needs an AI");
  // The older look keeps its pane: no page heading there.
  expect(renderSeats([{ agent: null, model: null }])).not.toContain("New session");
});

test("SESS-018: Ctrl+Enter launches only a complete lineup, Escape closes the page", () => {
  const blank = [{ agent: null, model: null }];
  const done = [{ agent: TERMINAL, model: null }];
  expect(sheetKey({ key: "Enter", ctrlKey: true, metaKey: false }, blank, false)).toBe("blocked");
  expect(sheetKey({ key: "Enter", ctrlKey: true, metaKey: false }, done, false)).toBe("launch");
  expect(sheetKey({ key: "Enter", ctrlKey: false, metaKey: true }, done, true)).toBe("launch");
  expect(sheetKey({ key: "Enter", ctrlKey: true, metaKey: false }, done, true)).toBe(null);
  expect(sheetKey({ key: "Enter", ctrlKey: false, metaKey: false }, done, false)).toBe(null);
  expect(sheetKey({ key: "Escape", ctrlKey: false, metaKey: false }, done, false)).toBe("close");
});

test("SESS-018: the page starts with the project's last count and files choice, every seat blank", () => {
  const last = { shape: "custom" as const, copies: "shared" as const, seats: [{ agent: "claude", model: "opus" }, { agent: "codex", model: null }, { agent: TERMINAL, model: null }] };
  const start = sheetStart(last, true);
  expect(start.seats).toHaveLength(3);
  expect(start.seats.every((s) => s.agent === null && s.model === null)).toBe(true);
  expect(start.copies).toBe("shared");
  // No earlier launch: one blank seat and the usual default.
  const none = sheetStart(undefined, true);
  expect(none.seats).toEqual([{ agent: null, model: null }]);
  expect(none.copies).toBe(defaultCopies(1, true));
  // Separate copies need Git: outside it the shared folder is the only choice.
  expect(sheetStart({ ...last, copies: "separate" }, false).copies).toBe("shared");
});
