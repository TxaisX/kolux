// A sidebar nav row with a right-click menu that hides it: AUTO-023's Automations row and SKILL-018's
// Skills button. One setting drives each row and its switch in Settings > Appearance.
import { useState, type ReactNode } from "react";
import { ContextMenu, Menu, MenuItem } from "../lazy/uiMenu";

type Props = { open: boolean; onOpen: () => void; onHide: () => void; label: string; icon: ReactNode; hideText: string };

export default function HideableRow({ open, onOpen, onHide, label, icon, hideText }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shut = () => setMenu(null);
  return (
    <>
      <button
        className={`row${open ? " on" : ""}`}
        aria-current={open ? "page" : undefined}
        onClick={onOpen}
        onPointerEnter={Menu.warm}
        onFocus={Menu.warm}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className="ic">{icon}</span>
        {label}
      </button>
      {menu && (
        <ContextMenu at={menu} onClose={shut} label={label}>
          <MenuItem onClick={onHide}>
            <span className="name">{hideText}</span>
          </MenuItem>
        </ContextMenu>
      )}
    </>
  );
}
