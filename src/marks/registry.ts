// T-335: the one table of vendor marks. Each entry names files in src/assets/vendors that came from
// the vendor's public brand kit (source, date, terms and a SHA-256 for each in NOTICE.md); nothing
// is redrawn here and nothing is fetched at run time (Txais, 2026-10-08). An id with no entry gets
// no vendor mark: AgentMark shows Kolux's neutral glyph and the name instead.
//
// `light` is the file shown on a light surface and `dark` the one for a dark surface. A vendor whose
// kit ships one coloured mark names the same file twice.

export type VendorMarkEntry = {
  /** Catalogue agent id (claude, codex, copilot) or tool id (github, vscode). */
  id: string;
  /** The product the mark names, as the picture's text alternative. */
  name: string;
  /** Who owns the mark (for NOTICE and the settings credit line). */
  maker: string;
  light: string;
  dark: string;
  /** Draw the picture this many times larger: for a kit file with a wide empty border (file unchanged, larger on screen). */
  scale?: number;
};

export const VENDOR_MARKS: readonly VendorMarkEntry[] = [
  { id: "claude", name: "Claude", maker: "Anthropic", light: "anthropic-claude-spark.svg", dark: "anthropic-claude-spark.svg" },
  // Claude Agent Teams runs Claude, so it wears the Claude spark (T-335-b).
  { id: "claude-agent-teams", name: "Claude Agent Teams", maker: "Anthropic", light: "anthropic-claude-spark.svg", dark: "anthropic-claude-spark.svg" },
  // Cursor's kit names its cube "DARK" when it is the pale one for dark surfaces and "LIGHT" for the dark one for light surfaces.
  { id: "cursor", name: "Cursor", maker: "Anysphere", light: "cursor-cube-for-light.svg", dark: "cursor-cube-for-dark.svg" },
  { id: "codex", name: "Codex", maker: "OpenAI", light: "openai-blossom-black.svg", dark: "openai-blossom-white.svg", scale: 1.9 },
  // Txais 2026-11-11: the featured agents in the seat picker wear their own kit marks.
  { id: "opencode", name: "OpenCode", maker: "Anomaly", light: "opencode-logo-for-light.svg", dark: "opencode-logo-for-dark.svg" },
  { id: "grok", name: "Grok", maker: "SpaceXSI", light: "grok-logomark-for-light.svg", dark: "grok-logomark-for-dark.svg" },
  { id: "copilot", name: "GitHub Copilot", maker: "GitHub", light: "github-copilot-icon-black.svg", dark: "github-copilot-icon-white.svg" },
  { id: "github", name: "GitHub", maker: "GitHub", light: "github-invertocat-black.svg", dark: "github-invertocat-white.svg" },
  { id: "vscode", name: "VS Code", maker: "Microsoft", light: "vscode-icon.svg", dark: "vscode-icon.svg" },
];

/**
 * T-335-b: a product with no public brand-kit icon file (none exists, or its host refuses) is shown as
 * its name in plain text beside Kolux's neutral glyph. These entries carry no picture; each still names
 * its product so no catalogue agent, open-in editor or shell is left without a name. Agent names are
 * the catalogue's own (src/keys/actions.ts). A product moves into VENDOR_MARKS the day a kit file is taken.
 */
export type NameOnlyEntry = { id: string; name: string };

export const NAME_ONLY: readonly NameOnlyEntry[] = [
  // Agent makers (catalogue ids).
  { id: "openclaude", name: "OpenClaude" },
  { id: "devin", name: "Devin" },
  { id: "ante", name: "Ante" },
  { id: "trae", name: "Trae" },
  { id: "autohand", name: "Autohand Code" },
  { id: "mimo-code", name: "MiMo Code" },
  { id: "pi", name: "Pi" },
  { id: "omp", name: "OMP" },
  { id: "prime-agent", name: "Prime Agent" },
  { id: "gemini", name: "Gemini" },
  { id: "antigravity", name: "Antigravity" },
  { id: "aider", name: "Aider" },
  { id: "goose", name: "Goose" },
  { id: "amp", name: "Amp" },
  { id: "kilo", name: "Kilocode" },
  { id: "kiro", name: "Kiro" },
  { id: "crush", name: "Charm" },
  { id: "aug", name: "Auggie" },
  { id: "cline", name: "Cline" },
  { id: "codebuff", name: "Codebuff" },
  { id: "command-code", name: "Command Code" },
  { id: "continue", name: "Continue" },
  { id: "droid", name: "Droid" },
  { id: "kimi", name: "Kimi" },
  { id: "mistral-vibe", name: "Mistral Vibe" },
  { id: "qwen-code", name: "Qwen Code" },
  { id: "rovo", name: "Rovo Dev" },
  { id: "hermes", name: "Hermes" },
  { id: "openclaw", name: "OpenClaw" },
  // Providers that appear only in usage views.
  { id: "minimax", name: "MiniMax" },
  // Open-in editors, shells and terminal apps (tool ids).
  { id: "windsurf", name: "Windsurf" },
  { id: "sublime", name: "Sublime Text" },
  { id: "zed", name: "Zed" },
  { id: "jetbrains", name: "JetBrains" },
  { id: "warp", name: "Warp" },
  { id: "ghostty", name: "Ghostty" },
  { id: "powershell", name: "PowerShell" },
  { id: "cmd", name: "Command Prompt" },
  { id: "wsl", name: "WSL" },
  { id: "git-for-windows", name: "Git for Windows" },
];

/** What an id is drawn as: a brand-kit picture, its name beside the neutral glyph, or nothing known. */
export type MarkKind = "kit" | "name" | "none";

export function markKind(id: string): MarkKind {
  if (vendorMark(id)) return "kit";
  return NAME_ONLY.some((n) => n.id === id) ? "name" : "none";
}

/** The product's name in plain text (kit or name-only entries), or undefined for an id the table does not know. */
export function productName(id: string): string | undefined {
  return vendorMark(id)?.name ?? NAME_ONLY.find((n) => n.id === id)?.name;
}

/** Where each kit file lives once built: Vite turns the glob into the bundled URL, so no path is typed by hand. */
const URLS = import.meta.glob("../assets/vendors/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** The bundled URL of a vendor file, or undefined when no such file ships. */
export function vendorUrl(file: string): string | undefined {
  return URLS[`../assets/vendors/${file}`];
}

/** Every file name that ships in the vendors folder. */
export function vendorFiles(): string[] {
  return Object.keys(URLS).map((k) => k.slice(k.lastIndexOf("/") + 1));
}

/** The mark for an agent or tool id, or null when the id has none (the caller then shows the neutral glyph). */
export function vendorMark(id: string): VendorMarkEntry | null {
  return VENDOR_MARKS.find((m) => m.id === id) ?? null;
}
