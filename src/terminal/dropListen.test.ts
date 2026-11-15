// Audit F11: every visible pane asks the webview for drag-and-drop events. A refused request must be caught,
// not left as an unhandled rejection (one per pane). TerminalPane has no mount harness, so this pins the source,
// as inputSource.test.ts does.
// @ts-expect-error vitest runs on Node; the app's browser tsconfig has no Node types.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the pane's drag-and-drop listener has a catch for a refused request", () => {
  const src = readFileSync(new URL("./TerminalPane.tsx", import.meta.url), "utf8");
  const at = src.indexOf(".onDragDropEvent(");
  expect(at).toBeGreaterThan(-1);
  const chain = src.slice(at, src.indexOf("return () => {", at));
  expect(chain).toMatch(/\.then\(\(un\) => \{[\s\S]*\}\)\s*\.catch\(/);
});
