// VIEW-066 / GIT-009: the failure notice's Pull first and Dismiss buttons show when they should and do their job.
import { expect, test, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import FailureNotice, { type Failure } from "./FailureNotice";

type Click = { onClick?: () => void; [k: string]: unknown };

/** The element carrying the data attribute, from the tree the component returns (it holds no hooks). */
function find(node: ReactNode, attr: string): ReactElement<Click> | null {
  if (Array.isArray(node)) return node.map((n) => find(n, attr)).find((n) => n !== null) ?? null;
  if (!isValidElement(node)) return null;
  const props = node.props as Click & { children?: ReactNode };
  if (attr in props) return node as ReactElement<Click>;
  return find(props.children, attr);
}

const handlers = () => ({ onRemote: vi.fn(), onCopy: vi.fn(), onFix: vi.fn(), onDismiss: vi.fn() });
const props = (failure: Failure, extra: Partial<{ busy: boolean; aiOn: boolean }> = {}) => ({ failure, busy: false, aiOn: false, ...handlers(), ...extra });

test("a push the remote refused offers Pull first, which pulls, and Dismiss, which clears the notice", () => {
  const p = props({ title: "Push failed", output: "! [rejected] feat -> feat (non-fast-forward)", behind: true });
  const html = renderToString(createElement(FailureNotice, p));
  expect(html).toContain("Pull first");
  expect(html).toContain("Dismiss");
  const tree = FailureNotice(p);
  find(tree, "data-pull-first")?.props.onClick?.();
  expect(p.onRemote).toHaveBeenCalledWith("pull", "Pull");
  find(tree, "data-dismiss-failure")?.props.onClick?.();
  expect(p.onDismiss).toHaveBeenCalledTimes(1);
});

test("Pull first is disabled while another action runs, and absent for a failure that is not about being behind", () => {
  const behind = renderToString(createElement(FailureNotice, props({ title: "Push failed", output: "x", behind: true }, { busy: true })));
  expect(behind).toMatch(/<button[^>]*disabled=""[^>]*data-pull-first/);
  const other = renderToString(createElement(FailureNotice, props({ title: "Commit failed", output: "x" })));
  expect(other).not.toContain("Pull first");
  expect(other).toContain("Dismiss");
});

test("Fix with AI shows only when the AI features are on and the failure is not a pull-policy choice", () => {
  const hook = { title: "A project check stopped this save. See why below.", output: "lint failed", fix: "lint failed" };
  expect(renderToString(createElement(FailureNotice, props(hook)))).not.toContain("Fix with AI");
  expect(renderToString(createElement(FailureNotice, props(hook, { aiOn: true })))).toContain("Fix with AI");
  expect(renderToString(createElement(FailureNotice, props({ ...hook, policy: true }, { aiOn: true })))).not.toContain("Fix with AI");
  expect(renderToString(createElement(FailureNotice, props({ ...hook, fix: null }, { aiOn: true })))).not.toContain("Fix with AI");
});

test("a pull needing a policy lists the choices; each runs the pull with it and each can be copied", () => {
  const p = props({ title: "Pull failed", output: "Need to specify how to reconcile divergent branches.", policy: true });
  const tree = FailureNotice(p);
  const first = find(tree, "data-policy");
  expect(first).not.toBeNull();
  first?.props.onClick?.();
  expect(p.onRemote).toHaveBeenCalledTimes(1);
  find(tree, "data-policy-copy")?.props.onClick?.();
  expect(p.onCopy).toHaveBeenCalledWith(expect.stringContaining("git config"), "git config command");
});
