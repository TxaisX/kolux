// VIEW 089 (T-153-d): the Show file, Open file and Delete buttons ask the right back-end command, and
// Delete is a two-step action: nothing is sent until the person confirms in the row.
import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import SessionFiles from "./SessionFiles";
import { DELETE_WARNING, doneNote, runFileAction } from "./files";

const s = { agent: "claude", id: "abc-123" };
beforeEach(() => {
  invoke.mockReset();
});

test("VIEW 089: Show file calls session_reveal with the agent and id only", async () => {
  invoke.mockResolvedValue(null);
  expect(await runFileAction("reveal", s)).toBe("Shown in the file manager.");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("session_reveal", { agent: "claude", id: "abc-123" });
});

test("VIEW 089: Open file calls session_open", async () => {
  invoke.mockResolvedValue(null);
  expect(await runFileAction("open", s)).toBe("Opened.");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("session_open", { agent: "claude", id: "abc-123" });
});

test("VIEW 089: Delete calls session_delete and says how many items went", async () => {
  invoke.mockResolvedValue(2);
  expect(await runFileAction("delete", s)).toBe("Session deleted (2 items removed).");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("session_delete", { agent: "claude", id: "abc-123" });
  expect(doneNote("delete", 1)).toBe("Session deleted (1 item removed).");
});

test("VIEW 089: a refusal from the back end reaches the row as the error", async () => {
  invoke.mockImplementation(() => Promise.reject("C:/x is not inside the sessions folder, so Kolux leaves it alone."));
  const err = await runFileAction("delete", s).then(() => "", (e: unknown) => String(e));
  expect(err).toMatch(/not inside the sessions folder/);
});

test("VIEW 089: the row offers the three buttons and sends nothing until asked", () => {
  const html = renderToString(createElement(SessionFiles, { session: s, onNote: () => {}, onDeleted: () => {} }));
  for (const label of ["Show file", "Open file", "Delete…"]) expect(html).toContain(label);
  expect(html).not.toContain(DELETE_WARNING.slice(0, 20));
  expect(invoke).not.toHaveBeenCalled();
});

test("VIEW 089: once Delete is chosen the row asks first, with Delete and Keep", () => {
  const html = renderToString(createElement(SessionFiles, { session: s, onNote: () => {}, onDeleted: () => {}, asking: true }));
  expect(html).toContain("Delete this session&#x27;s files? This cannot be undone.");
  expect(html).toContain("Keep");
  expect(html).not.toContain("Show file");
  expect(invoke).not.toHaveBeenCalled();
});

test("UX: the delete question names the session, and falls back to the plain warning without a title", async () => {
  const { deleteQuestion } = await import("./files");
  expect(deleteQuestion("Fix the login bug")).toBe('Delete "Fix the login bug" and its files? This cannot be undone.');
  expect(deleteQuestion("  ")).toBe(DELETE_WARNING);
  expect(deleteQuestion()).toBe(DELETE_WARNING);
  expect(deleteQuestion("x".repeat(100))).toContain("x".repeat(59) + "…");
  const html = renderToString(createElement(SessionFiles, { session: { ...s, title: "Fix the login bug" }, onNote: () => {}, onDeleted: () => {}, asking: true }));
  expect(html).toContain("Fix the login bug");
});
