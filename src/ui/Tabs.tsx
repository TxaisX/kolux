// A tab set over Base UI's Tabs with Kolux's own tab classes. Base UI gives the strip its roving tab stop and
// Left/Right/Home/End; tabs open on focus, as Kolux's tab strips always have.
// Base UI is read on demand (part.ts): a strip is drawn here first, the same buttons with the same roles, and hands
// over to Base UI the moment its code is in (the first idle moment after the window's first frame). Base UI wraps only
// the strip, so the panel and everything around it is the page's own and is not drawn again at the hand-over.
import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useBase } from "./part";
import "./ui.css";

type Ctx = { id: string; value: string | null; onValue: (v: string) => void; base: ReturnType<typeof useBase> };
const TabsCtx = createContext<Ctx | null>(null);
const use = (): Ctx => {
  const c = useContext(TabsCtx);
  if (!c) throw new Error("src/ui: a TabList, Tab or TabPanel outside <Tabs>");
  return c;
};

/** The tab set: draws no element of its own, so the page keeps its own layout (the sidebar's <aside>). */
export function Tabs<T extends string>({ value, onValue, children }: { value: T | null; onValue: (v: T) => void; children: ReactNode }) {
  const id = useId();
  const base = useBase(true);
  return <TabsCtx.Provider value={{ id, value, onValue: onValue as (v: string) => void, base }}>{children}</TabsCtx.Provider>;
}

const tabId = (c: Ctx, value: string) => `${c.id}tab-${value}`;
const panelId = (c: Ctx) => `${c.id}panel`;

export function TabList({ label, className, children, ...p }: { label: string; className?: string; children: ReactNode; "data-testid"?: string }) {
  const c = use();
  // A tab that had keyboard focus at the hand-over keeps it.
  const focused = useRef<string | null>(null);
  const handed = useRef(c.base !== null);
  useLayoutEffect(() => {
    if (!c.base || handed.current) return;
    handed.current = true;
    if (focused.current !== null) document.getElementById(tabId(c, focused.current))?.focus();
  }, [c.base]);
  if (c.base)
    return (
      <c.base.TabStripBox value={c.value} onValue={c.onValue} label={label} className={className} {...p}>
        {children}
      </c.base.TabStripBox>
    );
  return (
    <div
      role="tablist"
      aria-label={label}
      className={className}
      onFocus={(e) => (focused.current = e.target.getAttribute("role") === "tab" ? e.target.id.slice(tabId(c, "").length) : null)}
      onBlur={() => (focused.current = null)}
      {...p}
    >
      {children}
    </div>
  );
}

/** `selected` sets the tab stop on the first paint, before Base UI has measured the strip. */
export function Tab({ value, selected, ...p }: { value: string; selected: boolean; className?: string; title?: string; children: ReactNode; "data-testid"?: string }) {
  const c = use();
  const ids = { id: tabId(c, value), "aria-controls": selected ? panelId(c) : undefined };
  if (c.base) return <c.base.TabBox value={value} tabIndex={selected ? 0 : -1} {...ids} {...p} />;
  // Attributes in Base UI's order (tab stop, role, selected), so a page reads the same before and after the hand-over.
  return <button type="button" tabIndex={selected ? 0 : -1} role="tab" aria-selected={selected} {...ids} onClick={() => c.onValue(value)} {...p} />;
}

/** The open tab's panel. Named by `label`, else by its tab. */
export function TabPanel({ value, className, label, children }: { value: string; className?: string; label?: string; children: ReactNode }) {
  const c = use();
  return (
    <div role="tabpanel" id={panelId(c)} className={className} aria-label={label} aria-labelledby={label === undefined ? tabId(c, value) : undefined}>
      {children}
    </div>
  );
}
