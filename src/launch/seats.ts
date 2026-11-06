// The chooser's seats (SESS-007, SESS-013): each seat is one session to start, picked as an AI
// (or a plain terminal) plus, for an AI, a model. Pure: the pane renders these and App launches
// them. Nothing is guessed: an AI seat is ready only once its model is picked explicitly.

/** `agent` is an agent id, "terminal" for a plain shell, or null while unpicked. `model` is a
 * model id, "default" for "the program's own default" (an explicit pick), or null. `title` is
 * the seat's job title (SESS-024): it names the pane; blank means none. `prompt` is the opening
 * prompt (SESS-051), handed to the agent by its own route; blank means none. `role` is the seat's
 * role in a launch shape (SESS-012); none in Custom. `effort` and `fast` (SESS-016) are the seat's
 * own options, offered only for a model that has them; unset means the model's own default. */
export type Seat = { agent: string | null; model: string | null; title?: string; prompt?: string; role?: Role; effort?: string; fast?: boolean };

export const TERMINAL = "terminal";

/** SESS-014: where the AIs work: a fresh worktree each, or the chooser's own folder for all. */
export type Copies = "separate" | "shared";

/** SESS-014 (owner change 2026-11-05): every seat works in the project folder. Kolux never makes
 * an automatic copy of the project. */
export const defaultCopies = (_seatCount: number, _inGit: boolean): Copies => "shared";

/** SESS-014: the shared folder with 2+ seats in a Git project is worth a warning. */
export const sharedWarning = (copies: Copies, seatCount: number, inGit: boolean): boolean => copies === "shared" && inGit && seatCount >= 2;

export const NOT_GIT = "Not a Git project: there is nothing to copy, so every AI works in this folder.";

/** The quick-pick counts (SESS-013: the rebuild settles on the New session page's set). */
export const QUICK_COUNTS = [1, 2, 3, 4, 6, 8];

/** UX audit F7: the most seats one launch can ask for, and the count above which the page asks first. */
export const MAX_SESSIONS = 24;
export const ASK_ABOVE = 8;

/** The refusal for a launch asking for more than MAX_SESSIONS seats, or null when the count is fine. */
export const tooManySeats = (n: number): string | null => (n > MAX_SESSIONS ? `A launch starts at most ${MAX_SESSIONS} sessions; this one has ${n}.` : null);

/** What a typed count means: capped at MAX_SESSIONS, and `ask` is set when it grows the lineup past ASK_ABOVE (the page confirms first). */
export function countPlan(typed: number, current: number): { n: number; ask: boolean } {
  const n = Math.min(MAX_SESSIONS, Math.max(1, Math.floor(typed)));
  return { n, ask: n > ASK_ABOVE && n > current };
}

/** A seat's shown pick: the not-yet-startable agent chosen in its dropdown, but only while the seat itself is still empty. */
export const shownPick = (seats: Seat[], shown: Record<number, string>, i: number): string | null => (seats[i]?.agent === null ? shown[i] : undefined) ?? seats[i]?.agent ?? null;

/** Undo of a delete puts back only that team, at its old place, leaving every newer edit of the list alone; when its name has been taken since, it comes back under a free name. */
export function restoreTeam(list: SavedShape[], team: SavedShape, index: number): SavedShape[] {
  const back = { ...team, name: freeName(list, team.name) };
  const at = Math.min(Math.max(0, index), list.length);
  return [...list.slice(0, at), back, ...list.slice(at)];
}

export const emptySeat = (): Seat => ({ agent: null, model: null });

/** Grows with empty seats or shrinks from the bottom; never below one seat, never above MAX_SESSIONS. */
export function resizeSeats(seats: Seat[], count: number): Seat[] {
  const n = Math.min(MAX_SESSIONS, Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)));
  if (n <= seats.length) return seats.slice(0, n);
  return [...seats, ...Array.from({ length: n - seats.length }, emptySeat)];
}

/** A seat whose agent is no longer among the installed ones is cleared, not swapped. */
export function clearMissing(seats: Seat[], installedIds: string[]): Seat[] {
  return seats.map((s) => (s.agent === null || s.agent === TERMINAL || installedIds.includes(s.agent) ? s : emptySeat()));
}

/** A terminal needs no model; an AI needs an explicit model pick. */
export function seatReady(s: Seat): boolean {
  return s.agent === TERMINAL || (s.agent !== null && (s.model !== null || modelsFor(s.agent).length === 0));
}

export const allReady = (seats: Seat[]): boolean => seats.length > 0 && seats.every(seatReady);

/** SESS-019: what the footer says the first unfinished seat still lacks; null when all are ready. */
export function seatGap(seats: Seat[]): string | null {
  const i = seats.findIndex((s) => !seatReady(s));
  return i < 0 ? null : `Seat ${i + 1} still needs ${seats[i].agent === null ? "an AI" : "a model"}`;
}

/** SESS-015 "Same for all": the first finished seat's AI and model go into every other seat;
 * job titles stay per seat. Unchanged when no seat is finished. */
export function sameForAll(seats: Seat[]): Seat[] {
  const first = seats.find(seatReady);
  if (!first) return seats;
  return seats.map((s) => ({ ...s, agent: first.agent, model: first.model, effort: first.effort, fast: first.fast }));
}

/** SESS-024: a pane whose session failed to start is dropped. `batchEmpty` says the whole
 * lineup it came from is gone, so the window can say that nothing started. */
export function withoutFailed<T extends { key: number; batch?: number }>(panes: T[], key: number): { panes: T[]; batchEmpty: boolean } {
  const failed = panes.find((p) => p.key === key);
  const rest = panes.filter((p) => p.key !== key);
  const batchEmpty = failed?.batch !== undefined && !rest.some((p) => p.batch === failed.batch);
  return { panes: rest, batchEmpty };
}

/** A model choice: its id on the agent's command line, the label the user reads, and (SESS-016)
 * the effort levels and fast mode it offers, when it has them. */
export type ModelChoice = { id: string; label: string; efforts?: string[]; fast?: boolean; effortFlag?: string; defaultEffort?: string };

/** Claude Code's effort levels (its `--effort` flag). */
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const BUILT_IN: Record<string, ModelChoice[]> = {
  claude: [
    { id: "opus", label: "Claude Opus", efforts: CLAUDE_EFFORTS, fast: true },
    { id: "sonnet", label: "Claude Sonnet", efforts: CLAUDE_EFFORTS },
    { id: "haiku", label: "Claude Haiku" },
  ],
  codex: [
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
    { id: "gpt-5", label: "GPT-5" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  cursor: [
    { id: "auto", label: "Auto" },
    { id: "sonnet-4.5", label: "Claude Sonnet 4.5" },
    { id: "gpt-5", label: "GPT-5" },
  ],
  grok: [
    { id: "grok-code-fast-1", label: "Grok Code Fast 1" },
    { id: "grok-4", label: "Grok 4" },
  ],
};

/** SESS-029: Grok's effort levels, up to extra-high; left untouched it stays at Grok's own high. */
const GROK_EFFORTS = ["low", "medium", "high", "xhigh"];
const grokModel = (m: { id: string; label: string }): ModelChoice => ({ ...m, efforts: GROK_EFFORTS, effortFlag: "--effort", defaultEffort: "high" });
for (const m of BUILT_IN.grok) Object.assign(m, grokModel(m));

/** SESS-029: the agents that are asked for their models, and what each one answered. */
export const LISTED = ["grok", "cursor"];
const discovered: Record<string, { id: string; label: string }[]> = {};

/** SESS-029: records an agent's live list. For Grok it replaces the built-in list; for the others the
 * discovered models join after the built-in ones. An empty or unreadable answer changes nothing. */
export function setDiscovered(agentId: string, found: { id: string; label: string }[] | null) {
  if (found && found.length > 0) discovered[agentId] = found;
}

function listOf(agentId: string): ModelChoice[] | undefined {
  const live = discovered[agentId];
  const built = BUILT_IN[agentId];
  if (!live) return built;
  if (agentId === "grok") return live.map(grokModel);
  const known = built ?? [];
  return [...known, ...live.filter((m) => !known.some((k) => k.id === m.id))];
}

export const DEFAULT_MODEL = "default";

/** The model row for an agent: its built-in list plus the program's own default, which is an
 * explicit pick that adds no model flag. ACCT-032: an agent without a built-in list has no model
 * step at all (empty). */
export function modelsFor(agentId: string): ModelChoice[] {
  const list = listOf(agentId);
  return list ? [...list, { id: DEFAULT_MODEL, label: "Program default" }] : [];
}

/** The arguments a model pick adds to the start line; none for the program's own default. */
export function modelArgs(model: string | null): string[] {
  return model === null || model === DEFAULT_MODEL ? [] : ["--model", model];
}

/** The seat's model as a choice, when its agent lists it. */
export const choiceOf = (s: Seat): ModelChoice | undefined => (s.agent ? modelsFor(s.agent).find((m) => m.id === s.model) : undefined);

/** Fast mode for one session: Claude Code reads a settings object from its `--settings` flag. */
export const FAST_SETTINGS = '{"fastMode":true}';

/** SESS-016: a seat's start arguments: its model, then the effort and fast mode it chose, each only
 * when its model offers it. */
// ponytail: only Claude models list efforts, so the flag is Claude Code's `--effort`; another
// agent's flag goes on ModelChoice when its models gain efforts (T-100-b).
export function seatArgs(s: Seat): string[] {
  const m = choiceOf(s);
  const out = modelArgs(s.model);
  if (s.effort && m?.efforts?.includes(s.effort)) out.push(m.effortFlag ?? "--effort", s.effort);
  if (s.fast && m?.fast) out.push("--settings", FAST_SETTINGS);
  return out;
}

/** SESS-021: what "Use last lineup" brings back for a project: the shape, the files choice and
 * each seat's agent and model; never the options, titles or prompts. */
export type Lineup = { shape: Shape; copies: Copies; seats: { agent: string | null; model: string | null }[] };

export const LAST_LINEUP_KEY = "lastLineups";

export const lineupOf = (shape: Shape, copies: Copies, seats: Seat[]): Lineup => ({ shape, copies, seats: seats.map((s) => ({ agent: s.agent, model: s.model })) });

/** The agents a lineup remembers, each once, in seat order; terminals left out. */
export const lineupAgents = (l: Lineup): string[] => [...new Set(l.seats.flatMap((s) => (s.agent && s.agent !== TERMINAL ? [s.agent] : [])))];

/** The lineup to offer, or null when there is none or none of its agents is available any more. */
export function offeredLineup(saved: unknown, installedIds: string[]): Lineup | null {
  const l = saved as Lineup | null | undefined;
  if (!l || !Array.isArray(l.seats) || !SHAPES.some((s) => s.id === l.shape)) return null;
  return lineupAgents(l).some((a) => installedIds.includes(a)) ? l : null;
}

/** Puts a lineup back: its shape with its roles, and each seat's agent and model; a seat whose
 * agent is gone is left blank. */
export function applyLineup(l: Lineup, installedIds: string[]): { shape: Shape; seats: Seat[] } {
  const seats = clearMissing(l.seats.map((s) => ({ agent: s.agent, model: s.model })), installedIds);
  return resizeLineup(l.shape, seats, seats.length);
}

/** SESS-012: the four roles, each with its own short brief that goes ahead of the shared task. */
export type Role = "builder" | "reviewer" | "scout" | "tester";
export const ROLE_BRIEFS: Record<Role, string> = {
  builder: "You are the builder. Make the change the task asks for in small steps, and keep the project working after each one.",
  reviewer: "You are the reviewer. Read what the builders change, look for bugs, gaps and risky shortcuts, and say plainly what must be fixed before the task is done.",
  scout: "You are the scout. Before anyone builds, explore the code and the documentation the task touches, then write down what the others need to know: where things live, what already exists, and what could go wrong.",
  tester: "You are the tester. Write and run tests for what the task asks, try the edge cases, and report each failure with the exact steps that show it.",
};

/** SESS-012: a launch shape and the roles of its seats in order; Custom carries none. */
export type Shape = "solo" | "pair" | "workbench" | "swarm" | "custom";
export const SHAPES: Array<{ id: Shape; label: string; roles: Role[] }> = [
  { id: "solo", label: "Solo", roles: ["builder"] },
  { id: "pair", label: "Pair", roles: ["builder", "reviewer"] },
  { id: "workbench", label: "Workbench", roles: ["scout", "builder", "reviewer"] },
  { id: "swarm", label: "Swarm", roles: ["scout", "builder", "builder", "tester", "reviewer"] },
  { id: "custom", label: "Custom", roles: [] },
];
const rolesOf = (shape: Shape): Role[] => SHAPES.find((s) => s.id === shape)?.roles ?? [];
/** Seats past the end of the role list wrap round to its first role again. */
const withRoles = (seats: Seat[], roles: Role[]): Seat[] => seats.map((s, i) => ({ ...s, role: roles.length ? roles[i % roles.length] : undefined }));

/** SESS-012: picking a shape sets the count to its number of roles; Custom keeps the count. */
export function pickShape(shape: Shape, seats: Seat[]): Seat[] {
  const roles = rolesOf(shape);
  return withRoles(roles.length ? resizeSeats(seats, roles.length) : seats, roles);
}

/** SESS-012: a new count keeps the shape when it is at least the shape's number of roles;
 * below that the shape turns into Custom and the roles go. */
export function resizeLineup(shape: Shape, seats: Seat[], count: number): { shape: Shape; seats: Seat[] } {
  const next = resizeSeats(seats, count);
  const roles = rolesOf(shape);
  return next.length < roles.length ? { shape: "custom", seats: withRoles(next, []) } : { shape, seats: withRoles(next, roles) };
}

/** SESS-025: the first line of the rules block, which is how a shown prompt finds and cuts it. */
export const RULES_MARK = "--- Kolux: you are working alongside other agents ---";

/** SESS-025: the rules every agent of a 2+ seat launch gets after its task. `note` is the path of
 * its own handoff note, made before the agent starts. */
export function rulesBlock(note: string): string {
  return [
    RULES_MARK,
    "Other agents are working on this task alongside you in the same project folder.",
    "Stay inside that folder; do not make a worktree or a second copy of the project. The one file outside it you may write is your handoff note.",
    "Make your changes on a branch, commit them, push the branch, and open a pull request. Do not commit to main.",
    `Your handoff note is ${note}. It exists already. Keep it current after each change: the files you added, updated and removed, and what is left to do. Never edit another agent's note.`,
    "Before you say you are done, check how you use every library against its up-to-date documentation.",
  ].join("\n");
}

/** SESS-012 / SESS-025: a seat's first message: its role's brief, then the shared task, then the
 * seat's own opening prompt (SESS-051), blank parts left out; then the rules block when given.
 * Empty when there is nothing to say, so no rules block goes out alone. */
// ponytail: a prompt with line breaks reaches a typed-route agent, or one started through a .cmd
// shim, only up to its first line break; T-163 (SESS-032) delivers it as one pasted block.
export function openingPrompt(seat: Seat, task: string, rules: string | null): string {
  const body = [seat.role ? ROLE_BRIEFS[seat.role] : "", task.trim(), seat.prompt?.trim() ?? ""].filter(Boolean).join("\n\n");
  return body && rules ? `${body}\n\n${rules}` : body;
}

/** SESS-025: a prompt as it is shown back to the user: everything from the rules block on is cut.
 * The pane tooltip shows the task alone; the status of STAT-025 (T-123) and the session rows of
 * VIEW-084 (T-127) run prompts through this. */
export function withoutRules(text: string): string {
  const at = text.indexOf(RULES_MARK);
  return at < 0 ? text : text.slice(0, at).trimEnd();
}

/** SESS-020: a lineup saved under a name to pick again: each seat's AI, model, role, job title and
 * opening prompt, where the AIs work, and the shared task. */
export type SavedShape = { name: string; seats: Seat[]; copies: Copies; task?: string };
export const SAVED_SHAPES_KEY = "savedShapes";
export const SHAPE_LIMITS = { shapes: 40, name: 60, seats: 12, prompt: 4000 };

/** A name not taken by another saved shape (compared without case), with a rising number when it is. */
function freeName(list: SavedShape[], name: string, skip = -1): string {
  const taken = new Set(list.filter((_, i) => i !== skip).map((s) => s.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const tail = n === 1 ? "" : ` ${n}`;
    const out = name.slice(0, SHAPE_LIMITS.name - tail.length).trimEnd() + tail;
    if (!taken.has(out.toLowerCase())) return out;
  }
}

/** SESS-020: adds the lineup to the saved shapes, or says why it cannot. */
export function saveShape(list: SavedShape[], name: string, seats: Seat[], copies: Copies, task: string): { list: SavedShape[] } | { error: string } {
  if (!allReady(seats)) return { error: "Pick an AI and a model (or Terminal) for every seat before saving" };
  if (!name.trim()) return { error: "Give the shape a name" };
  if (seats.length > SHAPE_LIMITS.seats) return { error: `A saved shape holds at most ${SHAPE_LIMITS.seats} seats` };
  if (list.length >= SHAPE_LIMITS.shapes) return { error: `There are already ${SHAPE_LIMITS.shapes} saved shapes; delete one first` };
  const cut = (p: string) => p.slice(0, SHAPE_LIMITS.prompt);
  const shape: SavedShape = { name: freeName(list, name.trim()), seats: seats.map((s) => (s.prompt ? { ...s, prompt: cut(s.prompt) } : s)), copies, task: cut(task) };
  return { list: [...list, shape] };
}

/** SESS-020: a blank name changes nothing; only shape `i` is touched. */
export function renameShape(list: SavedShape[], i: number, name: string): SavedShape[] {
  if (!name.trim() || !list[i]) return list;
  return list.map((s, j) => (j === i ? { ...s, name: freeName(list, name.trim(), i) } : s));
}

/** SESS-020: the seats back as saved; a seat whose agent is no longer installed comes back blank. */
export const restoreShape = (shape: SavedShape, installedIds: string[]): Seat[] => clearMissing(shape.seats.map((s) => ({ ...s })), installedIds);

/** SESS-008: what the remove-session shortcut closes among the panes in front: the newest chooser
 * (silently, `chooser` true), else the focused pane, else the last one. A lone chooser stays, so
 * the grid never drops below one pane. */
export function removeTarget<T extends { key: number; seats?: Seat[] }>(shown: T[], focused: number): { key: number; chooser: boolean } | null {
  const chooser = [...shown].reverse().find((p) => p.seats);
  if (chooser) return shown.length > 1 ? { key: chooser.key, chooser: true } : null;
  const target = shown.find((p) => p.key === focused) ?? shown[shown.length - 1];
  return target ? { key: target.key, chooser: false } : null;
}

/** SESS-013: the folder a launch's seats open in. Every seat shares one folder (one folder per
 *  project); a chooser with no folder (Home) falls back to the project folder. */
export const seatFolder = (chooser: string | null, project: string | null): string | null => chooser ?? project;

/** SESS-018: the New session page starts from this project's previous launch for the count, but
 *  every seat starts blank (SESS-015). Every launch shares the project folder (owner change 2026-11-05). */
export function sheetStart(last: Lineup | undefined, _inGit: boolean): { seats: Seat[]; copies: Copies } {
  const n = Math.min(MAX_SESSIONS, Math.max(1, last?.seats.length ?? 1));
  const copies: Copies = "shared";
  return { seats: Array.from({ length: n }, emptySeat), copies };
}
