import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import ForkDialog from "./ForkDialog";

// The fork dialog is a src/ui Dialog, drawn only on a real DOM; what it shows is read here through a stand-in.
vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);
import ShellMark from "./ShellMark";
import { shellIconOf } from "./shellChoice";

test("after776 TERM-037: the fork dialog has a name field and a Create button that is not yet busy", () => {
  const html = renderToString(createElement(ForkDialog, { onCreate: () => {}, onCancel: () => {} }));
  expect(html).toContain('aria-label="Fork Agent Session"');
  expect(html).toContain("Name");
  expect(html).toContain("Create");
  expect(html).not.toContain("Starting…");
  expect(html).toMatch(/<button class="btn primary">Create<\/button>/);
});

test("after776 TERM-043: a tab started in Git Bash keeps the Git Bash icon, PowerShell 7 its own", () => {
  const git = renderToString(createElement(ShellMark, { icon: shellIconOf("C:/Program Files/Git/bin/bash.exe") as "gitbash" }));
  expect(git).toContain('data-shell="gitbash"');
  expect(git).toContain('aria-label="Git Bash"');
  expect(renderToString(createElement(ShellMark, { icon: "pwsh" }))).toContain('aria-label="PowerShell 7"');
});
