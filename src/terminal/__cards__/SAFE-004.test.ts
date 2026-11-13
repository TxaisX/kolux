// SAFE-004 box 1: the real PlanSheet function with its state kept by shallow-react.ts. The disabling
// decision is the real canRequest() inside the sheet.
import { expect, test, vi } from "vitest";
import PlanSheet from "../PlanSheet";
import type { PlanDraft } from "../planReview";
import { find, mount, textOf } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
vi.mock("../../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => md }));
vi.mock("../../ui/Dialog", async () => (await import("../../tasks/dialogStandIn")).dialogModule);

const sheet = (draft: PlanDraft) => {
  const tree = mount(PlanSheet, { title: "repo", plan: "# Plan\n\nDo it.", draft, onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} }).render();
  return {
    request: find(tree, (e) => e.type === "button" && textOf(e).startsWith("Request changes")),
    approve: find(tree, (e) => e.type === "button" && textOf(e) === "Approve"),
  };
};

test("box 1: no comments and an empty note -> Request changes is disabled (a blank note counts as empty)", () => {
  const empty = sheet({ comments: [], note: "" });
  expect(empty.request.props.disabled).toBe(true);
  expect(textOf(empty.request)).toBe("Request changes");
  expect(empty.approve.props.disabled).toBe(false);
  expect(sheet({ comments: [], note: " \n\t " }).request.props.disabled).toBe(true);
  // the contrast: a note, or a comment, turns it on
  expect(sheet({ comments: [], note: "tighten step 2" }).request.props.disabled).toBe(false);
  const withComment = sheet({ comments: [{ id: "c", start: 1, end: 1, quote: "# Plan", text: "why?" }], note: "" });
  expect(withComment.request.props.disabled).toBe(false);
  expect(textOf(withComment.request)).toBe("Request changes (1)");
});
