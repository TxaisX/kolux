// The chooser rendered to HTML with no browser: Start follows the seats' readiness, the close
// button follows `closable`, the model row appears once an AI is picked.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import ChooserPane, { sheetKey } from "./ChooserPane";
import type { AgentInfo } from "./PlusMenu";
import { defaultCopies, pickShape, sheetStart, TERMINAL, type Copies, type SavedShape, type Seat, type Shape } from "./seats";
import { OWN_FOLDERS_FIELD, setOwnFolders } from "../projects/singleFolder";

// DT-C273: own folders are the default now; these tests cover one folder per project.
beforeEach(() => setOwnFolders({ [OWN_FOLDERS_FIELD]: false }));

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\\bin\\claude.exe", docs: true };
const render = (seats: Seat[], closable = true, inGit = true, copies: Copies = defaultCopies(seats.length, inGit), shape: Shape = "custom", task = "", saved: SavedShape[] = []) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape, task, onTask: () => {}, onStart: () => {}, copies, inGit, onCopies: () => {}, closable, onClose: () => {}, saved, onSaved: () => {}, onPickSaved: () => {} }));
// slice(1): the text before the first button holds the "Start" heading, which is not the button.
const startButton = (html: string) => html.split("<button").slice(1).find((b) => b.includes(">Start"))!;

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
  expect(html).toContain("Task for all of them");
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

const agentButtons = (html: string) => [...html.matchAll(/<button class="btn agent-btn"[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => [m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'"), m[1]]);

test("Txais 2026-11-08: each seat has a button for Claude Code, Codex, OpenCode and Grok, then Terminal and Other; the rest sit behind Other", () => {
  const list = [agent("aider", "Aider", true), agent("grok", "Grok", false), agent("codex", "Codex", true), claude, agent("opencode", "OpenCode", true), agent("goose", "Goose", false)];
  const html = renderWith(list);
  // The whole form: the one row for all and every seat use the same buttons; no <select> picks the agent anywhere.
  expect(html.match(/<select/g) ?? []).toHaveLength(0);
  expect(html).toContain('aria-label="Which AI for all of them"');
  expect(html).toContain('aria-label="Seat 1: which AI"');
  const lineup = ["Claude Code", "Codex", "OpenCode", "Grok" + "not installed", "Terminal", "Other…"];
  expect(agentButtons(html).map((b) => b[0])).toEqual([...lineup, ...lineup]);
  expect(html).not.toContain(">Aider<");
  expect(html).not.toContain(">Install<");
  expect(startButton(renderWith(list))).toContain("disabled");
  expect(startButton(renderWith(list, false, [{ agent: "claude", model: "opus" }]))).not.toContain("disabled");
});

test("Txais 2026-11-08: the seat's pick shows as a pressed button; an agent picked from Other names itself on the Other button", () => {
  const list = [claude, agent("grok", "Grok", true), agent("aider", "Aider", true)];
  const html = renderWith(list, false, [{ agent: "claude", model: "opus" }]);
  expect(agentButtons(html).find((b) => b[0] === "Claude Code")?.[1]).toBe("true");
  expect(html).toContain("Claude Code docs");
  expect(agentButtons(renderWith(list, false, [{ agent: TERMINAL, model: null }])).find((b) => b[0] === "Terminal")?.[1]).toBe("true");
  expect(agentButtons(renderWith(list, false, [{ agent: "aider", model: null }])).find((b) => b[0] === "Other: Aider")?.[1]).toBe("true");
});

test("Start form A: the one row presses the agent every seat shares; when seats differ it says Mixed and presses none", () => {
  const list = [claude, agent("codex", "Codex", true)];
  const head = (html: string) => html.split('aria-label="Which AI"')[1].split('aria-label="Which AI for all of them"')[0];
  const row = (html: string) => html.split('aria-label="Which AI for all of them"')[1].split("</div>")[0];
  const same = renderWith(list, false, [{ agent: "codex", model: null }, { agent: "codex", model: null }]);
  expect(row(same)).toMatch(/aria-pressed="true"[^>]*>.*Codex/);
  expect(head(same)).not.toContain("Mixed");
  const mixed = renderWith(list, false, [{ agent: "codex", model: null }, { agent: "claude", model: "opus" }]);
  expect(head(mixed)).toContain(">Mixed<");
  expect(row(mixed)).not.toContain('aria-pressed="true"');
});

test("T-201-c SESS-017: any agent with its own page links out to it, the folded ones too", () => {
  const list = [claude, agent("codex", "Codex", true), agent("grok", "Grok", true), { ...agent("aider", "Aider", true), docs: true }, agent("trae", "Trae", true)];
  const html = renderWith(list, false, [{ agent: "aider", model: null }]);
  expect(html).toContain("Aider docs");
  expect(renderWith(list, false, [{ agent: "trae", model: null }])).not.toContain("Trae docs");
});

test("SESS-017: nothing reads not installed while detection runs, and finding no AI at all says so", () => {
  const looking = renderWith([agent("grok", "Grok", false)], true);
  expect(looking).not.toContain("not installed");
  expect(looking).toContain("Looking for AI programs");
  const none = renderWith([agent("claude", "Claude Code", false), agent("codex", "Codex", false), agent("grok", "Grok", false)]);
  expect(none).toContain("No AI programs have been found yet");
  expect(agentButtons(none).find((b) => b[0] === "Terminal")).toBeDefined();
});

const renderSeats = (seats: Seat[]) =>
  renderToString(createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {} }));
test("SESS-019: with kits gone, the launch shape, session count, folders and task controls stay in the open", () => {
  const html = renderSeats([{ agent: null, model: null }]);
  expect(html).not.toContain("Starter kits");
  expect(html).not.toContain("Advanced");
  for (const part of ['aria-label="Launch shape"', 'aria-label="How many sessions"', 'aria-label="Where the AIs work"', "Task for all of them"]) expect(html).toContain(part);
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
  expect(html).toContain("<h2>Start</h2>");
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
  // One folder per project (the default here): nothing is carried, the default is shared.
  expect(start.copies).toBeUndefined();
  expect(start.copies ?? defaultCopies(3, true)).toBe("shared");
  // No earlier launch: one blank seat and no pick, so the live seat count decides.
  const none = sheetStart(undefined, true);
  expect(none.seats).toEqual([{ agent: null, model: null }]);
  expect(none.copies).toBeUndefined();
  // Separate copies need Git: outside it nothing carries over and the default (shared) applies.
  expect(sheetStart({ ...last, copies: "separate" }, false).copies).toBeUndefined();
});

test("Txais 2026-11-12: raising the seat count from 1 to 2 switches to own folders unless the user picked", () => {
  setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
  const one = { shape: "custom" as const, copies: "shared" as const, seats: [{ agent: "claude", model: null }] };
  const start = sheetStart(one, true);
  // 1 seat + shared is the default, not a pick: the chooser follows the count.
  expect(start.copies).toBeUndefined();
  expect(start.copies ?? defaultCopies(2, true)).toBe("separate");
  // An explicit shared pick at 2+ seats is kept when raising further.
  const pickedShared = { ...one, seats: [one.seats[0], one.seats[0]] };
  expect(sheetStart(pickedShared, true).copies).toBe("shared");
  // Separate at 2+ seats is the default: no pick recorded, the count decides.
  expect(sheetStart({ ...pickedShared, copies: "separate" }, true).copies).toBeUndefined();
});

// DT-C250: one folder per project is the default; with "Own folder for each agent" on, the chooser offers the choice again.
test("DT-C250: the folder choice shows only while own folders are on, and starts on own folders for two or more seats in Git", () => {
  const two: Seat[] = [{ agent: "claude", model: "opus" }, { agent: "claude", model: "opus" }];
  const off = render(two);
  expect(off).toContain("Every seat works in this project folder. Kolux does not make extra copies.");
  expect(off).not.toContain("Own folder for each AI");
  expect(off, "the shared-folder warning has no button to a choice that is off").not.toContain("Give each its own folder");
  setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
  try {
    const on = render(two);
    expect(on).not.toContain("Kolux does not make extra copies");
    expect(on).toContain('role="radiogroup" aria-label="Where the AIs work"');
    const radios = on.split("<input").filter((b) => b.includes('name="copies-2"'));
    expect(radios.length).toBe(2);
    expect(radios[0], "Own folder for each AI is picked for two seats in a Git project").toContain("checked");
    expect(radios[1]).not.toContain("checked");
    expect(on, "own folders: nobody shares, so no warning").not.toContain("Several AIs will edit the same files");
    // Same folder for all, by the user's choice: the warning comes with a way back
    const shared = render(two, true, true, "shared");
    expect(shared).toContain("Several AIs will edit the same files");
    expect(shared).toContain("Give each its own folder");
    // Outside Git there is nothing to copy: the choice is shown but own folders cannot be picked
    const noGit = render(two, true, false);
    expect(noGit.split("<input").find((b) => b.includes('name="copies-2"'))).toContain("disabled");
    expect(noGit).toContain("Not a Git project");
    expect(render([{ agent: "claude", model: "opus" }]).split("<input").filter((b) => b.includes('name="copies-2"'))[1], "one seat shares").toContain("checked");
  } finally {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: false });
  }
});
