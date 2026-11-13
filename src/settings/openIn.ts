// SET-039 (T-323): the outside apps listed under every Open in menu (worktrees, files, the
// keybindings file). Presets cover common editors; a custom entry has a name and a command and is
// saved only once both are filled in. Rows saved without an id are matched to a preset by command.
export const OPEN_IN_FIELD = "openInApps";

export type OpenInApp = { id: string; name: string; command: string };

export const PRESETS: OpenInApp[] = [
  { id: "explorer", name: "File Explorer", command: "explorer" },
  { id: "vscode", name: "Visual Studio Code", command: "code" },
  { id: "cursor", name: "Cursor", command: "cursor" },
  { id: "windsurf", name: "Windsurf", command: "windsurf" },
  { id: "zed", name: "Zed", command: "zed" },
  { id: "sublime", name: "Sublime Text", command: "subl" },
  { id: "idea", name: "IntelliJ IDEA", command: "idea" },
  { id: "terminal", name: "Windows Terminal", command: "wt -d" },
];

/** The list when nothing is saved yet. */
export const DEFAULT_APPS = ["explorer", "vscode"].map((id) => PRESETS.find((p) => p.id === id)!);

const squash = (c: string) => c.trim().replace(/\s+/g, " ").toLowerCase();

/** The saved list, tidied: bad rows drop out, a row with no id is a preset when its command is one,
 *  and the first row of an id wins. */
export function readOpenIn(s: Record<string, unknown>): OpenInApp[] {
  const saved = s[OPEN_IN_FIELD];
  if (!Array.isArray(saved)) return DEFAULT_APPS;
  const seen = new Set<string>();
  return saved.flatMap((r: unknown) => {
    if (!r || typeof r !== "object") return [];
    const { id, command, label } = r as Record<string, unknown>;
    const name = (r as Record<string, unknown>).name ?? label; // rows saved by the first Open in list (T-237-a) used "label"
    if (typeof command !== "string" || !command.trim()) return [];
    const preset = PRESETS.find((p) => (typeof id === "string" ? p.id === id : squash(p.command) === squash(command)));
    const row: OpenInApp | null = preset ?? (typeof name === "string" && name.trim() ? { id: typeof id === "string" && id ? id : "custom:" + squash(command), name: name.trim(), command: command.trim() } : null);
    if (!row || seen.has(row.id)) return [];
    seen.add(row.id);
    return [row];
  });
}

/** A custom entry being typed: saved only when both fields are filled in. */
export const draftReady = (d: { name: string; command: string }) => d.name.trim() !== "" && d.command.trim() !== "";

export const addApp = (list: OpenInApp[], app: OpenInApp): OpenInApp[] => (list.some((a) => a.id === app.id) ? list : [...list, app]);
export const addCustom = (list: OpenInApp[], d: { name: string; command: string }): OpenInApp[] => (draftReady(d) ? addApp(list, { id: "custom:" + squash(d.command), name: d.name.trim(), command: d.command.trim() }) : list);
export const removeApp = (list: OpenInApp[], id: string) => list.filter((a) => a.id !== id);
export function moveApp(list: OpenInApp[], id: string, by: -1 | 1): OpenInApp[] {
  const i = list.findIndex((a) => a.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The presets not in the list yet, for the Add menu. */
export const presetsLeft = (list: OpenInApp[]) => PRESETS.filter((p) => !list.some((a) => a.id === p.id));
