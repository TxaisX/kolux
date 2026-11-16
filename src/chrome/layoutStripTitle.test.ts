// Job 50 item 3: since the Start form (rule E) a bigger pane count opens the form for the new cells; no empty
// panes are added. The strip's hover says so.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import LayoutStrip from "./LayoutStrip";

test("job 50: the layout strip's hover says the Start form asks for the new panes", () => {
  const html = renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {} }));
  expect(html).toContain('title="4 panes: the Start form asks what to run in the new ones, unstarted ones are removed"');
  expect(html).toContain('title="One pane"');
  expect(html).not.toContain("empty panes are added");
});
