// Native chat, the agent's work inside a turn (CHAT-012..CHAT-016; T-326). The transcript reader
// hands over one item per message, thought, plan and tool call; this module folds a run of tool
// calls into one steps row, gives each edit its own diff card, gathers a turn's subagents into one
// roster row, and adds the working, worked-for and responding lines.
import type { ChatItem, Row } from "./model";
import { pathKey } from "./chatLinks";
import { resolvePath } from "../terminal/links";

/** FIX-2: whether a path names one file whatever folder it is read from (a drive, a UNC share or a leading slash). */
export const isFullPath = (p: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

/** FIX-3: whether a relative path names no file the pane's folder can reach: a home-relative one (`~/x`, `~\x`, `~`), or one
 * whose `..` segments climb above the root of `cwd` (a drive or `/`), which resolving would silently clamp to the wrong file. */
export function unreachable(p: string, cwd: string | null): boolean {
  if (/^~(?:[\\/]|$)/.test(p)) return true;
  if (!cwd) return false;
  const root = /^[\\/]{2}/.test(cwd) ? 4 : 1; // segments the root takes: "C:", "" (for /), or "", "", server, share (for a UNC share)
  let depth = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).length - root; // folders below the root
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg !== "..") depth++;
    else if (--depth < 0) return true;
  }
  return false;
}

export type DiffLine = { sign: "+" | "-" | " " | "@"; old?: number; new?: number; text: string };
export type FileDiff = { path: string; change: "added" | "deleted" | "renamed" | "edited"; from?: string; lines: DiffLine[]; hidden: number };
/** CHAT-022: one option of an ask-the-user question, and the question itself. */
export type Choice = { label: string; description: string };
export type Question = { question: string; header: string; multi: boolean; options: Choice[] };
export type Tool = {
  call: string;
  name: string;
  group: "read" | "edit" | "shell" | "mcp" | "web" | "agent" | "other";
  server?: string;
  preview: string;
  output?: string;
  done: boolean;
  failed: boolean;
  background: boolean;
  diffs?: FileDiff[];
  endedAt?: number;
  /** CHAT-022: the questions of an ask-the-user call. */
  questions?: Question[];
  /** CHAT-015: the tokens a subagent's run used, once its result says. */
  tokens?: number;
};

/** CHAT-028: a file the agent wrote in a turn. */
export type WrittenFile = { path: string; change: FileDiff["change"] };
/** CHAT-028: how many written files a finished turn lists. */
export const WRITTEN_LIMIT = 4;

/** CHAT-028: the files a turn's tool calls wrote, newest first, each once (at its latest write), at most WRITTEN_LIMIT.
 * A deleted file is not "written"; a renamed one counts under its new name. FIX-2: a path the agent wrote relative to its own
 * folder (Codex patches do) is resolved against `cwd`, the pane's working folder, so the list holds full paths and a path
 * handed to another agent in another folder names the same file; with no folder known it stays as written. */
export function writtenFiles(tools: readonly ChatItem[], limit = WRITTEN_LIMIT, cwd: string | null = null): WrittenFile[] {
  const out: WrittenFile[] = [];
  const seen = new Set<string>();
  for (let i = tools.length - 1; i >= 0 && out.length < limit; i--) {
    const diffs = tools[i].tool?.diffs ?? [];
    for (let j = diffs.length - 1; j >= 0 && out.length < limit; j--) {
      const d = diffs[j];
      if (d.change === "deleted" || !d.path) continue;
      if (!isFullPath(d.path) && unreachable(d.path, cwd)) continue; // FIX-3: skipped, never listed under a wrong full path
      const path = isFullPath(d.path) ? d.path : (resolvePath(d.path, cwd) ?? d.path);
      const k = pathKey(path);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ path, change: d.change });
    }
  }
  return out;
}

/** CHAT-015: a subagent's state; later in this list is worse, and the worst decides the row. */
export const CHILD_STATES = ["completed", "idle", "working", "stopped", "unverifiable", "failed"] as const;
export type ChildState = (typeof CHILD_STATES)[number];
export type Child = { id: string; name: string; label: string; state: ChildState; at?: number; endedAt?: number; tokens?: number };

export type View =
  | Row
  | { row: "steps"; id: string; steps: ChatItem[]; live: boolean }
  | { row: "diff"; id: string; item: ChatItem }
  | { row: "roster"; id: string; children: Child[]; verdict: ChildState }
  | { row: "working"; id: string; since?: number; label: string }
  | { row: "worked"; id: string; ms: number }
  | { row: "responding"; id: string }
  | { row: "files"; id: string; files: WrittenFile[] };

type Turn = { user: ChatItem | Extract<Row, { row: "pending" }> | null; interrupted: boolean; replied: boolean; last?: number; end?: number; tools: ChatItem[] };

const worst = (states: ChildState[]): ChildState => states.reduce<ChildState>((w, s) => (CHILD_STATES.indexOf(s) > CHILD_STATES.indexOf(w) ? s : w), "completed");

/** Folds the conversation's rows into what is drawn. `open` says a turn is under way and the
 * agent's process is alive (a working state restored from an earlier run is never live). */
export function fold(rows: Row[], open: boolean, cwd: string | null = null): View[] {
  const out: View[] = [];
  const tail: View[] = [];
  const rosters: { view: Extract<View, { row: "roster" }>; items: ChatItem[]; turn: Turn }[] = [];
  let turn: Turn = { user: null, interrupted: false, replied: false, tools: [] };
  const turns = [turn];
  let steps: Extract<View, { row: "steps" }> | null = null;
  let lastSteps: { view: Extract<View, { row: "steps" }>; turn: Turn } | null = null;
  let roster: (typeof rosters)[number] | null = null;
  const settle = (t: Turn) => {
    const at = t.end ?? out.length;
    // CHAT-028: the files the turn wrote sit under it, below the worked-for line.
    const written = writtenFiles(t.tools, WRITTEN_LIMIT, cwd);
    if (written.length > 0) out.splice(at, 0, { row: "files", id: `files-${t.user?.id ?? "start"}`, files: written });
    // CHAT-016: how long a settled turn took, at its end.
    if (t.user?.at === undefined || t.interrupted || !t.replied || t.last === undefined) return;
    const ms = t.last - t.user.at;
    // It sits under the turn's last reply, above any status line (a compaction) that followed.
    if (ms >= 1000) out.splice(at, 0, { row: "worked", id: `worked-${t.user.id}`, ms });
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.row !== "message") {
      // CHAT-02: a waiting send with a message after it is drawn in place and starts a turn of its
      // own, exactly as a user message row does; only a waiting send after everything goes to the tail.
      if (r.row === "pending" && rows.slice(i + 1).some((x) => x.row === "message")) {
        settle(turn);
        turn = { user: r, interrupted: false, replied: false, last: r.at, tools: [] };
        turns.push(turn);
        steps = null;
        roster = null;
        out.push(r);
        continue;
      }
      tail.push(r);
      continue;
    }
    if (r.role === "user") {
      settle(turn);
      turn = { user: r, interrupted: false, replied: false, last: r.at, tools: [] };
      turns.push(turn);
      steps = null;
      roster = null;
      out.push(r);
      continue;
    }
    const put = (v: View) => {
      out.push(v);
      if (r.role === "assistant") turn.end = out.length;
    };
    const end = Math.max(r.at ?? 0, r.tool?.endedAt ?? 0);
    if (end && r.role === "assistant") turn.last = Math.max(turn.last ?? 0, end);
    if (r.kind === "interrupted") {
      turn.interrupted = true;
      steps = null;
      put(r);
      continue;
    }
    if (r.role === "assistant") turn.replied = true;
    const tool = r.kind === "tool" ? r.tool : undefined;
    if (!tool) {
      steps = null;
      put(r);
      continue;
    }
    turn.tools.push(r);
    if (tool.group === "agent") {
      if (!roster) {
        roster = { view: { row: "roster", id: `roster-${r.id}`, children: [], verdict: "completed" }, items: [], turn };
        rosters.push(roster);
        put(roster.view);
      }
      roster.items.push(r);
      continue;
    }
    if (tool.diffs) {
      steps = null;
      put({ row: "diff", id: r.id, item: r });
      continue;
    }
    if (!steps) {
      steps = { row: "steps", id: `steps-${r.id}`, steps: [], live: false };
      lastSteps = { view: steps, turn };
      put(steps);
    }
    steps.steps.push(r);
  }
  const live = open && !turn.interrupted && turn.user !== null;
  if (!live) settle(turn);
  for (const { view, items, turn: t } of rosters) {
    view.children = items.map((r) => {
      const tool = r.tool!;
      const state: ChildState = tool.done ? (tool.failed ? "failed" : "completed") : t.interrupted ? "stopped" : live && t === turn ? "working" : "unverifiable";
      return { id: r.id, name: tool.name, label: tool.preview, state, at: r.at, endedAt: tool.endedAt, tokens: tool.tokens };
    });
    view.verdict = worst(view.children.map((c) => c.state));
  }
  if (live) {
    if (lastSteps && lastSteps.turn === turn) lastSteps.view.live = true;
    const latest = turn.tools[turn.tools.length - 1]?.tool;
    out.push({ row: "working", id: `working-${turn.user!.id}`, since: turn.user!.at, label: latest?.background ? "Monitoring background work" : "Working" });
  }
  out.push(...tail);
  // A send a Stop passed over (`held`) is not being answered: it shows as waiting, not as responding.
  if (tail.some((t) => t.row === "pending" && !t.held)) out.push({ row: "responding", id: "responding" });
  return out;
}

/** "42s", "1m 05s", "1h 02m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** CHAT-014: a card's diff as copied: every changed line starts with a plus or a minus. */
export function diffText(d: FileDiff): string {
  return d.lines
    .filter((l) => l.sign !== "@")
    .map((l) => l.sign + l.text)
    .join("\n");
}

/** CHAT-014: text is coloured as a diff only when it has hunk headers. */
export const looksLikeDiff = (text: string) => /^@@ .*@@/m.test(text);

/** How one line of diff-looking output is drawn; a row of dashes is a divider, not a removal. */
export function diffLineKind(line: string): "add" | "del" | "hunk" | "head" | "rule" | "" {
  if (/^-{3,}\s*$/.test(line)) return "rule";
  if (line.startsWith("+++") || line.startsWith("---")) return "head";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "";
}

/** CHAT-013: the only links in results that can be clicked are web links. */
export function linkParts(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: url, url });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** STAT-053 (T-027): the ids of the Thought rows, which the toolbar's Expand all opens together. */
export const thoughtIds = (items: { id: string; kind: string }[]) => items.filter((i) => i.kind === "thought").map((i) => i.id);

/** STAT-053 (T-027): one Thought row opened or folded; every other row keeps its state. */
export function toggled(open: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(open);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}
