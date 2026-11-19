// The shape of one skills scan (src-tauri/src/skills.rs), which the chat composer's / autocomplete reads.

export type Source = "home" | "workspace" | "bundled" | "plugin";
export type AgentId = "claude" | "codex" | "grok" | "hermes" | "shared";

export type Skill = {
  name: string;
  description: string | null;
  updated: number | null;
  path: string;
  source: Source;
  agents: AgentId[];
  plugin: string | null;
};

export type Root = {
  path: string;
  label: string;
  source: Source;
  agents: AgentId[];
  state: "scanned" | "partial" | "not-found" | "not-scanned" | "error";
  count: number;
  note: string | null;
};

export type Scan = { skills: Skill[]; roots: Root[] };
