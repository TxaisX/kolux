// A menu over Base UI's Menu, drawn as Kolux's .menu with .menu-item rows. Base UI gives the arrow keys, Home/End,
// typeahead, focus in and back, and closing on a click outside or a picked row; Escape and stacking are layer.ts's.
// It hangs from an element (a "More" button) or, as a context menu, from the point that was right-clicked.
import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Menu as Base } from "@base-ui/react/menu";
import { pointAnchor, useLayer } from "./layer";
import "./ui.css";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";
type Point = { x: number; y: number };

export type MenuProps = {
  open: boolean;
  onClose: () => void;
  /** The menu's accessible name. */
  label: string;
  /** The element the menu hangs from. */
  anchor?: RefObject<Element | null> | Element | null;
  /** Or a point on screen: a context menu opens where the mouse was. */
  at?: Point | null;
  side?: Side;
  align?: Align;
  /** Pixels between the anchor and the menu. */
  offset?: number;
  /** Extra classes after "menu". */
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
  children: ReactNode;
};

export function Menu({ open, onClose, label, anchor, at, side = "bottom", align = "start", offset = 0, className, style, children, ...p }: MenuProps) {
  const popup = useRef<HTMLDivElement>(null);
  useLayer(open, onClose, popup);
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Positioner className="ui-positioner" anchor={at ? pointAnchor(at.x, at.y) : anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} positionMethod="fixed">
          <Base.Popup ref={popup} className={className ? `menu ${className}` : "menu"} aria-label={label} style={style} {...p}>
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

/** A context menu: a Menu at the right-clicked point, opening down and to the right (it flips when there is no room). */
export const ContextMenu = ({ at, ...p }: Omit<MenuProps, "anchor" | "at" | "open"> & { at: Point | null }) => <Menu {...p} open={at !== null} at={at} />;

type ItemProps = { className?: string; title?: string; disabled?: boolean; onClick?: () => void; closeOnClick?: boolean; children: ReactNode; "data-testid"?: string };

/** A row. Picking it closes the menu (closeOnClick false keeps it open). */
export const MenuItem = ({ className = "menu-item", onClick, ...p }: ItemProps) => <Base.Item nativeButton render={<button type="button" />} className={className} onClick={() => onClick?.()} {...p} />;

/** A row with a tick (role="menuitemcheckbox"); it stays open when picked, like the status bar's item list. */
export const MenuCheckboxItem = ({ checked, onCheckedChange, className = "menu-item", children, ...p }: Omit<ItemProps, "onClick" | "closeOnClick"> & { checked: boolean; onCheckedChange: (on: boolean) => void }) => (
  <Base.CheckboxItem nativeButton render={<button type="button" />} checked={checked} onCheckedChange={(on) => onCheckedChange(on)} closeOnClick={false} className={className} {...p}>
    {children}
  </Base.CheckboxItem>
);

/** The small caps heading at the top of a menu. */
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="menu-title">{children}</div>;
