// PROJ-065: the workspace context menu, and T-055's delete rules for a workspace with children.
// Pure: the sidebar draws and runs what this lists.

export type MenuItem = { id: string; label: string; disabled?: boolean; danger?: boolean; /** A divider is drawn above this item. */ sep?: boolean; children?: MenuItem[] };

/** Arrow keys, Home and End inside an open menu: the index to focus next (wrapping), or null for any other key. */
export function menuMove(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % count;
  if (key === "ArrowUp") return at < 0 ? count - 1 : (at + count - 1) % count;
  return null;
}

/** The file manager's name follows the platform. */
export const fileManagerName = (platform: string): string => (/^mac|darwin/i.test(platform) ? "Finder" : /^win/i.test(platform) ? "Explorer" : "Files");

/** The note for a menu that opened with parts missing because a list could not be read; null when nothing failed. */
export function menuGaps(failed: { statuses?: boolean; editors?: boolean }): string | null {
  const gone = [failed.statuses && "Move to status", failed.editors && "the editors in Open in"].filter(Boolean);
  return gone.length ? `The menu is missing ${gone.join(" and ")}: that list could not be read.` : null;
}

export type MenuFor = {
  /** Rows the menu acts on: the right-clicked row, or the whole selection when it is part of it. */
  count: number;
  isMain: boolean;
  asleep: boolean;
  /** The workspace is being deleted right now. */
  deleting: boolean;
  platform: string;
  /** Alt (Option) was held as the menu opened. */
  alt: boolean;
  statuses: { id: string; label: string }[];
  editors: { label: string; command: string }[];
  /** Manual order is by drag; these two are the keyboard way. */
  reorder?: boolean;
  /** The row is the first / last of its siblings, so Move up / Move down is off. */
  first?: boolean;
  last?: boolean;
};

const REMOVE_PROJECT: MenuItem = { id: "proj:remove", label: "Remove project…", danger: true, sep: true };
const NEW_WORKSPACE: MenuItem = { id: "proj:new", label: "New workspace" };
/** Right-click on a project header. */
export const projectMenu = (): MenuItem[] => [NEW_WORKSPACE, { id: "proj:settings", label: "Project settings" }, REMOVE_PROJECT];
/** Right-click on a group row. */
export const groupMenu = (): MenuItem[] => [{ id: "grp:settings", label: "Group settings" }, { id: "grp:delete", label: "Delete group…", danger: true, sep: true }];

/**
 * What a right-click lists: Delete, Sleep or Wake, Move to status, Set parent, Open in (file
 * manager, editors, terminal), and a Developer submenu only for a single row with Alt held.
 * Several rows get the actions that make sense for a set; the main checkout is never deleted or slept.
 */
export function rowMenu(o: MenuFor): MenuItem[] {
  const one = o.count === 1;
  // T-749 (DT-C185): the main checkout row starts with the workspace action its project header has.
  const items: MenuItem[] = one && o.isMain ? [NEW_WORKSPACE] : [];
  if (!o.isMain) items.push({ id: "delete", label: one ? "Delete" : `Delete ${o.count} workspaces`, danger: true, disabled: o.deleting });
  if (!o.isMain) items.push({ id: o.asleep && one ? "wake" : "sleep", label: o.asleep && one ? "Wake" : "Sleep" });
  if (o.statuses.length > 0) items.push({ id: "status", label: "Move to status", children: [...o.statuses.map((s) => ({ id: `status:${s.id}`, label: s.label })), { id: "statuses:edit", label: "Edit statuses…" }] });
  if (one && !o.isMain) items.push({ id: "parent", label: "Set parent…" });
  if (one) items.push({ id: "details", label: "Details…" });
  if (one) {
    items.push({
      id: "open-in",
      label: "Open in",
      disabled: o.deleting,
      children: [
        { id: "open:files", label: fileManagerName(o.platform) },
        ...o.editors.map((e) => ({ id: `open:editor:${e.command}`, label: e.label })),
        { id: "open:terminal", label: "Terminal" },
      ],
    });
  }
  // Reordering steps among siblings only: never on the main checkout, and the ends of the siblings cannot go further.
  if (one && o.reorder && !o.isMain) items.push({ id: "move:up", label: "Move up", disabled: o.first }, { id: "move:down", label: "Move down", disabled: o.last });
  if (one && !o.isMain) items.push({ id: "hide", label: "Hide from the sidebar" });
  if (one && o.alt) items.push({ id: "developer", label: "Developer", children: [{ id: "dev:copy-path", label: "Copy path" }, { id: "dev:copy-branch", label: "Copy branch name" }] });
  // The main checkout cannot be hidden or deleted, so its way out is removing the project.
  if (one && o.isMain) items.push(REMOVE_PROJECT);
  return items;
}

type Node = { path: string; parent?: string | null };
const key = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Every workspace made from `path`, at any depth (a loop in the records is cut). */
export function descendants(path: string, all: Node[]): string[] {
  const seen = new Set([key(path)]);
  const out: string[] = [];
  for (let layer = [key(path)]; layer.length; ) {
    const next: string[] = [];
    for (const w of all) {
      const k = key(w.path);
      if (w.parent && layer.includes(key(w.parent)) && !seen.has(k)) {
        seen.add(k);
        next.push(k);
        out.push(w.path);
      }
    }
    layer = next;
  }
  return out;
}

export type DeletePlan = {
  /** Paths in deletion order: the deepest children first, every parent after its children. */
  order: string[];
  /** A workspace with children offers only to delete them all. */
  withChildren: boolean;
  /** A parent or a batch always asks, even with the question switched off. */
  mustAsk: boolean;
};

/** What Delete does for the chosen rows: each chosen workspace takes its descendants along, children before parents. */
export function deletePlan(chosen: string[], all: Node[], asks: boolean): DeletePlan {
  const depth = new Map<string, number>();
  const parentOf = new Map(all.map((w) => [key(w.path), w.parent ? key(w.parent) : ""]));
  const levels = (p: string) => {
    let n = 0;
    const seen = new Set<string>();
    for (let k = parentOf.get(key(p)); k && parentOf.has(k) && !seen.has(k); k = parentOf.get(k)) {
      seen.add(k);
      n++;
    }
    return n;
  };
  const set = new Map<string, string>();
  let withChildren = false;
  for (const c of chosen) {
    set.set(key(c), c);
    for (const d of descendants(c, all)) {
      withChildren = true;
      set.set(key(d), d);
    }
  }
  for (const p of set.values()) depth.set(key(p), levels(p));
  const order = [...set.values()].sort((a, b) => (depth.get(key(b)) ?? 0) - (depth.get(key(a)) ?? 0));
  return { order, withChildren, mustAsk: asks || withChildren || order.length > 1 };
}
