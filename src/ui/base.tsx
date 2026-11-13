// Everything in src/ui that draws with Base UI, in one module that is read on demand (part.ts), never with the
// window's first frame: Base UI and its positioning code are about 130 kB of script, and the first load has a
// ceiling (scripts/bundle-budget.mjs). The wrappers next to this file are the public face; each draws its closed
// state without Base UI and hands over to what is here when it opens (or, for a tab strip, as soon as this arrives).
// Escape and stacking stay Kolux's (layer.ts, called by the wrappers); focus, aria and click-outside are Base UI's.
import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode, RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Tabs } from "@base-ui/react/tabs";
import { Tooltip } from "@base-ui/react/tooltip";
import { pointAnchor } from "./layer";

type Focus = boolean | RefObject<HTMLElement | null> | (() => HTMLElement | null | boolean | void);
type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export type DialogBoxProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "children" | "className"> & {
  popup: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  label: string;
  className: string;
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
    <Dialog.Root open modal={modal} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        {backdrop && <Dialog.Backdrop className={backdrop} />}
        {viewport ? <Dialog.Viewport className={viewport}>{box}</Dialog.Viewport> : box}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type MenuBoxProps = {
  popup: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  label: string;
  anchor?: RefObject<Element | null> | Element | null;
  at?: { x: number; y: number } | null;
  side: Side;
  align: Align;
  offset: number;
  className?: string;
  positioner?: string;
  style?: CSSProperties;
  finalFocus?: Focus;
  "data-testid"?: string;
  children: ReactNode;
};

export function MenuBox({ popup, onClose, label, anchor, at, side, align, offset, className, positioner, style, finalFocus, children, ...p }: MenuBoxProps) {
  return (
    <Menu.Root open onOpenChange={(next) => !next && onClose()}>
      <Menu.Portal>
        <Menu.Positioner className={positioner ? `ui-positioner ${positioner}` : "ui-positioner"} anchor={at ? pointAnchor(at.x, at.y) : anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} positionMethod="fixed">
          <Menu.Popup ref={popup} className={className ? `menu ${className}` : "menu"} aria-label={label} style={style} finalFocus={finalFocus as never} {...p}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export type ItemProps = { className?: string; title?: string; disabled?: boolean; onClick?: () => void; closeOnClick?: boolean; children: ReactNode; "data-testid"?: string; "aria-label"?: string };

export const MenuItemBox = ({ className = "menu-item", onClick, ...p }: ItemProps) => <Menu.Item nativeButton render={<button type="button" />} className={className} onClick={() => onClick?.()} {...p} />;

export const MenuCheckboxItemBox = ({ checked, onCheckedChange, className = "menu-item", children, ...p }: Omit<ItemProps, "onClick" | "closeOnClick"> & { checked: boolean; onCheckedChange: (on: boolean) => void }) => (
  <Menu.CheckboxItem nativeButton render={<button type="button" />} checked={checked} onCheckedChange={(on) => onCheckedChange(on)} closeOnClick={false} className={className} {...p}>
    {children}
  </Menu.CheckboxItem>
);

export type PopoverBoxProps = {
  popup: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  label: string;
  anchor: RefObject<Element | null>;
  side: Side;
  align: Align;
  offset: number;
  className?: string;
  style?: CSSProperties;
  modal: boolean | "trap-focus";
  initialFocus?: Focus;
  "data-testid"?: string;
  children: ReactNode;
};

export function PopoverBox({ popup, onClose, label, anchor, side, align, offset, className, style, modal, initialFocus, children, ...p }: PopoverBoxProps) {
  return (
    <Popover.Root open modal={modal} onOpenChange={(next) => !next && onClose()}>
      <Popover.Portal>
        <Popover.Positioner className="ui-positioner" anchor={anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} positionMethod="fixed">
          <Popover.Popup ref={popup} className={className ? `menu ${className}` : "menu"} role="dialog" aria-label={label} style={style} initialFocus={initialFocus as never} finalFocus={anchor as RefObject<HTMLElement | null>} {...p}>
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
  "data-testid"?: string;
  trigger: RefObject<HTMLButtonElement | null>;
  chevron: ReactElement;
};

export function SelectBox({ popup, open, onOpen, value, onChange, options, label, className, disabled, title, id, trigger, chevron, ...p }: SelectBoxProps) {
  return (
    <Select.Root value={value} onValueChange={(v) => v !== null && onChange(v as string)} items={options} open={open} onOpenChange={onOpen} modal={false} disabled={disabled}>
      <Select.Trigger ref={trigger} className={`${className} ui-select`} aria-label={label} title={title} id={id} {...p}>
        <Select.Value className="ui-select-value" />
        {chevron}
      </Select.Trigger>
      <Select.Portal>
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
      <Tooltip.Portal>
        <Tooltip.Positioner className="ui-positioner ui-tip-positioner" anchor={anchor} side={side} sideOffset={6} collisionPadding={8}>
          <Tooltip.Popup id={id} role="tooltip" className="tip ui-tip">
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
