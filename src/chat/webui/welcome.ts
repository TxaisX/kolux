// The empty chat's words and marks (2026-11-24). The three starters are the ones the pane already offered;
// now a chip fills the box instead of sending, so the person can change it first.

export type Starter = { label: string; text: string };

export const STARTERS: readonly Starter[] = [
  { label: "Explain this project", text: "Explain what this project does, in plain words." },
  { label: "Find a bug", text: "Look through this project and find the most likely bug. Tell me what you find before changing anything." },
  { label: "Suggest an improvement", text: "Suggest one improvement to this project and explain why it matters." },
];

/** The mark Kolux holds for a maker (src/marks/registry.ts), or null: a maker with no brand-kit file gets the neutral glyph, never another maker's logo. */
const MARKS: Record<string, string> = { anthropic: "claude", openai: "codex", "x-ai": "grok" };
export const markFor = (provider: string): string | null => MARKS[provider] ?? null;
