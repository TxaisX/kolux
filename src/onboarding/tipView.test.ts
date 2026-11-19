// ONB-027 / UX audit 2026-10-25 #8: a returning user's tip must not cover the restored workspace or take typing focus from it.
import { expect, test } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { TipView } from "./Guides";
import type { TipId } from "./guide";

const noop = () => {};
const props = (tip: TipId) => ({ tip, onClose: noop });
const TIPS: TipId[] = ["palette", "moved-usage"];

function autoFocused(n: ReactNode): boolean {
  if (Array.isArray(n)) return n.some(autoFocused);
  if (!isValidElement(n)) return false;
  const p = n.props as { autoFocus?: boolean; children?: ReactNode };
  return !!p.autoFocus || autoFocused(p.children);
}

test.each(TIPS)("the %s tip is a non-modal card: no full-window backdrop, aria-modal off", (tip) => {
  const html = renderToString(createElement(TipView, props(tip)));
  expect(html).toContain('aria-label="Tip"');
  expect(html).not.toContain("ask-backdrop");
  expect(html).not.toContain('aria-modal="true"');
});

test.each(TIPS)("the %s tip leaves typing focus in the restored pane (no autofocus)", (tip) => {
  expect(autoFocused(TipView(props(tip)))).toBe(false);
});
