// A menu over Base UI's Menu, drawn as Kolux's .menu with .menu-item rows. Base UI gives the arrow keys, Home/End,
// typeahead, focus in and back, and closing on a click outside or a picked row; Escape and stacking are layer.ts's.
// It hangs from an element (a "More" button) or, as a context menu, from the point that was right-clicked.
// Base UI itself is read on demand (part.ts); the rows draw only inside an open menu, so they are Base UI's from the start.
import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLayer, type CloseWhy } from "./layer";
import { useBase } from "./part";
import type { ItemProps } from "./base";
import "./ui.css";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";
type Point = { x: number; y: number };
type Focus = boolean | RefObject<HTMLElement | null> | (() => HTMLElement | null | boolean | void);

export type MenuProps = {
  open: boolean;
  onClose: (why: CloseWhy) => void;
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
  /** Draw with `className` alone, not Kolux's .menu box (a list with a look of its own, the board's Move to). */
  plain?: boolean;
  /** Extra classes on the positioner, for a menu that must sit above a dialog (a higher --z-* token). */
  positioner?: string;
  style?: CSSProperties;
  /** Where focus goes on close (default: what had it before the menu opened). */
  finalFocus?: Focus;
  "data-testid"?: string;
  children: ReactNode;
};

export function Menu({ open, onClose, side = "bottom", align = "start", offset = 0, ...p }: MenuProps) {
  const popup = useRef<HTMLDivElement>(null);
  useLayer(open, onClose, popup);
  const base = useBase(open);
  return base && open ? <base.MenuBox popup={popup} onClose={onClose} side={side} align={align} offset={offset} {...p} /> : null;
}

/** A context menu: a Menu at the right-clicked point, opening down and to the right (it flips when there is no room). */
export const ContextMenu = ({ at, ...p }: Omit<MenuProps, "anchor" | "at" | "open"> & { at: Point | null }) => <Menu {...p} open={at !== null} at={at} />;

/** A row. Picking it closes the menu (closeOnClick false keeps it open). */
export function MenuItem(p: ItemProps) {
  const base = useBase(true);
  return base ? <base.MenuItemBox {...p} /> : null;
}

/** A row with a tick (role="menuitemcheckbox"); it stays open when picked, like the status bar's item list. */
export function MenuCheckboxItem(p: Omit<ItemProps, "onClick" | "closeOnClick"> & { checked: boolean; onCheckedChange: (on: boolean) => void }) {
  const base = useBase(true);
  return base ? <base.MenuCheckboxItemBox {...p} /> : null;
}

/** The small caps heading at the top of a menu. */
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="menu-title">{children}</div>;
