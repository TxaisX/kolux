// A stand-in for src/ui/Menu in a test that server-renders a page to read what an open menu offers. The real Menu is
// drawn in a portal once Base UI is read, so renderToString shows nothing of it; this draws the same box in place, a
// .menu with its role, name and rows (buttons with role menuitem). The arrow keys, focus, Escape and the click outside
// are the wrapper's, proved on a real DOM in src/ui/ui.dom.test.tsx. Use it as:
//   vi.mock("../ui/Menu", async () => (await import("../tasks/menuStandIn")).menuModule);
import { createElement, type ReactNode } from "react";

type MenuProps = { open?: boolean; at?: unknown; label: string; className?: string; plain?: boolean; children: ReactNode; [k: string]: unknown };
type ItemProps = { className?: string; title?: string; disabled?: boolean; onClick?: () => void; children: ReactNode; [k: string]: unknown };

function Menu({ open = true, label, className, plain, children, "data-testid": testId }: MenuProps) {
  if (!open) return null;
  return createElement("div", { role: "menu", "aria-label": label, className: plain ? className : className ? `menu ${className}` : "menu", "data-testid": testId }, children);
}
const ContextMenu = (p: MenuProps) => Menu({ ...p, open: p.at !== null && p.at !== undefined });
const MenuItem = ({ className = "menu-item", onClick, closeOnClick: _c, children, ...p }: ItemProps) => createElement("button", { type: "button", role: "menuitem", className, onClick: () => onClick?.(), ...p }, children);
const MenuCheckboxItem = ({ className = "menu-item", checked, onCheckedChange, children, ...p }: ItemProps & { checked: boolean; onCheckedChange: (on: boolean) => void }) =>
  createElement("button", { type: "button", role: "menuitemcheckbox", "aria-checked": checked, className, onClick: () => onCheckedChange(!checked), ...p }, children);
const MenuTitle = ({ children }: { children: ReactNode }) => createElement("div", { className: "menu-title" }, children);

export const menuModule = { Menu, ContextMenu, MenuItem, MenuCheckboxItem, MenuTitle };
