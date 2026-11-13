// A stand-in for src/ui/Dialog in a test that server-renders a page to read what a dialog shows. The real Dialog is
// drawn in a portal once Base UI is read, so renderToString shows nothing of it; this draws the same box in place, with
// the role, name and classes the real one gets, and its children. Focus, the Tab trap, Escape and the click outside are
// the wrapper's, proved on a real DOM in src/ui/ui.dom.test.tsx. Use it as:
//   vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);
import { createElement, type ReactNode } from "react";

type Props = { label: string; className?: string; viewport?: string; backdrop?: string; alert?: boolean; modal?: boolean | "trap-focus"; open?: boolean; children: ReactNode; [k: string]: unknown };

export function DialogStandIn({ label, className, viewport, alert = false, modal = true, open = true, children, onClose: _c, backdrop: _b, initialFocus: _i, finalFocus: _f, boxRef: _r, ...rest }: Props) {
  if (!open) return null;
  const box = createElement("div", { ...rest, role: alert ? "alertdialog" : "dialog", "aria-modal": modal === false ? undefined : true, "aria-label": label, className }, children);
  return viewport ? createElement("div", { className: viewport }, box) : box;
}

export const dialogModule = { Dialog: DialogStandIn, AlertDialog: (p: Props) => DialogStandIn({ ...p, alert: true }) };
