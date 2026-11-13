// A select over Base UI's Select. The closed control is Kolux's .field box with the same chevron a native select
// draws; the open list is a Kolux .menu with .menu-item rows (a native <select> opens the web view's own list).
// Escape and stacking are layer.ts's: an open list inside a dialog closes alone and leaves the dialog up.
import { useRef, useState, type ReactNode } from "react";
import { Select as Base } from "@base-ui/react/select";
import { useLayer } from "./layer";
import "./ui.css";

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

export function Select({ value, onChange, options, label, className = "field", disabled, title }: { value: string; onChange: (v: string) => void; options: SelectOption[]; label: string; className?: string; disabled?: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  useLayer(open, () => setOpen(false), popup);
  return (
    <Base.Root value={value} onValueChange={(v) => v !== null && onChange(v as string)} items={options} open={open} onOpenChange={(next) => setOpen(next)} modal={false} disabled={disabled}>
      <Base.Trigger className={`${className} ui-select`} aria-label={label} title={title}>
        <Base.Value className="ui-select-value" />
        <Base.Icon className="ui-select-icon">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </Base.Icon>
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner className="ui-positioner" alignItemWithTrigger={false} side="bottom" align="start" sideOffset={4} collisionPadding={8}>
          <Base.Popup ref={popup} className="menu ui-select-menu">
            <Base.List>
              {options.map((o) => (
                <Base.Item key={o.value} value={o.value} disabled={o.disabled} className="menu-item">
                  <Base.ItemText className="name">{o.label}</Base.ItemText>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
