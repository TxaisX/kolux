// A tab set over Base UI's Tabs with Kolux's own tab classes. Base UI gives the roles, aria-controls and
// aria-labelledby between each tab and its panel, and Left/Right/Home/End. Tabs open on focus, as Kolux's tab strips
// always have.
import type { ReactElement, ReactNode } from "react";
import { Tabs as Base } from "@base-ui/react/tabs";

/** `render` draws the set as an element of the page's own (the sidebar's <aside>) instead of a wrapping <div>. */
export function Tabs<T extends string>({ value, onValue, className, render, children }: { value: T | null; onValue: (v: T) => void; className?: string; render?: ReactElement; children: ReactNode }) {
  return (
    <Base.Root value={value} onValueChange={(v) => onValue(v as T)} className={className} render={render}>
      {children}
    </Base.Root>
  );
}

export const TabList = ({ label, className, children, ...p }: { label: string; className?: string; children: ReactNode; "data-testid"?: string }) => (
  <Base.List activateOnFocus aria-label={label} className={className} {...p}>
    {children}
  </Base.List>
);

/** `selected` sets the tab stop on the first paint (Base UI sets it after mount; a server render would show none). */
export const Tab = ({ value, selected, children, ...p }: { value: string; selected: boolean; className?: string; title?: string; children: ReactNode; "data-testid"?: string }) => (
  <Base.Tab value={value} nativeButton render={<button type="button" />} tabIndex={selected ? 0 : -1} {...p}>
    {children}
  </Base.Tab>
);

export const TabPanel = ({ value, className, label, children }: { value: string; className?: string; label?: string; children: ReactNode }) => (
  <Base.Panel value={value} className={className} aria-label={label}>
    {children}
  </Base.Panel>
);
