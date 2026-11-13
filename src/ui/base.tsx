// Everything in src/ui that draws with Base UI, in one module that is read on demand (part.ts), never with the
// window's first frame: Base UI and its positioning code are about 130 kB of script, and the first load has a
// ceiling (scripts/bundle-budget.mjs). The wrappers next to this file are the public face; each draws its closed
// state without Base UI and hands over to what is here when it opens (or, for a tab strip, as soon as this arrives).
// Escape and stacking stay Kolux's (layer.ts, called by the wrappers); focus, aria and click-outside are Base UI's.
import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Tabs } from "@base-ui/react/tabs";
import { Tooltip } from "@base-ui/react/tooltip";
import { pointAnchor, type CloseWhy } from "./layer";

/** Where every popup is put: one empty box outside the layout, for the reason menus use OutOfFlow (DT-C269): put
 *  straight into the body, a popup made WebKit lay out and redraw the window's rows (terminals included) as it came
 *  and went. Made on first use, kept for the window's life. */
function layerHost(): HTMLElement {
  let el = document.querySelector<HTMLElement>("body > .out-of-flow[data-ui-layer]");
  if (!el) {
    el = document.createElement("div");
    el.className = "out-of-flow";
    el.setAttribute("data-ui-layer", "");
    document.body.appendChild(el);
  }
  return el;
}

/** Whether a press that Base UI reads as outside the popup landed on the element the popup hangs from. That press is
 *  the element's own (its click toggles the popup): closing on it as well would let the click open it again. */
function onAnchor(anchor: RefObject<Element | null> | Element | null | undefined, event: Event | undefined): boolean {
  const el = anchor && "current" in anchor ? anchor.current : anchor;
  const target = event?.target;
  return !!el && target instanceof Node && el.contains(target);
}

/** Base UI's reason for a close, as src/ui names it (Escape never reaches Base UI: layer.ts takes it first). */
const why = (reason: string): CloseWhy => (reason === "outside-press" ? "outside" : "other");

type Focus = boolean | RefObject<HTMLElement | null> | (() => HTMLElement | null | boolean | void);
/** A menu or popover with no room on its side opens on the other side; with no room along it, it slides back into the
 *  window (shift), as Kolux's hand-placed menus did (left = min(x, window width - menu width)), rather than turning
 *  its alignment round. */
const AVOID = { side: "flip", align: "shift" } as const;
type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export type DialogBoxProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "children" | "className"> & {
  popup: RefObject<HTMLDivElement | null>;
  onClose: (why: CloseWhy) => void;
  label: string;
  className?: string;
  viewport?: string;
  backdrop?: string;
  alert: boolean;
  modal: boolean | "trap-focus";
  initialFocus?: Focus;
  finalFocus?: Focus;
  children: ReactNode;
};

export function DialogBox({ popup, onClose, label, className, viewport, backdrop, alert, modal, initialFocus, finalFocus, children, ...rest }: DialogBoxProps) {
  const box = (
    <Dialog.Popup
      ref={popup}
      className={className}
      role={alert ? "alertdialog" : "dialog"}
      aria-label={label}
      aria-modal={modal === false ? undefined : true}
      initialFocus={initialFocus as never}
      finalFocus={finalFocus as never}
      {...rest}
    >
      {children}
    </Dialog.Popup>
  );
  return (
    <Dialog.Root open modal={modal} onOpenChange={(next, d) => !next && onClose(why(d.reason))}>
      <Dialog.Portal container={layerHost()}>
        {backdrop && <Dialog.Backdrop className={backdrop} />}
        {viewport ? <Dialog.Viewport className={viewport}>{box}</Dialog.Viewport> : box}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type MenuBoxProps = {
  popup: RefObject<HTMLDivElement | null>;
  onClose: (why: CloseWhy) => void;
  label: string;
  anchor?: RefObject<Element | null> | Element | null;
  at?: { x: number; y: number } | null;
  place?: Place | null;
  side: Side;
  align: Align;
  offset: number;
  className?: string;
  plain?: boolean;
  positioner?: string;
  style?: CSSProperties;
  finalFocus?: Focus;
  "data-testid"?: string;
  children: ReactNode;
};

/** A box at fixed window numbers (`place`), its left and bottom edges where the site puts them: Base UI's own placement
 *  is snapped to whole device pixels, which moves a box of fractional height by a fraction of a pixel. */
export type Place = { left?: number; right?: number; top?: number; bottom?: number };
const placed = ({ left, right, top, bottom }: Place): CSSProperties => ({ position: "fixed", transform: "none", willChange: "auto", left: left ?? "auto", right: right ?? "auto", top: top ?? "auto", bottom: bottom ?? "auto" });

/** The row focus starts on: in a list of choices the ticked one (the account in use), else the first row a menu can act
 *  on (a row that is off stays focusable in Base UI, so it is skipped by its aria-disabled). */
const firstRow = (box: HTMLElement | null) => {
  const rows = Array.from(box?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((r) => r.getAttribute("aria-disabled") !== "true");
  return rows.find((r) => r.getAttribute("role") === "menuitemradio" && r.getAttribute("aria-checked") === "true") ?? rows[0] ?? null;
};

export function MenuBox({ popup, onClose, label, anchor, at, place, side, align, offset, className, plain, positioner, style, finalFocus, children, ...p }: MenuBoxProps) {
  // Where focus goes back to when the menu closes: what had it when the menu opened (the button, or the list a
  // right-click menu was opened on), as Kolux's menus always did. The menu is taken off the page at once when it closes
  // (its owner stops drawing it), which Base UI's own hand-back does not follow, so it is done here once the menu is gone,
  // and only when focus went with it: focus a picked row has moved on (a dialog it opened) stays there.
  const opener = useRef<Element | null>(null);
  if (opener.current === null) opener.current = document.activeElement;
  useEffect(
    () => () => {
      const to = opener.current;
      queueMicrotask(() => {
        const now = document.activeElement;
        if ((!now || now === document.body) && to instanceof HTMLElement && to.isConnected) to.focus();
      });
    },
    [],
  );
  // Kolux's menus put focus on their first row as they open (T-720), so the keyboard is in the list at once, a right-click
  // menu opened with Shift+F10 included; Base UI would focus the box and wait for an arrow key. This waits, frame by
  // frame (about half a second at most), for Base UI to have drawn the rows and taken focus into the menu, then hands it
  // to the first row. Focus already on a row is left where it is.
  useEffect(() => {
    let frame = 0;
    let tries = 30;
    const step = () => {
      const box = popup.current;
      const row = firstRow(box);
      const at = document.activeElement;
      if (box && at && box.contains(at) && at.closest('[role^="menuitem"]')) return;
      // Base UI has taken focus into the menu: onto the box, or one of the focus guards it puts around it.
      if (row && box && at && (box.parentElement?.contains(at) || at.hasAttribute("data-base-ui-focus-guard") || at.getAttribute("data-type") === "inside")) return row.focus();
      if (--tries > 0) frame = requestAnimationFrame(step);
      else row?.focus();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [popup]);
  return (
    <Menu.Root open onOpenChange={(next, d) => !next && !(d.reason === "outside-press" && onAnchor(anchor, d.event)) && onClose(why(d.reason))}>
      <Menu.Portal container={layerHost()}>
        <Menu.Positioner className={positioner ? `ui-positioner ${positioner}` : "ui-positioner"} anchor={at ? pointAnchor(at.x, at.y) : anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} collisionAvoidance={AVOID} positionMethod="fixed" style={place ? placed(place) : undefined}>
          <Menu.Popup ref={popup} className={plain ? className : className ? `menu ${className}` : "menu"} aria-label={label} style={style} finalFocus={finalFocus as never} {...p}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export type ItemProps = {
  className?: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  closeOnClick?: boolean;
  children: ReactNode;
  "data-testid"?: string;
  "aria-label"?: string;
  "aria-busy"?: boolean;
  /** A row that is one choice of several (the Skills page's agent filter): menuitemradio with aria-checked. */
  role?: "menuitem" | "menuitemradio";
  "aria-checked"?: boolean;
};

export const MenuItemBox = ({ className = "menu-item", onClick, ...p }: ItemProps) => <Menu.Item nativeButton render={<button type="button" />} className={className} onClick={() => onClick?.()} {...p} />;

export const MenuCheckboxItemBox = ({ checked, onCheckedChange, className = "menu-item", children, ...p }: Omit<ItemProps, "onClick" | "closeOnClick"> & { checked: boolean; onCheckedChange: (on: boolean) => void }) => (
  <Menu.CheckboxItem nativeButton render={<button type="button" />} checked={checked} onCheckedChange={(on) => onCheckedChange(on)} closeOnClick={false} className={className} {...p}>
    {children}
  </Menu.CheckboxItem>
);

export type PopoverBoxProps = {
  popup: RefObject<HTMLDivElement | null>;
  onClose: (why: CloseWhy) => void;
  label: string;
  anchor?: RefObject<Element | null>;
  at?: { x: number; y: number } | null;
  place?: Place | null;
  side: Side;
  align: Align;
  offset: number;
  className?: string;
  style?: CSSProperties;
  modal: boolean | "trap-focus";
  initialFocus?: Focus;
  finalFocus?: Focus;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  "data-testid"?: string;
  children: ReactNode;
};

export function PopoverBox({ popup, onClose, label, anchor, at, place, side, align, offset, className, style, modal, initialFocus, finalFocus, children, ...p }: PopoverBoxProps) {
  return (
    <Popover.Root open modal={modal} onOpenChange={(next, d) => !next && !(d.reason === "outside-press" && onAnchor(anchor, d.event)) && onClose(why(d.reason))}>
      <Popover.Portal container={layerHost()}>
        <Popover.Positioner className="ui-positioner" anchor={at ? pointAnchor(at.x, at.y) : anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} collisionAvoidance={AVOID} positionMethod="fixed" style={place ? placed(place) : undefined}>
          <Popover.Popup ref={popup} className={className ? `menu ${className}` : "menu"} role="dialog" aria-label={label} style={style} initialFocus={initialFocus as never} finalFocus={(finalFocus ?? (anchor as RefObject<HTMLElement | null> | undefined) ?? true) as never} {...p}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

export type SelectBoxProps = {
  popup: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpen: (open: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  label: string;
  className: string;
  disabled?: boolean;
  title?: string;
  id?: string;
  style?: CSSProperties;
  "data-testid"?: string;
  trigger: RefObject<HTMLButtonElement | null>;
  chevron: ReactElement;
  sizer: ReactElement;
};

export function SelectBox({ popup, open, onOpen, value, onChange, options, label, className, disabled, title, id, trigger, chevron, sizer, ...p }: SelectBoxProps) {
  return (
    <Select.Root value={value} onValueChange={(v) => v !== null && onChange(v as string)} items={options} open={open} onOpenChange={onOpen} modal={false} disabled={disabled}>
      <Select.Trigger ref={trigger} className={`${className} ui-select`} aria-label={label} title={title} id={id} {...p}>
        <span className="ui-select-box">
          <Select.Value className="ui-select-value" />
          {sizer}
        </span>
        {chevron}
      </Select.Trigger>
      <Select.Portal container={layerHost()}>
        <Select.Positioner className="ui-positioner" alignItemWithTrigger={false} side="bottom" align="start" sideOffset={4} collisionPadding={8}>
          <Select.Popup ref={popup} className="menu ui-select-menu">
            <Select.List>
              {options.map((o) => (
                <Select.Item key={o.value} value={o.value} disabled={o.disabled} className="menu-item">
                  <Select.ItemText className="name">{o.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** A tab strip: Base UI wraps only the strip (role tablist and its tabs), so the panel and everything around it is
 *  the page's own and is not drawn again when this arrives. `display: contents` keeps the root out of the layout. */
export function TabStripBox({ value, onValue, label, className, children, ...p }: { value: string | null; onValue: (v: string) => void; label: string; className?: string; children: ReactNode; "data-testid"?: string }) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onValue(v as string)} className="ui-tabs">
      <Tabs.List activateOnFocus aria-label={label} className={className} {...p}>
        {children}
      </Tabs.List>
    </Tabs.Root>
  );
}

export const TabBox = ({ value, ...p }: { value: string; id: string; tabIndex: number; "aria-controls"?: string; className?: string; title?: string; children: ReactNode; "data-testid"?: string }) => (
  <Tabs.Tab value={value} nativeButton render={<button type="button" />} {...p} />
);

/** A tip drawn while `open`, placed against `anchor` (the element it describes). When it shows is the wrapper's. */
export function TooltipBox({ anchor, id, side, children }: { anchor: RefObject<Element | null>; id: string; side: Side; children: ReactNode }) {
  return (
    <Tooltip.Root open>
      <Tooltip.Portal container={layerHost()}>
        <Tooltip.Positioner className="ui-positioner ui-tip-positioner" anchor={anchor} side={side} sideOffset={6} collisionPadding={8}>
          <Tooltip.Popup id={id} role="tooltip" className="tip ui-tip">
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
