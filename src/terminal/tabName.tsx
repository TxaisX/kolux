// A tab's name and badge, and a seat's start line, moved out of App.tsx as they were (cycle 2, the App.tsx split).
import type { Pane } from "../App";
import { Bell, StatusGlyph } from "../chrome/icons";
import { baseName } from "../editor/buffers";
import { programWord } from "../launch/PlusMenu";
import { chooserTabName } from "../launch/chooserTab";
import { sessionNameFor } from "../sessions/tabTitles";
import { launchedName } from "../status/credit";
import { IDLE, followedTitle, type Identity } from "./shellMarks";
import { VOCAB } from "./status";
import type { Badge } from "./tabs";

/** What a tab is called: the seat's title, the agent, the browser page's title, or "Terminal N". */
/** TERM-058: a terminal tab follows the running program's title (`live`) unless the user named it; a worker's task label (ORCH-066) comes first. */
export function tabName(p: Pane, titles: Record<number, string>, label?: string, live: Record<number, Identity> = {}): string {
  if (p.kind === "browser") return p.title || titles[p.key] || "New Tab";
  if (p.kind === "editor") return baseName(p.path ?? "");
  if (p.kind === "preview") return `Preview ${baseName(p.path ?? "")}`;
  if (p.kind === "changes") return "All Changes";
  if (p.kind === "check") return p.check?.name || "Check"; // T-235-b: the check's name, never a path
  if (p.kind === "diff") return `${baseName(p.path ?? "")} (${p.staged ? "staged" : "unstaged"})`;
  // ORCH-066 / T-129-d: a worker's task label names the tab first; then the user's own name; then the program's title (TERM-058).
  if (label) return label;
  const chooser = chooserTabName(p); // T-577: "New session" until something starts in it
  if (chooser) return chooser;
  return followedTitle(p.title?.trim() ? p.title : sessionNameFor(p.key), live[p.key] ?? IDLE, p.agent !== "shell" ? programWord(p.agent) : launchedName(p) ?? `Terminal ${p.key}`);
}
/** TERM-055: the one badge a tab carries beside its agent icon; its look and hover text come from the vocabulary (STAT-052). */
export function TabBadge({ kind }: { kind: Badge }) {
  if (!kind) return null;
  if (kind === "unread")
    return (
      <span className="badge unread" role="img" aria-label="unread" data-tip="Finished or rang the bell while you were away.">
        <Bell size={11} />
      </span>
    );
  const v = VOCAB[kind];
  return (
    <span className={`badge ${kind}`} role="img" aria-label={kind === "permission" ? "needs permission" : kind} data-tip={v.explain}>
      <StatusGlyph glyph={v.glyph} size={11} />
    </span>
  );
}
/** SESS-051: a seat's start line as the back end builds it. */
export type StartLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };
