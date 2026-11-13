// A stand-in for src/ui/Popover in a test that server-renders a page to read what an open popover holds. The real
// Popover is drawn in a portal once Base UI is read, so renderToString shows nothing of it; this draws the same box in
// place, a .menu with role dialog, its name and its children. Placement, focus, Escape and the click outside are the
// wrapper's, proved on a real DOM in src/ui/ui.dom.test.tsx. Use it as:
//   vi.mock("../ui/Popover", async () => (await import("../tasks/popoverStandIn")).popoverModule);
import { createElement, type ReactNode } from "react";

type Props = { open: boolean; label: string; className?: string; children: ReactNode; "data-testid"?: string; [k: string]: unknown };

function Popover({ open, label, className, children, "data-testid": testId }: Props) {
  if (!open) return null;
  return createElement("div", { role: "dialog", "aria-label": label, className: className ? `menu ${className}` : "menu", "data-testid": testId }, children);
}

export const popoverModule = { Popover };
