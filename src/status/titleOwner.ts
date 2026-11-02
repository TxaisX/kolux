// T-124-b (STAT-033, rest): which agent a terminal title belongs to is decided only by marks the agent
// itself prints: its name in a fixed place (the title's first words, or the last part after a
// separator such as " - ") or a vendor marker (Claude Code's leading star, the pi sign Pi-style
// agents print). Never by a name inside the task text, a worktree name or a model name alone.
// Conflicting marks give unknown, and the order of the title's parts never decides. Pure; credit.ts
// (SESS-040) and, through evidence/hooks-T-124-b-shellMarks.ts.patch, TERM-058's agentFromTitle use it.

export type TitleOwner = {
  /** The catalogue agents the marks point to (the pi sign fits both Pi and OMP); empty when none. */
  owners: string[];
  /** The marks disagree: nobody is credited. */
  unknown: boolean;
};

const NONE: TitleOwner = { owners: [], unknown: false };
const UNKNOWN: TitleOwner = { owners: [], unknown: true };

// A name counts only as the whole first part, its first two words, its first word, or the whole last part.
const NAMES: readonly (readonly [RegExp, readonly string[]])[] = [
  [/^claude( code)?$/i, ["claude"]],
  [/^codex( cli)?$/i, ["codex"]],
  [/^cursor([- ]agent)?$/i, ["cursor"]],
  [/^gemini( cli)?$/i, ["gemini"]],
  [/^mimo([- ]code)?$/i, ["mimo-code"]],
  [/^(omp|oh-my-pi)$/i, ["omp"]],
  [/^(pi|π)$/i, ["pi", "omp"]],
];

// Vendor markers: printed by the agent itself at the start of its title. Gemini CLI's are its
// status icons (T-124-d, public settings reference): Ready ◇, Action Required ✋, Working ✦; some
// programs and terminals add the emoji presentation selector (U+FE0F) after an icon, so it is allowed.
const MARKERS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/^✳/, ["claude"]],
  [/^π(?=\s|$)/, ["pi", "omp"]],
  [/^[◇✋✦]️?(?=\s|$)/u, ["gemini"]],
];

// A model name after an agent's name is the model, not the agent ("Claude Sonnet 4", "Claude 3.7").
const MODEL_WORD = /^(sonnet|opus|haiku|instant|\d[\w.-]*|gpt[\w.-]*|o\d[\w.-]*)$/i;
const SEPARATOR = /\s+[-|·—–]\s+|:\s+/;
// Spinner frames, quarter circles and other leading decoration (and a presentation selector) before the first word.
const LEADING_GLYPHS = /^[\s⠀-⣿◐◓◑◒✳✢✶✻✽◇✋✦️·•*>]+/u;
const PATH = /^(~|[a-zA-Z]:[\\/]|\\\\|\.{0,2}\/)/;

function match(table: typeof NAMES, text: string): readonly string[] | null {
  for (const [re, ids] of table) if (re.test(text)) return ids;
  return null;
}

function nameAtStart(part: string): readonly string[] | null {
  const words = part.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const whole = match(NAMES, words.join(" "));
  if (whole) return whole;
  if (words.length >= 2) {
    const two = match(NAMES, `${words[0]} ${words[1]}`);
    if (two) return two;
  }
  const one = match(NAMES, words[0]);
  if (!one) return null;
  return words.length >= 2 && MODEL_WORD.test(words[1]) ? null : one;
}

const overlap = (a: readonly string[], b: readonly string[]) => a.some((x) => b.includes(x));

/** Merge marks of one kind: any two that share no agent conflict. */
function agree(found: (readonly string[])[]): TitleOwner {
  if (found.length === 0) return NONE;
  let owners = [...found[0]];
  for (const f of found.slice(1)) {
    if (!overlap(owners, f)) return UNKNOWN;
    owners = owners.filter((o) => f.includes(o));
  }
  return { owners, unknown: false };
}

/** The agent a terminal title belongs to, by the marks the agent itself prints (STAT-033). */
export function titleOwner(title: string): TitleOwner {
  const t = title.trim();
  if (t === "" || PATH.test(t) || (/[\\/]/.test(t) && !/\s/.test(t))) return NONE;
  const marker = match(MARKERS, t);
  const parts = t.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const names: (readonly string[])[] = [];
  const first = nameAtStart((parts[0] ?? "").replace(LEADING_GLYPHS, ""));
  if (first) names.push(first);
  if (parts.length > 1) {
    const last = match(NAMES, parts[parts.length - 1].replace(LEADING_GLYPHS, ""));
    if (last) names.push(last);
  }
  const byName = agree(names);
  if (byName.unknown) return UNKNOWN;
  if (!marker) return byName;
  // A vendor marker and a name that disagree are conflicting marks too.
  if (byName.owners.length > 0 && !overlap(byName.owners, marker)) return UNKNOWN;
  return { owners: byName.owners.length > 0 ? byName.owners.filter((o) => marker.includes(o)) : [...marker], unknown: false };
}
