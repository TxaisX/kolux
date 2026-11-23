// Txais (2026-11-21): what each context reader last found (Rust `handoff_reads`). A reader that cannot
// read its store used to answer nothing, so a pane that could never hand off looked exactly like one
// that simply had not filled yet. The row says which store it looked for and why it failed, so a
// session that will not clear itself is something the window says rather than something you find out.
import { shortTokens } from "../usage/meter";

export type ReaderHealth = {
  agent: string;
  /** `reading`, `nothing`, `failed`, or `never` (nothing has run since Kolux started). */
  state: string;
  detail: string;
  tokens?: number | null;
  ageMs?: number | null;
};

const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok" };

export const readerName = (agent: string): string => NAMES[agent] ?? agent;

/** 12 s ago, 3 min ago, 2 h ago: how long ago a reading was taken. */
export function ago(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 10_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return `${Math.round(ms / 3_600_000)} h ago`;
}

/** The one line a reader's row shows, and whether it is a problem to look at. */
export function readerLine(h: ReaderHealth): { text: string; ok: boolean } {
  const token = h.tokens === null || h.tokens === undefined ? null : shortTokens(h.tokens);
  if (h.state === "failed") return { ok: false, text: h.detail || "Its store could not be read." };
  if (h.state === "never") return { ok: true, text: "Has not run since Kolux started." };
  if (h.state === "nothing") return { ok: true, text: "Read, but this agent has not written a turn since this start." };
  return { ok: true, text: token ? `Read ${token} ${ago(h.ageMs)}`.trim() : "Read." };
}
