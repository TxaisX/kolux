// PROJ-009: a project header shows the folder name alone, and only a name another project shares
// gets enough of its path to tell the two apart. A long label is shortened and the full text goes
// into the hover title, but only when the label really overflows.

import { middle, pathHints } from "./model";

type Named = { id: string; name: string; path: string };

/** The longest a path fragment in a header is allowed to be before its middle is taken out. */
export const HINT_MAX = 28;

export type HeaderLabel = { name: string; hint: string | null; hintCut: string | null };

/** One label per project id: the name, and for a clashing name the shortened path fragment. */
export function headerLabels(projects: Named[]): Record<string, HeaderLabel> {
  const hints = pathHints(projects);
  return Object.fromEntries(
    projects.map((p) => [p.id, { name: p.name, hint: hints[p.id] ?? null, hintCut: hints[p.id] ? middle(hints[p.id], HINT_MAX) : null }]),
  );
}

/** Text really overflows its box only when it needs more room than the box has. */
export const overflows = (scrollWidth: number, clientWidth: number): boolean => scrollWidth > clientWidth;

