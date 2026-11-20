// PROJ-062 / SET-021 (T-270, T-266): what a workspace card in the sidebar shows besides its name and
// status dot. Three presets - Compact (status only), Default (status, an agent summary and the changed-file
// count, T-609) and
// Detailed (adds the pull request, the changed-file count and the workspace's note) - or a list of
// separate details the user ticks one by one (T-266's chooser).
//
// Saved as two settings: `workspaceCardDensity` (the preset) and `workspaceCardDetails` (a custom
// list; empty or missing means "follow the preset", so a preset picks up details added in later
// versions, and an older profile never gets a duplicate). The sidebar chooser saves one key per
// tick, so when the ticked set equals a preset it writes that preset's marker ("preset:compact") as
// the whole list: the marker means "follow this preset" and wins over `workspaceCardDensity`.
//
// For a later card that adds a detail (T-291-d's Automation tag is one, in no preset): add one entry to CARD_DETAILS
// (its `line` reads a new field of `CardFacts`, which ProjectsPanel fills), name it in the presets
// that should show it, and nothing else changes. The chooser, the Settings page and the saved
// forms all read this list.
import type { PrState } from "../projects/rows";
import { VOCAB, type StatusKey } from "../terminal/status";

export const CARD_DENSITY_FIELD = "workspaceCardDensity";
export const CARD_DETAILS_FIELD = "workspaceCardDetails";

export const DENSITIES = ["default", "compact", "detailed"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_LABEL: Record<Density, string> = { default: "Default", compact: "Compact", detailed: "Detailed" };
export const DENSITY_NOTE: Record<Density, string> = {
  default: "Status, an agent summary and the changed-file count under the name.",
  compact: "One line per workspace; the rest shows when you hover it.",
  detailed: "Status, agents, pull request, changed files and the note.",
};

/** What the sidebar knows about one workspace, for the cards to draw. */
export type CardFacts = { agents: number; state: StatusKey; pr: PrState; changed: number; note: string | null; /** PROJ-062 (T-266-b): the ports the workspace listens on, sorted; missing or empty means none. */ ports?: readonly number[]; /** PROJ-062 (T-266-b): the issue or pull request number the workspace is linked to (its task); missing or null means none. */ task?: number | null };

export type CardDetail = {
  id: string;
  label: string;
  /** Status is the dot; it is on in every preset and cannot be switched off (PROJ-062). */
  locked?: boolean;
  /** The words this detail adds to the card's second line, or null when there is nothing to say. */
  line: (f: CardFacts) => string | null;
};

const PR_WORDS: Record<string, string> = { open: "Pull request open", draft: "Draft pull request", merged: "Pull request merged", closed: "Pull request closed" };

const PORTS_SHOWN = 4;
/** "Port 5173" / "Ports 3000, 5173" (four at most, then "+2 more"), or null for none. */
export function portsWords(ports: readonly number[]): string | null {
  const list = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))].sort((a, b) => a - b);
  if (!list.length) return null;
  const shown = list.slice(0, PORTS_SHOWN).join(", ");
  return `${list.length === 1 ? "Port" : "Ports"} ${shown}${list.length > PORTS_SHOWN ? ` +${list.length - PORTS_SHOWN} more` : ""}`;
}

export const CARD_DETAILS: readonly CardDetail[] = [
  { id: "status", label: "Status", locked: true, line: () => null },
  {
    id: "agents",
    label: "Agent summary",
    line: (f) => {
      if (f.agents <= 0 && (f.state === "idle" || f.state === "stopped")) return null;
      const word = f.state === "idle" ? "" : VOCAB[f.state].word;
      const n = f.agents > 0 ? `${f.agents} ${f.agents === 1 ? "agent" : "agents"}` : "";
      return [n, word].filter(Boolean).join(" · ") || null;
    },
  },
  { id: "pr", label: "Pull request", line: (f) => (f.pr ? PR_WORDS[f.pr] ?? null : null) },
  { id: "changes", label: "Changed files", line: (f) => (f.changed > 0 ? `${f.changed} changed ${f.changed === 1 ? "file" : "files"}` : null) },
  {
    id: "note",
    label: "Note",
    line: (f) => {
      const first = (f.note ?? "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
      return first ? (first.length > 60 ? first.slice(0, 59) + "…" : first) : null;
    },
  },
  // PROJ-062 (T-266-b): what Compact adds on hover. In no preset: the user ticks them to put them on the card.
  { id: "ports", label: "Ports", line: (f) => portsWords(f.ports ?? []) },
  { id: "task", label: "Task", line: (f) => (f.task ? `Task #${f.task}` : null) },
];

export const PRESETS: Record<Density, readonly string[]> = {
  compact: ["status"],
  default: ["status", "agents", "changes"],
  detailed: ["status", "agents", "pr", "changes", "note"],
};

const MARK = "preset:";
/** The one-entry list the chooser saves when a ticked set equals a preset: it follows that preset. */
export const presetMark = (d: Density): string => MARK + d;
const isMark = (saved: unknown): saved is [string] => Array.isArray(saved) && saved.length === 1 && typeof saved[0] === "string" && saved[0].startsWith(MARK);
const markedPreset = (saved: unknown): Density | null => (isMark(saved) && (DENSITIES as readonly string[]).includes(saved[0].slice(MARK.length)) ? (saved[0].slice(MARK.length) as Density) : null);

const known = new Set(CARD_DETAILS.map((d) => d.id));
/** Known ids only, once each, in the list's own order, with the locked ones always in. */
export const tidyDetails = (v: unknown): string[] => {
  const asked = new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return CARD_DETAILS.filter((d) => d.locked || asked.has(d.id)).map((d) => d.id);
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
export const densityOf = (v: unknown): Density => ((DENSITIES as readonly string[]).includes(v as string) ? (v as Density) : "default");

/** The cards' details now: the custom list when one is saved, else the preset. `density` is the
 *  preset the set equals, or "custom". */
export function readCardDetails(settings: Record<string, unknown>): { shown: string[]; density: Density | "custom" } {
  const saved = settings[CARD_DETAILS_FIELD];
  const marked = markedPreset(saved);
  const custom = !isMark(saved) && Array.isArray(saved) && saved.length > 0 ? tidyDetails(saved) : null;
  const shown = custom ?? tidyDetails(PRESETS[marked ?? densityOf(settings[CARD_DENSITY_FIELD])]);
  const preset = DENSITIES.find((d) => sameSet(tidyDetails(PRESETS[d]), shown));
  return { shown, density: preset ?? "custom" };
}

export const cardShows = (settings: Record<string, unknown>, id: string): boolean => readCardDetails(settings).shown.includes(id);

/** Choosing a preset: the preset is saved and any custom list is cleared. */
export const densityPatch = (d: Density): Record<string, unknown> => ({ [CARD_DENSITY_FIELD]: d, [CARD_DETAILS_FIELD]: [] });

/** The second line under a workspace's name: the shown details' words joined, or null for none. */
export function cardLine(shown: readonly string[], f: CardFacts): string | null {
  const words = CARD_DETAILS.filter((d) => shown.includes(d.id)).flatMap((d) => d.line(f) ?? []);
  return words.length ? words.join(" · ") : null;
}

/** What a hover adds for the details the card does not show (Compact: everything but the status). */
export function hoverLines(shown: readonly string[], f: CardFacts): string[] {
  return CARD_DETAILS.filter((d) => !shown.includes(d.id)).flatMap((d) => d.line(f) ?? []);
}

/** The hover text of a card (PROJ-062): the full name and branch (a long title shows again even when
 *  the branch is also shown), then whatever the card leaves out, then `base` (where it lives). */
export function cardTitle(name: string, branch: string | null, shown: readonly string[], f: CardFacts, base: string): string {
  return [name, branch && branch !== name ? `Branch ${branch}` : null, ...hoverLines(shown, f), base].filter(Boolean).join("\n");
}

/** The `workspaceCardDetails` list after ticking or unticking one detail: the one setting the sidebar
 *  chooser saves (status stays in). A set that equals a preset comes back as that preset's marker, so
 *  the card keeps following the preset; any other set comes back as the list itself. */
export const detailsAfter = (settings: Record<string, unknown>, id: string, on: boolean): string[] => {
  const now = readCardDetails(settings).shown;
  const next = tidyDetails(!known.has(id) ? now : on ? [...now, id] : now.filter((x) => x !== id));
  const preset = DENSITIES.find((d) => sameSet(tidyDetails(PRESETS[d]), next));
  return preset ? [presetMark(preset)] : next;
};
