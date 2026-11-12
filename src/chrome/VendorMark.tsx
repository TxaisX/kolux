// Model marks: a vendor's own public symbol stands for its agent (nominative use; Txais's call
// of 2026-10-08: vendor logos come only from public brand kits). The files live in
// src/assets/vendors with their source, terms and hash in NOTICE.md, and src/marks/registry.ts
// is the one table that says which agent or tool wears which file (T-335). An id with no kit file
// gets Kolux's neutral spark glyph and its name. A plain shell keeps Kolux's neutral prompt glyph
// (TERM-020).
import AgentMark from "../marks/AgentMark";
import { Shell } from "./icons";

export type Agent = "claude" | "codex" | "copilot" | "cursor" | "grok" | "opencode" | "shell";

export default function VendorMark({ agent, size = 13 }: { agent: Agent; size?: number }) {
  if (agent === "shell") return <Shell size={size} />;
  return <AgentMark id={agent} size={size} />;
}
