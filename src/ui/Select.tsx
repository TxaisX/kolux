// A select over Base UI's Select. The closed control is Kolux's .field box with the same chevron a native select
// draws; the open list is a Kolux .menu with .menu-item rows (a native <select> opens the web view's own list).
// Escape and stacking are layer.ts's: an open list inside a dialog closes alone and leaves the dialog up.
// Base UI is read on demand (part.ts). Until it is, the closed control is drawn here as the same button Base UI draws,
// and the first press or arrow key reads it and opens the list; a select drawn after that is Base UI's from the start.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLayer } from "./layer";
import { baseReady, useBase } from "./part";
import "./ui.css";

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

export type SelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  /** The control's accessible name. */
  label: string;
  /** The closed control's class (default "field", the native select's box). */
  className?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
  /** The closed control's own style (a width rule a native select had at its call site). */
  style?: CSSProperties;
  /** The closed control, for a caller that moves focus to it. */
  controlRef?: RefObject<HTMLButtonElement | null>;
  "data-testid"?: string;
};

const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", " "]);

/** Every option's label, stacked unseen in the value's place, so the closed control is as wide as its longest option
 *  wherever its width is not set, as a native select is (its width does not jump when another option is picked). */
export const sizer = (options: SelectOption[]) => (
  <span className="ui-select-sizer" aria-hidden="true">
    {options.map((o) => (
      <span key={o.value}>{o.label}</span>
    ))}
  </span>
);

const chevron = (
  <span className="ui-select-icon" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  </span>
);

export function Select({ value, onChange, options, label, className = "field", disabled, title, id, controlRef, ...p }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [woke, setWoke] = useState(baseReady);
  const base = useBase(woke);
  const popup = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLButtonElement>(null);
  const trigger = controlRef ?? own;
  useLayer(open, () => setOpen(false), popup);
  // The list opened by the first press replaced the button that was pressed, so Base UI cannot hand focus back to
  // it: on close, focus that fell to the page goes to the control.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const now = document.activeElement;
      if (!now || now === document.body) trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  if (base) return <base.SelectBox popup={popup} trigger={trigger} open={open} onOpen={setOpen} value={value} onChange={onChange} options={options} label={label} className={className} disabled={disabled} title={title} id={id} chevron={chevron} sizer={sizer(options)} {...p} />;
  const wake = () => {
    setWoke(true);
    setOpen(true);
  };
  return (
    <button
      ref={trigger}
      type="button"
      role="combobox"
      aria-expanded={false}
      aria-haspopup="listbox"
      aria-label={label}
      className={`${className} ui-select`}
      title={title}
      id={id}
      disabled={disabled}
      onClick={wake}
      onKeyDown={(e) => {
        if (!OPEN_KEYS.has(e.key)) return;
        e.preventDefault();
        wake();
      }}
      {...p}
    >
      <span className="ui-select-box">
        <span className="ui-select-value">{options.find((o) => o.value === value)?.label ?? value}</span>
        {sizer(options)}
      </span>
      {chevron}
    </button>
  );
}
