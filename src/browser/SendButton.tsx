// T-241 (BROW-038), T-240 (BROW-035): "Send to agent…" with the list of agent sessions in this worktree,
// shared by the drawing canvas and the element sheet. The same targets the page notes go to.
// UX audit: the menu closes on Escape (the key stops there, ahead of the pane that would also take it) or a press outside
// it, and arrows move between its rows; the "no agent sessions" note clears itself after a few seconds.
import { useEffect, useRef, useState } from "react";
import type { SendTarget } from "../editor/notes";
import { watchEscape } from "../switcher/accounts";
import { menuStep } from "../terminal/LinkActionMenu";

type Props = { targets?: () => SendTarget[]; busy: boolean; onPick: (key: number) => void };

/** How long the "no agent sessions" note stays. */
export const NONE_MS = 5000;

export function SendButton({ targets, busy, onPick }: Props) {
  const [list, setList] = useState<SendTarget[] | null>(null);
  const [none, setNone] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const shown = !!list || none;
  const open = () => {
    const t = targets?.() ?? [];
    setNone(t.length === 0);
    setList(t.length ? t : null);
  };
  const close = () => {
    setList(null);
    setNone(false);
  };
  useEffect(() => {
    if (!none) return;
    const t = window.setTimeout(() => setNone(false), NONE_MS);
    return () => window.clearTimeout(t);
  }, [none]);
  // Escape is claimed only while the list is open; the short "no agent sessions" note leaves Escape to the rest of the app.
  useEffect(() => {
    if (!list) return;
    return watchEscape(window, () => {
      close();
      trigger.current?.focus();
    });
  }, [list]);
  useEffect(() => {
    if (!shown) return;
    const outside = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [shown]);
  useEffect(() => {
    if (list) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [list]);
  return (
    <span className="send-wrap" ref={wrap}>
      <button ref={trigger} type="button" className="btn" data-go="send" disabled={busy} onClick={() => (shown ? close() : open())} aria-haspopup="menu" aria-expanded={!!list}>
        {busy ? "Sending…" : "Send to agent…"}
      </button>
      {none && (
        <small className="send-none" role="status">
          No agent sessions in this worktree
        </small>
      )}
      {list && (
        <ul
          className="send-menu"
          role="menu"
          aria-label="Send to"
          onKeyDown={(e) => {
            const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
            const to = menuStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
            if (to === null) return;
            e.preventDefault();
            rows[to]?.focus();
          }}
        >
          {list.map((t) => (
            <li key={t.key} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setList(null);
                  onPick(t.key);
                }}
              >
                {t.label} <small>{t.since}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
