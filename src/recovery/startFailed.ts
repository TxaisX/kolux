// FIX-5 (council d2 AFTER 4): the window starts hidden and is shown after the first draw. When the
// start fails (the App chunk did not load, a restore step threw) nothing would ever draw or show it:
// a hidden window with no message. This puts a plain message in the page and shows the window.

type Node_ = { setAttribute(k: string, v: string): void; textContent: string | null; append(...n: unknown[]): void; firstChild?: unknown };
type Page = { getElementById(id: string): Node_ | null; createElement(tag: string): Node_; body?: Node_ | null };

/** The words under the heading: the error's own message when it has one, never a stack. */
export function startFailureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const one = raw.split(/\r?\n/)[0].trim().slice(0, 200);
  return one ? `Kolux could not start: ${one}. Close it and open it again.` : "Kolux could not start. Close it and open it again.";
}

/** Writes the message into the page's root and shows the window. Returns the message.
 *  FIX-6 (council d2 AFTER 2): a root that React has already drawn into is never wiped (that would
 *  destroy the DOM React holds); the message goes over the page from the body instead. */
export function showStartFailure(error: unknown, page: Page, show: () => Promise<unknown>): string {
  const text = startFailureText(error);
  const root = page.getElementById("root");
  if (root) {
    const p = page.createElement("p");
    p.setAttribute("role", "alert");
    p.textContent = text;
    if (root.firstChild) {
      p.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText");
      (page.body ?? root).append(p);
    } else {
      p.setAttribute("style", "padding:24px;font:14px system-ui,sans-serif;color:inherit");
      root.textContent = "";
      root.append(p);
    }
  }
  void show().catch(() => {});
  return text;
}
