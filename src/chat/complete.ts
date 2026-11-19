// Native chat, autocomplete in the message box (CHAT-019; T-334). Pure rules: where in the text a
// menu is wanted, which entries it lists and in what order, what picking one writes into the box,
// and the states of the lists that load. The popup itself is in MessageBox.tsx.
import type { Scan, Skill, Source } from "./skills";

export type Kind = "command" | "skill" | "file";

/** One line of the menu. `insert` is what replaces the typed word; `both` marks a name that is a command and a skill. */
export type Entry = { kind: Kind; name: string; insert: string; description?: string; group?: string; both?: boolean; /** The last path part of a file, matched before the whole path. */ alt?: string };

/** The word under the caret that asks for a menu: it covers text[start, end). */
export type Trigger = { sign: "/" | "@" | "$"; start: number; end: number; query: string };

/** The most lines the menu shows at once. */
export const MENU_LIMIT = 8;

/** CHAT-019: `/` at the start of a line, `@` after a space (or at the start), `$` in a Codex chat. */
export function triggerAt(text: string, caret: number, agent: string | undefined): Trigger | null {
  if (caret < 0 || caret > text.length) return null;
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  const word = text.slice(start, caret);
  if (word.length === 0) return null;
  const sign = word[0];
  const query = word.slice(1);
  if (sign === "/") {
    const lineStart = start === 0 || text[start - 1] === "\n";
    // A path typed at the start of a line (/usr/bin) is not a command word.
    if (!lineStart || query.includes("/")) return null;
    return { sign, start, end: caret, query };
  }
  if (sign === "@") return { sign, start, end: caret, query };
  if (sign === "$" && agent === "codex") return { sign, start, end: caret, query };
  return null;
}

/** CHAT-019: dismissing the menu for a word keeps it closed for that word (the same word at the same place). */
export type Dismissed = { start: number; word: string } | null;
export const wordOf = (text: string, t: Trigger) => text.slice(t.start, t.end);
export const isDismissed = (d: Dismissed, text: string, t: Trigger) => d !== null && d.start === t.start && d.word === wordOf(text, t);

/** Which families of entries a trigger lists for `agent`: Claude lists skills under `/`, Codex uses `$` for skills. */
export function kindsFor(t: Trigger, agent: string | undefined): Kind[] {
  if (t.sign === "@") return ["file"];
  if (t.sign === "$") return ["skill"];
  return isClaude(agent) ? ["command", "skill"] : ["command"];
}
const isClaude = (agent: string | undefined) => agent === "claude" || agent === "openclaude";

// The agents' built-in slash commands, from their public documentation (Claude Code and Codex CLI).
const CLAUDE_COMMANDS: Array<[string, string]> = [
  ["add-dir", "Add a working folder"],
  ["agents", "Manage subagents"],
  ["clear", "Start a new conversation"],
  ["compact", "Shrink the conversation to a summary"],
  ["config", "Open the settings"],
  ["context", "Show what fills the context"],
  ["cost", "Show the token use"],
  ["doctor", "Check the installation"],
  ["export", "Save the conversation"],
  ["help", "Show help"],
  ["hooks", "Manage hooks"],
  ["init", "Write a CLAUDE.md for this project"],
  ["login", "Sign in"],
  ["logout", "Sign out"],
  ["mcp", "Manage MCP servers"],
  ["memory", "Edit the memory files"],
  ["model", "Pick the model"],
  ["permissions", "Manage tool permissions"],
  ["pr-comments", "Show a pull request's comments"],
  ["resume", "Resume an earlier conversation"],
  ["review", "Review a pull request"],
  ["rewind", "Go back to an earlier point"],
  ["status", "Show the session status"],
  ["usage", "Show the plan limits"],
  ["vim", "Switch the editing mode"],
];
const CODEX_COMMANDS: Array<[string, string]> = [
  ["agent", "Switch to another agent thread"],
  ["approvals", "Choose what Codex may do without asking"],
  ["compact", "Shrink the conversation to a summary"],
  ["diff", "Show the git diff"],
  ["fork", "Branch the conversation"],
  ["init", "Write an AGENTS.md for this project"],
  ["logout", "Sign out"],
  ["mcp", "List MCP tools"],
  ["mention", "Attach a file"],
  ["model", "Pick the model and reasoning effort"],
  ["new", "Start a new conversation"],
  ["permissions", "Choose what Codex may do without asking"],
  ["quit", "Leave Codex"],
  ["resume", "Resume an earlier conversation"],
  ["review", "Review the changes"],
  ["status", "Show the session status"],
  ["theme", "Pick the color theme"],
];

/** CHAT-019: the built-in command list of `agent`. (A session's own list had a path in, but nothing ever filled it: audit N-27.) */
export function commandsFor(agent: string | undefined): Entry[] {
  const list = isClaude(agent) ? CLAUDE_COMMANDS : agent === "codex" ? CODEX_COMMANDS : [];
  return list.map(([name, description]) => ({ kind: "command" as const, name, insert: `/${name}`, description }));
}

const GROUP: Record<Source, string> = { workspace: "Project", home: "Personal", bundled: "Built-in", plugin: "Plugin" };
const GROUP_ORDER = ["Project", "Personal", "Built-in", "Plugin"];

/** CHAT-019: the skills `agent` can use, grouped as project, personal, built-in and plugin. Codex calls them with `$`. */
export function skillEntries(skills: readonly Skill[], agent: string | undefined): Entry[] {
  const who = isClaude(agent) ? "claude" : agent === "codex" ? "codex" : null;
  if (!who) return [];
  const sign = who === "codex" ? "$" : "/";
  return skills
    .filter((s) => s.agents.includes(who) || s.agents.includes("shared"))
    .map((s) => ({ kind: "skill" as const, name: s.name, insert: `${sign}${s.name}`, description: s.description ?? undefined, group: GROUP[s.source] }));
}

/** CHAT-019: a name that is both a command and a skill is listed once, marked as one the agent decides. */
export function mergeNames(entries: Entry[]): Entry[] {
  const commands = new Set(entries.filter((e) => e.kind === "command").map((e) => e.name.toLowerCase()));
  const skills = new Set(entries.filter((e) => e.kind === "skill").map((e) => e.name.toLowerCase()));
  return entries
    .filter((e) => !(e.kind === "skill" && commands.has(e.name.toLowerCase())))
    .map((e) => (e.kind === "command" && skills.has(e.name.toLowerCase()) ? { ...e, both: true } : e));
}

/** An `@` mention of a project file; a path with a space is quoted. */
export const fileEntries = (files: readonly string[]): Entry[] =>
  files.map((f) => ({ kind: "file" as const, name: f, alt: f.split("/").pop() ?? f, insert: `@${/\s/.test(f) ? `"${f}"` : f}` }));

const subsequence = (hay: string, needle: string) => {
  let i = 0;
  for (const c of hay) if (c === needle[i] && ++i === needle.length) return true;
  return needle.length === 0;
};

/** CHAT-019: 0 an exact match, 1 a name that starts with the text, 2 a fuzzy match, 3 a match in the description; -1 no match. */
export function tierOf(e: Entry, query: string): number {
  const q = query.toLowerCase();
  if (q === "") return 1;
  const name = e.name.toLowerCase();
  const alt = e.alt?.toLowerCase();
  if (name === q || alt === q) return 0;
  if (name.startsWith(q) || alt?.startsWith(q)) return 1;
  if (subsequence(name, q) || (alt !== undefined && subsequence(alt, q))) return 2;
  if (e.description?.toLowerCase().includes(q)) return 3;
  return -1;
}

/** CHAT-019: the entries that match, ranked by tier, then group, then shorter names first; with no text, in the given order. */
export function rank(entries: readonly Entry[], query: string): Entry[] {
  if (query === "") return entries.slice();
  return entries
    .map((e, i) => ({ e, i, t: tierOf(e, query) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => a.t - b.t || groupIndex(a.e) - groupIndex(b.e) || a.e.name.length - b.e.name.length || a.i - b.i)
    .map((x) => x.e);
}
const groupIndex = (e: Entry) => (e.group === undefined ? -1 : GROUP_ORDER.indexOf(e.group));

/** A list that loads: it is loading, ready, or failed with a sentence. */
export type Load<T> = { state: "idle" } | { state: "loading" } | { state: "ready"; value: T } | { state: "error"; error: string };

/** CHAT-019: what the menu shows for a trigger, and the status lines under it. */
export type Menu = { entries: Entry[]; notes: Array<{ text: string; retry?: "skills" | "files" }> };

export type Sources = { agent: string | undefined; skills: Load<Scan>; files: Load<string[]> };

export function menuFor(t: Trigger, s: Sources): Menu {
  const kinds = kindsFor(t, s.agent);
  const notes: Menu["notes"] = [];
  let all: Entry[] = [];
  if (kinds.includes("command")) all = all.concat(commandsFor(s.agent));
  if (kinds.includes("skill")) {
    if (s.skills.state === "ready") {
      const skills = skillEntries(s.skills.value.skills, s.agent);
      all = all.concat(skills);
      if (skills.length === 0) notes.push({ text: "No skills found." });
    } else if (s.skills.state === "error") notes.push({ text: `Skills could not be loaded: ${s.skills.error}`, retry: "skills" });
    else notes.push({ text: "Loading skills…" });
  }
  if (kinds.includes("file")) {
    if (s.files.state === "ready") {
      all = all.concat(fileEntries(s.files.value));
      if (s.files.value.length === 0) notes.push({ text: "No files found." });
    } else if (s.files.state === "error") notes.push({ text: `Files could not be listed: ${s.files.error}`, retry: "files" });
    else notes.push({ text: "Loading files…" });
  }
  const merged = kinds.includes("command") && kinds.includes("skill") ? mergeNames(all) : all;
  return { entries: rank(merged, t.query).slice(0, MENU_LIMIT), notes };
}

/** Whether the families a trigger lists need the skills or the files loaded. */
export const needs = (t: Trigger, agent: string | undefined) => ({ skills: kindsFor(t, agent).includes("skill"), files: kindsFor(t, agent).includes("file") });

/** CHAT-019: the text after picking `entry`: the typed word is replaced and a space follows, and the caret goes after it. */
export function applyPick(text: string, t: Trigger, entry: Entry): { text: string; caret: number } {
  const after = text.slice(t.end);
  const gap = after.startsWith(" ") ? "" : " ";
  const head = text.slice(0, t.start) + entry.insert;
  return { text: head + gap + after, caret: head.length + 1 };
}

/** CHAT-019: Enter runs a command or a skill; a file only goes into the text. */
export const runsOnEnter = (e: Entry) => e.kind !== "file";

/** One step of the arrows through a menu of `n` lines, wrapping at both ends. */
export const stepIndex = (at: number, n: number, dir: 1 | -1) => (n === 0 ? 0 : (at + dir + n) % n);

/** The files of a listing as the menu wants them: relative paths with forward slashes. */
export const pathsOf = (list: { files?: string[] } | null | undefined) => (list?.files ?? []).map((f) => f.replace(/\\/g, "/"));
