import { marked } from "marked";
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The sheet's markdown preview sanitises through the browser; plain marked stands in for it here.
vi.mock("../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => marked.parse(md, { async: false }) }));
// The sheet is a src/ui Dialog, drawn only on a real DOM; its contents are read here through a stand-in.
vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);
const { default: PlanSheet } = await import("./PlanSheet");

const sheet = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(PlanSheet, {
      title: "Claude 1",
      plan: "Step one.\n\nStep two.",
      draft: { comments: [], note: "tighten it" },
      onDraft: () => {},
      onApprove: () => {},
      onRequest: () => {},
      onClose: () => {},
      ...extra,
    }),
  );

test("T-032-b: while Request changes waits to send, the sheet says so and offers Cancel; both answers are held (SAFE-004)", () => {
  const html = sheet({ sending: true, onCancel: () => {} });
  expect(html).toContain("Sending your feedback");
  // Stand-in review FIX-SOON 4: the note tells the real window: the prompt is dismissed first, and
  // a cancel mostly lands once the feedback is already typed but not sent.
  expect(html).toContain("plan prompt is dismissed first");
  expect(html).toContain("it may already be typed");
  expect(html).toMatch(/title="[^"]*stops the waiting send[^"]*"[^>]*>Close</);
  expect(html).toMatch(/<button[^>]*>Cancel sending<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sending…<\/button>/);
});

test("T-032-b: with nothing pending there is no Cancel sending button (SAFE-004)", () => {
  const html = sheet({});
  expect(html).not.toContain("Cancel sending");
  expect(html).not.toContain("Sending your feedback");
  expect(html).toMatch(/<button[^>]*>Request changes<\/button>/);
});
