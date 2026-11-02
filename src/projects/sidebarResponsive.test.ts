// The left sidebar is resizable (LEFT_MIN 220 to LEFT_MAX 480). Its footer and rows must answer
// the sidebar's own width, not the window's, or the update control and session names collide at
// the narrow end. These assertions pin the contract in the source and the stylesheet.
import { expect, test } from "vitest";
// @ts-expect-error vitest runs on Node; the app's browser tsconfig has no Node types.
import { readFileSync } from "node:fs";

const panel = (await import("./ProjectsPanel.tsx?raw")).default;
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("the footer's update control keeps its name when the label is hidden", () => {
  expect(panel).toContain('aria-label="Check for updates"');
  expect(panel).toContain('<span className="label">Check for updates</span>');
});

test("the sidebar answers its own width with a container query, not the window", () => {
  expect(css).toContain("container-type: inline-size");
  expect(css).toContain("@container (max-width: 260px)");
  expect(css).toContain(".sb-foot .upd .label { display: none; }");
});

// A session row is a block child (its parents are plain divs and .sb-list is not a flex container), so
// only the name span inside the flex row needs min-width: 0 to give up width and ellipsize.
test("session names ellipsize inside their row instead of pushing the footer", () => {
  expect(css).toContain(".sess .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }");
});
