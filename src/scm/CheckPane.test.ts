// T-235-b (EDIT-030): the check card draws its steps and annotations from invented data, and its buttons do their jobs.
import { expect, test, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { CheckCard } from "./CheckPane";
import type { CheckDetail, CheckRef } from "./checkCard";

type Click = { onClick?: () => void; disabled?: boolean; title?: string; [k: string]: unknown };

/** The element carrying the data attribute (with that value, when given), from the tree the component returns (it holds no hooks). */
function find(node: ReactNode, attr: string, value?: string): ReactElement<Click> | null {
  if (Array.isArray(node)) return node.map((n) => find(n, attr, value)).find((n) => n !== null) ?? null;
  if (!isValidElement(node)) return null;
  const props = node.props as Click & { children?: ReactNode };
  if (attr in props && (value === undefined || props[attr] === value)) return node as ReactElement<Click>;
  return find(props.children, attr, value);
}

const check: CheckRef = { id: 9, name: "build", link: "https://github.com/acme/app/actions/runs/42/job/9", outcome: "failed", workflow: "CI", pr: { number: 7, url: "https://github.com/acme/app/pull/7", state: "OPEN" } };
const detail: CheckDetail = {
  steps: [
    { number: 1, name: "Set up job", status: "completed", conclusion: "success" },
    { number: 2, name: "Run tests", status: "completed", conclusion: "failure" },
    { number: 3, name: "Post cleanup", status: "in_progress", conclusion: null },
  ],
  annotations: [
    { path: "src/a.rs", startLine: 4, endLine: 6, level: "failure", title: "E0308", message: "mismatched types" },
    { path: "../../etc/passwd", startLine: 1, endLine: 1, level: "warning", title: "", message: "climbs out" },
  ],
};
const props = (over: Partial<Parameters<typeof CheckCard>[0]> = {}) => ({
  check,
  cwd: "C:\\w\\proj",
  detail,
  error: null,
  loading: false,
  fixBlocker: null as string | null,
  busy: false,
  note: null,
  onCopy: vi.fn(),
  onFix: vi.fn(),
  onOpenFile: vi.fn(),
  ...over,
});

test("the card shows the check's name, its steps with their status and its annotations, and no path", () => {
  const html = renderToString(createElement(CheckCard, props()));
  expect(html).toContain("build");
  expect(html).toContain("Set up job");
  expect(html).toContain("Run tests");
  expect(html).toContain("failure");
  expect(html).toContain("in_progress");
  expect(html).toContain("E0308");
  expect(html).toContain("mismatched types");
  expect(html).toContain("src/a.rs:4");
  expect(html).toContain("Copy card");
  expect(html).toContain("Fix with AI");
  expect(html).not.toContain("C:\\w\\proj");
});

test("an annotation inside the worktree opens that file at that line; one that climbs out is disabled with a visible reason", () => {
  const p = props();
  const tree = CheckCard(p);
  find(tree, "data-annotation", "0")?.props.onClick?.();
  expect(p.onOpenFile).toHaveBeenCalledWith("C:\\w\\proj\\src\\a.rs", 4);
  const out = find(tree, "data-annotation", "1");
  expect(out?.props.disabled).toBe(true);
  out?.props.onClick?.();
  expect(p.onOpenFile).toHaveBeenCalledTimes(1);
  expect(renderToString(createElement(CheckCard, p))).toContain("Outside this worktree");
});

test("Copy card and Fix with AI do their jobs; Fix is off, with its reason, when the gate says so", () => {
  const p = props();
  const tree = CheckCard(p);
  find(tree, "data-copy-card")?.props.onClick?.();
  expect(p.onCopy).toHaveBeenCalledTimes(1);
  find(tree, "data-fix-ai")?.props.onClick?.();
  expect(p.onFix).toHaveBeenCalledTimes(1);

  const shut = props({ fixBlocker: "The pull request is not open." });
  const fix = find(CheckCard(shut), "data-fix-ai");
  expect(fix?.props.disabled).toBe(true);
  expect(fix?.props.title).toBe("The pull request is not open.");
});

test("a check that is still loading, a read that failed and a job without steps each say so", () => {
  expect(renderToString(createElement(CheckCard, props({ detail: null, loading: true })))).toContain("Reading the check");
  expect(renderToString(createElement(CheckCard, props({ detail: null, error: "gh is not signed in" })))).toContain("gh is not signed in");
  expect(renderToString(createElement(CheckCard, props({ detail: { steps: [], annotations: [] } })))).toContain("No steps reported");
});
