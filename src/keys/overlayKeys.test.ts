import { expect, test } from "vitest";
import { actionById } from "./actions";
import { heldByOverlay, PANE_CLOSE_EVENT, paneCloseClaimed } from "./useWindowKeys";

// UX lane C: global shortcuts wait while a menu, popover or dialog is up; the Settings page is a page.
const box = (shown: boolean) => ({ getClientRects: () => ({ length: shown ? 1 : 0 }), closest: () => null });
const root = (overlays: unknown[], settings: unknown = null) => ({
  querySelector: (s: string) => (s.startsWith(".settings") ? settings : null),
  querySelectorAll: () => overlays,
});

test("a showing dialog or menu holds global shortcuts; none showing lets them run", () => {
  expect(heldByOverlay("tab.newTerminal", false, root([]) as never)).toBe(false);
  expect(heldByOverlay("tab.newTerminal", false, root([box(true)]) as never)).toBe(true);
  expect(heldByOverlay("tab.newTerminal", false, root([box(false)]) as never), "hidden").toBe(false);
});

test("the open Settings page alone holds nothing; a dialog inside it does", () => {
  const page = (inner: unknown[]) => root([box(true)], { querySelectorAll: () => inner });
  expect(heldByOverlay("sidebar.left.toggle", false, page([]) as never)).toBe(false);
  expect(heldByOverlay("sidebar.left.toggle", false, page([box(true)]) as never)).toBe(true);
});

test("the Ctrl+Tab list (itself a menu) still steps while it is open", () => {
  expect(heldByOverlay("tab.previousRecent", true, root([box(true)]) as never)).toBe(false);
  expect(heldByOverlay("tab.nextRecent", true, root([box(true)]) as never)).toBe(false);
  expect(heldByOverlay("tab.previousRecent", false, root([box(true)]) as never)).toBe(true);
});

test("Automations has a command, so the palette lists it", () => {
  expect(actionById.get("view.automations")?.title).toBe("Open Automations");
  expect(actionById.get("browser.hardReload")?.title).not.toMatch(/Hard/);
});

test("UX lane C (request from D): Ctrl+W closes directly unless the pane claims the close for its own warning", () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = new EventTarget();
  try {
    expect(paneCloseClaimed(1), "no pane listens: the window closes it").toBe(false);
    const claim = (e: Event) => { if ((e as CustomEvent<{ paneId: number }>).detail.paneId === 2) e.preventDefault(); };
    (g.window as EventTarget).addEventListener(PANE_CLOSE_EVENT, claim);
    expect(paneCloseClaimed(2), "the browser pane takes it").toBe(true);
    expect(paneCloseClaimed(1), "another pane still closes directly").toBe(false);
  } finally {
    g.window = before;
  }
});
