// TERM-094 / VIEW-105: the link action menu, drawn at the pointer over the link. The rows and what each does are
// decided in linkMenu.ts (pure); this only draws them, keeps the menu on screen, and dismisses on Escape or a click
// outside. Copy keeps the menu open and says whether the copy landed; every other row closes it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitIn, menuStep, outsideDismisses } from "./PaneMenu";
import type { LinkItem, LinkItemId } from "./linkMenu";

type Props = {
  at: { top: number; left: number };
  destination: string;
  items: LinkItem[];
  /** Runs a row. Copy resolves to whether the clipboard took it; the other rows close the menu. */
  onPick: (id: LinkItemId) => Promise<boolean> | void;
  onDismiss: () => void;
};

export { menuStep };

export default function LinkActionMenu({ at, destination, items, onPick, onDismiss }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(typeof performance === "undefined" ? 0 : performance.now());
  const [copied, setCopied] = useState<null | boolean>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        // T-307-b: arrows move between the rows (wrapping), Home and End jump to the ends.
        const rows = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const to = menuStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
        if (to === null) return;
        e.preventDefault();
        e.stopPropagation();
        rows[to].focus();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.top = `${fitIn(r.top, r.height, window.innerHeight)}px`;
    el.style.left = `${fitIn(r.left, r.width, window.innerWidth)}px`;
    first.current?.focus();
  }, [at.top, at.left]);
  const outside = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (outsideDismisses(openedAt.current, performance.now())) onDismiss();
  };
  const pick = (id: LinkItemId) => {
    if (id !== "copy") {
      onDismiss();
      void onPick(id);
      return;
    }
    void Promise.resolve(onPick(id)).then((ok) => setCopied(ok !== false));
  };
  return (
    <>
      <div className="menu-backdrop" onClick={outside} onContextMenu={outside} aria-hidden="true" />
      <div ref={box} className="menu pane-menu link-menu" role="menu" aria-label="Link menu" style={{ top: at.top, left: at.left, maxWidth: "min(480px, calc(100vw - 16px))" }}>
        <div className="muted" title={destination} style={{ padding: "4px 8px 6px", overflowWrap: "anywhere", userSelect: "text" }}>
          {destination}
        </div>
        <div role="separator" style={{ height: 1, margin: "0 6px 4px", background: "var(--line-strong)" }} />
        {items.map((it, i) => (
          <button key={it.id} ref={i === 0 ? first : undefined} role="menuitem" className="menu-item" onClick={() => pick(it.id)}>
            <span className="name">{it.id === "copy" && copied !== null ? (copied ? "Copied" : "Could not copy") : it.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
