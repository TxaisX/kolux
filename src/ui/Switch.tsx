// Switch and Checkbox stay native inputs on purpose. A native <input type="checkbox"> already answers Space, is a
// tab stop, and is read as a checkbox (or, with role="switch", as a switch) by a screen reader, with no script. Base
// UI's Switch and Checkbox draw a <span> instead, which would change the look of every site. These wrappers give the
// call sites one shape (label text, checked, onChange with a boolean) and the a11y defaults, nothing more.
import type { ReactNode } from "react";

type Props = { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; className?: string; children?: ReactNode; title?: string; "aria-label"?: string; "data-testid"?: string };

const Box = ({ checked, onChange, disabled, className = "check", children, title, role, ...p }: Props & { role?: "switch" }) => (
  <label className={className} title={title}>
    <input type="checkbox" role={role} aria-checked={role ? checked : undefined} checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} {...p} /> {children}
  </label>
);

export const Checkbox = (p: Props) => <Box {...p} />;
export const Switch = (p: Props) => <Box {...p} role="switch" />;
