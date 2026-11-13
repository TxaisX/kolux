import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { isHtml, offersPreview, previewHtml } from "./htmlPreview";

test("EDIT-025: only HTML files offer a preview, and a diff of a deleted one does not", () => {
  expect(isHtml("C:/w/a.html")).toBe(true);
  expect(isHtml("C:/w/a.HTM")).toBe(true);
  expect(isHtml("C:/w/a.html.txt")).toBe(false);
  expect(offersPreview("C:/w/a.html")).toBe(true);
  expect(offersPreview("C:/w/a.html", true)).toBe(true);
  expect(offersPreview("C:/w/a.html", false)).toBe(false);
  expect(offersPreview("C:/w/a.ts", true)).toBe(false);
});

test("EDIT-025: Preview opens a browser tab at the served address; a refusal is worded for the toast", async () => {
  const open = vi.fn();
  expect(await previewHtml("C:/w/a.html", async () => ({ url: "http://127.0.0.1:5/t/a.html" }), open)).toBeNull();
  expect(open).toHaveBeenCalledWith("http://127.0.0.1:5/t/a.html");
  const shut = vi.fn();
  expect(await previewHtml("C:/w/a.html", async () => Promise.reject("not an HTML document"), shut)).toMatch(/did not open: not an HTML document/);
  expect(shut).not.toHaveBeenCalled();
});
