// SAFE-002 acceptance. The real planSections() and the real PlanSheet function run with their state kept by
// shallow-react.ts (no DOM); the markdown renderer is a pass-through since only the structure is judged.
import { expect, test, vi } from "vitest";
import PlanSheet from "../PlanSheet";
import { planSections, type PlanDraft } from "../planReview";
import { find, findAll, mount, textOf } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
vi.mock("../../chat/renderMarkdown", () => ({ renderMarkdown: (md: string) => md }));

const plan = ["Read the code first.", "", "Then run this:", "```sh", "make build", "", "make test", "```", "", "Ship it."].join("\n");

test("box 1: three paragraphs, one holding a fenced block with an empty line -> exactly three sections, the fence whole", () => {
  const s = planSections(plan);
  expect(s).toHaveLength(3);
  expect(s.map((x) => [x.start, x.end])).toEqual([[1, 1], [3, 8], [10, 10]]);
  expect(s[1].text).toBe("Then run this:\n```sh\nmake build\n\nmake test\n```");
});

test("box 2: a comment on the second section shows under it, and Remove deletes it", () => {
  let draft: PlanDraft = { comments: [], note: "" };
  const props = () => ({ title: "repo", plan, draft, onDraft: (d: PlanDraft) => void (draft = d), onApprove: () => {}, onRequest: () => {}, onClose: () => {} });
  const sheet = mount(PlanSheet, props());
  const blocks = (t: ReturnType<typeof sheet.render>) => findAll(t, (e) => e.type === "section" && e.props.className === "plan-block");
  let tree = sheet.render(props());
  expect(blocks(tree)).toHaveLength(3);
  const addButtons = findAll(tree, (e) => e.type === "button" && textOf(e) === "Add comment");
  addButtons[1].props.onClick();
  tree = sheet.render(props());
  const box = find(tree, (e) => e.type === "textarea" && e.props["aria-label"] === "Comment on Lines 3-8");
  box.props.onChange({ target: { value: "which target?" } });
  tree = sheet.render(props());
  find(tree, (e) => e.type === "button" && textOf(e) === "Add").props.onClick();
  expect(draft.comments).toHaveLength(1);
  expect([draft.comments[0].start, draft.comments[0].end, draft.comments[0].text]).toEqual([3, 8, "which target?"]);

  tree = sheet.render(props());
  const [first, second, third] = blocks(tree);
  expect(textOf(second)).toContain("which target?");
  expect(textOf(first)).not.toContain("which target?");
  expect(textOf(third)).not.toContain("which target?");
  find(second, (e) => e.type === "button" && textOf(e) === "Remove").props.onClick();
  expect(draft.comments).toEqual([]);
  tree = sheet.render(props());
  expect(textOf(blocks(tree)[1])).not.toContain("which target?");
});
