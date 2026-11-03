// Small keyboard, clipboard and timing helpers the chat shares (UX audit, lane D / ux4). The pure
// parts are tested in ux.test.ts; the two hooks only wire them to React.
import { useCallback, useEffect, useRef, useState } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";

export type CopyOutcome = "copied" | "failed";
export const COPY_RESET_MS = 1500;
/** How long the zoom level stays on screen after Ctrl +/-/0. */
export const ZOOM_SHOWN_MS = 1200;
/** How long a note under the box stays before it clears itself. */
export const NOTE_MS = 10_000;
export const POLL_MS = 3000;
export const EARLIER_FAILED_NOTE = "Could not load earlier messages. Press the button again to retry.";

/** Writes `text` with `write` (the clipboard); a refusal is a "failed", never an exception. */
export async function copyText(write: (text: string) => Promise<void>, text: string): Promise<CopyOutcome> {
  try {
    await write(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The button label for the last copy: Copied or Copy failed until it resets, else the idle label. */
export const copyLabel = (outcome: CopyOutcome | null, idle: string): string => (outcome === "copied" ? "Copied" : outcome === "failed" ? "Copy failed" : idle);

/** How often the Agents screen asks which panes can show a chat: not at all while the page is hidden. */
export const pollMs = (pageHidden: boolean): number | null => (pageHidden ? null : POLL_MS);

/** A note that clears itself: true for all but the one that the turn ending clears (Stopping…). */
export const selfClearing = (note: string | null, keep: string): note is string => note !== null && note !== keep;

/** True when a pointer landed outside `box` (so a menu should close). */
export const outside = (box: { contains: (n: Node) => boolean } | null, target: EventTarget | null): boolean => !!box && !!target && !box.contains(target as Node);

/** Copy to the clipboard and report the label: `[label, copy]`. */
export function useCopy(idle: string): [string, (text: string) => void] {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    void copyText((t) => navigator.clipboard.writeText(t), text).then((o) => {
      setOutcome(o);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOutcome(null), COPY_RESET_MS);
    });
  }, []);
  return [copyLabel(outcome, idle), copy];
}

type Focusable = Parameters<typeof restoreFocus>[0];

/** Give focus back to the opener, one microtask later (after the unmounting commit settles), but only when the
 *  popup was dismissed. A pick that opens something else (a browser pane) must keep the focus it moved. */
export function restoreWhenDismissed(dismissed: boolean, prev: Focusable, find: (selector: string) => NonNullable<Focusable> | null): void {
  if (!dismissed) return;
  queueMicrotask(() => void restoreFocus(prev, find));
}

/** While `active`: Escape calls `onClose`, and when it ends focus goes back to where it was. The opener is read in
 *  this effect, which runs before anything has moved focus: `focusFirst` (a selector) is what takes focus here, so no
 *  autoFocus on the popup (React applies that during commit, before this effect, and it would be mistaken for the opener). */
export function useDismiss(active: boolean, onClose: () => void, focusFirst?: string) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    if (focusFirst) document.querySelector<HTMLElement>(focusFirst)?.focus();
    const off = watchEscape(window, () => close.current());
    return () => {
      off();
      restoreWhenDismissed(true, prev, (sel) => document.querySelector<HTMLElement>(sel));
    };
  }, [active, focusFirst]);
}
