// TERM-094 / VIEW-105: the link action menu, drawn at the pointer over the link. The rows and what each does are
// decided in linkMenu.ts (pure); this only draws them, as a src/ui context menu (which keeps it on screen, takes focus
// to the first row and back, and closes on Escape or a click outside). Copy keeps the menu open and says whether the
// copy landed; every other row closes it.
import { useState } from "react";
import { ContextMenu, MenuItem } from "../ui/Menu";
import type { LinkItem, LinkItemId } from "./linkMenu";

type Props = {
  at: { top: number; left: number };
  destination: string;
  items: LinkItem[];
  /** Runs a row. Copy resolves to whether the clipboard took it; the other rows close the menu. */
  onPick: (id: LinkItemId) => Promise<boolean> | void;
  onDismiss: () => void;
};

export { menuStep } from "./PaneMenu";

export default function LinkActionMenu({ at, destination, items, onPick, onDismiss }: Props) {
  const [copied, setCopied] = useState<null | boolean>(null);
  const pick = (id: LinkItemId) => {
    if (id !== "copy") return void onPick(id);
    void Promise.resolve(onPick(id)).then((ok) => setCopied(ok !== false));
  };
  return (
    <ContextMenu at={{ x: at.left, y: at.top }} onClose={() => onDismiss()} label="Link menu" className="pane-menu link-menu" style={{ maxWidth: "min(480px, calc(100vw - 16px))" }}>
      <div className="muted" title={destination} style={{ padding: "4px 8px 6px", overflowWrap: "anywhere", userSelect: "text" }}>
        {destination}
      </div>
      <div role="separator" style={{ height: 1, margin: "0 6px 4px", background: "var(--line-strong)" }} />
      {items.map((it) => (
        <MenuItem key={it.id} closeOnClick={it.id !== "copy"} onClick={() => pick(it.id)}>
          <span className="name">{it.id === "copy" && copied !== null ? (copied ? "Copied" : "Could not copy") : it.name}</span>
        </MenuItem>
      ))}
    </ContextMenu>
  );
}
