// EDIT-048 (T-317): typing into the repository or base-branch picker narrows its list. The list is cut to a
// manageable length (the count left out is reported), so a thousand branches stay responsive.

export const PICKER_LIMIT = 50;

/** The items containing every word of `query` (any case), best first: prefix matches, then the rest in the
 * order given, at most `limit` of them; `more` counts matches left out. */
export function pickList(items: readonly string[], query: string, limit = PICKER_LIMIT): { shown: string[]; more: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const first: string[] = [];
  const rest: string[] = [];
  for (const it of items) {
    const low = it.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    (words.length && low.startsWith(words[0]) ? first : rest).push(it);
  }
  const all = [...first, ...rest];
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
