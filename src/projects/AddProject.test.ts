// PROJ-002: the Add Project dialog's first step and its keys. PROJ-003 and PROJ-004: the clone
// and new-project steps in each of their states.
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AddProjectView, nextChoice, type Form, type Step } from "./AddProject";

// The dialog is a src/ui Dialog, drawn only on a real DOM; what it shows is read here through a stand-in.
vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);

const noop = () => {};
const view = (step: Step, start?: Partial<Form>) => renderToString(createElement(AddProjectView, { step, onStep: noop, onBrowse: noop, onClose: noop, start }));

test("arrow keys move between the three choices and wrap; other keys leave focus alone", () => {
  expect(nextChoice("ArrowDown", 0)).toBe(1);
  expect(nextChoice("ArrowRight", 1)).toBe(2);
  expect(nextChoice("ArrowDown", 2)).toBe(0);
  expect(nextChoice("ArrowUp", 0)).toBe(2);
  expect(nextChoice("ArrowLeft", 2)).toBe(1);
  expect(nextChoice("Enter", 1)).toBeNull();
  expect(nextChoice("a", 0)).toBeNull();
});

test("cloning is the main choice, with Browse then New project beside it", () => {
  const html = view("choose");
  expect(html).toContain('role="dialog"');
  const clone = html.indexOf(">Copy from a web address<");
  const browse = html.indexOf("Open a folder");
  const fresh = html.indexOf("New project");
  expect(clone).toBeGreaterThan(-1);
  expect(clone).toBeLessThan(browse);
  expect(browse).toBeLessThan(fresh);
  // Only the clone choice is the primary button.
  expect(html.match(/add-choice primary/g)).toHaveLength(1);
  expect(html.slice(html.lastIndexOf("<button", clone), clone)).toContain("primary");
});

test("the clone step takes an address and a folder, and Copy waits for both", () => {
  const empty = view("clone");
  expect(empty).not.toContain("not built yet");
  expect(empty).toContain('aria-label="web address of the project"');
  expect(empty).toContain('aria-label="folder the copy goes in"');
  expect(empty).toMatch(/<button[^>]*disabled[^>]*>Copy<\/button>/);
  const ready = view("clone", { url: "https://github.com/o/p.git", dest: "C:/Users/me/p" });
  expect(ready).toMatch(/<button class="btn primary"(?![^>]*disabled)[^>]*>Copy<\/button>/);
  expect(ready).toContain('value="C:/Users/me/p"');
});

test("a running clone shows Git's progress and a Cancel button, and Git's own words when it fails", () => {
  const running = view("clone", { url: "u", dest: "d", ticket: "clone-1", progress: "Receiving objects:  40% (4/10)" });
  expect(running).toContain("Receiving objects:  40% (4/10)");
  expect(running).toMatch(/<button class="btn"[^>]*>Cancel<\/button>/);
  expect(running).not.toContain(">Copy<");
  expect(running).toMatch(/<button class="btn"[^>]*disabled[^>]*>Back<\/button>/);
  const failed = view("clone", { url: "u", dest: "d", error: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" });
  expect(failed).toMatch(/role="alert"[^>]*>fatal: could not read Username/);
});

test("the new-project step takes a name and a parent folder, and says what stops it", () => {
  const empty = view("new");
  expect(empty).not.toContain("not built yet");
  expect(empty).toContain('aria-label="project name"');
  expect(empty).toContain('aria-label="folder the project goes in"');
  expect(empty).toMatch(/<button[^>]*disabled[^>]*>Create<\/button>/);
  const ready = view("new", { name: "demo", parent: "C:/Users/me" });
  expect(ready).toMatch(/<button class="btn primary"(?![^>]*disabled)[^>]*>Create<\/button>/);
  const noGit = view("new", { name: "demo", parent: "C:/Users/me", problem: "Git is not installed on this computer" });
  expect(noGit).toMatch(/role="alert"[^>]*>Git is not installed/);
  expect(noGit).toMatch(/<button[^>]*disabled[^>]*>Create<\/button>/);
});
