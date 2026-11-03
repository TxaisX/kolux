// The browser chords of the window (BROW-003, BROW-005), moved out of App.tsx as they were (cycle 2, the
// App.tsx split), called where they sat so the window's hook order is unchanged.
import type { WindowState } from "../shell/windowStore";
import { chordPlan } from "./chord";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

/** Ctrl+L: the address bar, or, on a previewed document (whose bar is hidden), the chip that opens for typing. */
export function focusAddress(inBrowser: (sel: string) => HTMLElement | null) {
  const chip = inBrowser(".preview-open");
  if (chip) return chip.click();
  const bar = inBrowser(".address") as HTMLInputElement | null;
  bar?.focus();
  bar?.select();
}

export function useBrowserChords({ setFocused }: Pick<WindowState, "setFocused">) {
  // BROW-003, BROW-005: a browser chord for one tab, pressed in the app or forwarded by the page
  // itself when the keyboard was inside it (T-012-b-fix; the back end's `browser-chord` event).
  const browserAction = (key: number, what: string) => {
    const inBrowser = (sel: string) => document.querySelector<HTMLElement>(`.pane.browser[data-key="${key}"] ${sel}`);
    if (what === "focusAddressBar") focusAddress(inBrowser);
    else if (what === "reload") {
      // The pane's own reload says a failure in its notice; with no pane to ask, the engine is told directly.
      const own = inBrowser('[data-go="reloadAny"]');
      if (own) own.click();
      else void invoke("browser_go", { id: key, what: "reload" }).catch(() => {});
    }
    else inBrowser(`[data-go="${what}"]`)?.click();
  };
  const chord = useRef(browserAction);
  chord.current = browserAction;
  useEffect(() => {
    // A chord from inside a page also makes that page's split the focused one: a click into the
    // page never reaches the app, so the app may still think another split has the keyboard.
    // Council FIX-3: only a chord pressed in the page (the app's window does not hold the
    // keyboard) does that or moves the keyboard; one the page's script sent runs page-only actions.
    // Council FIX-4: nor while the user is in another program, and at most once a second per tab.
    const un = listen<{ id: number; what: string }>("browser-chord", async (e) => {
      const { id, what } = e.payload;
      const plan = await chordPlan(id, what);
      if (plan.focusPane) setFocused(id);
      const run = () => plan.run && chord.current(id, what);
      if (plan.takeKeyboard) void invoke("browser_go", { id, what: "focusApp" }).catch(() => {}).then(run);
      else run();
    });
    return () => {
      un.then((u) => u());
    };
  }, []);
  return {
    browserAction,
  };
}
