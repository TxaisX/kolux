// A stand-in for chrome/Ask in a test that server-renders a page to read the question it asks. The real Ask is a src/ui
// AlertDialog, drawn in a portal and only once Base UI is read, so renderToString shows nothing of it; this draws the
// same words in place: the title, the body and the buttons. Ask itself (focus, Escape, Enter, the lock) is proved on a
// real DOM in chrome/Ask.test.ts. Use it as:
//   vi.mock("../chrome/Ask", async (real) => ({ ...(await real()), default: (await import("../tasks/askStandIn")).AskStandIn }));
import { createElement, type ReactNode } from "react";

type Props = { title: string; body: ReactNode; confirm: string | null; cancel?: string; dontAsk?: boolean };

export function AskStandIn({ title, body, confirm, cancel = "Cancel", dontAsk = false }: Props) {
  const buttons = confirm === null ? [createElement("button", { key: "ok", className: "btn primary" }, "OK")] : [createElement("button", { key: "cancel", className: "btn" }, cancel), createElement("button", { key: "confirm", className: "btn danger" }, confirm)];
  return createElement(
    "div",
    { role: "alertdialog", "aria-label": title, className: "ask" },
    createElement("h2", { className: "ask-title" }, title),
    createElement("div", { className: "ask-body" }, body),
    dontAsk ? createElement("label", { className: "check ask-check" }, "Don't ask again") : null,
    createElement("div", { className: "btn-row" }, ...buttons),
  );
}
