import { expect, test } from "vitest";
import { clampZoom, fitWidthScale, forget, isPdf, keptCount, LOCKED_OPTIONS, pageAt, readPos, recall, remember, scrollFor, START, whyNotOpened, ZOOM_MAX, ZOOM_MIN } from "./pdfFiles";

test("EDIT-029: .pdf files, in any case, open in the PDF viewer", () => {
  expect(isPdf("C:\\a\\Report.PDF")).toBe(true);
  expect(isPdf("/a/b.pdf")).toBe(true);
  expect(isPdf("/a/b.pdf.txt")).toBe(false);
  expect(isPdf("/a/pdf")).toBe(false);
});

test("EDIT-029: the reader is locked down: nothing fetched, nothing evaluated, no wasm, no form scripting", () => {
  expect(LOCKED_OPTIONS.isEvalSupported).toBe(false);
  expect(LOCKED_OPTIONS.useWorkerFetch).toBe(false);
  expect(LOCKED_OPTIONS.useWasm).toBe(false);
  expect(LOCKED_OPTIONS.enableXfa).toBe(false);
  expect(LOCKED_OPTIONS.disableStream && LOCKED_OPTIONS.disableRange && LOCKED_OPTIONS.disableAutoFetch).toBe(true);
  // no address of any kind is part of the locked set (the one folder for the JPEG 2000 decoder comes from viewerOptions)
  expect(Object.keys(LOCKED_OPTIONS).some((k) => /url|cmap|path/i.test(k))).toBe(false);
});

test("EDIT-029: a new tab first fills the width, and the fit never leaves the zoom limits", () => {
  expect(START.fit).toBe(true);
  expect(fitWidthScale(600, 624)).toBe(1); // 600 wide page, 12 px margin each side
  expect(fitWidthScale(600, 1224)).toBe(2);
  expect(fitWidthScale(600, 100)).toBe(ZOOM_MIN);
  expect(fitWidthScale(50, 5000)).toBe(ZOOM_MAX);
  expect(fitWidthScale(0, 800)).toBe(1);
  expect(fitWidthScale(600, 0)).toBe(1);
  expect(clampZoom(NaN)).toBe(1);
  expect(clampZoom(99)).toBe(ZOOM_MAX);
});

test("EDIT-029: a stored page past the end of a shorter document opens at its last page", () => {
  expect(readPos({ fit: false, zoom: 2, page: 40, offset: 0.5 }, 12)).toEqual({ fit: false, zoom: 2, page: 12, offset: 0.5 });
  expect(readPos({ fit: true, zoom: 1, page: 0, offset: 0 }, 12)?.page).toBe(1);
  expect(readPos({ fit: true, zoom: 9, page: 3.4, offset: 4 }, 12)).toEqual({ fit: true, zoom: ZOOM_MAX, page: 3, offset: 1 });
});

test("EDIT-029: a stored position that cannot be read is ignored", () => {
  for (const bad of [null, undefined, 5, "x", [], {}, { fit: "yes", zoom: 1, page: 1, offset: 0 }, { fit: true, zoom: NaN, page: 1, offset: 0 }, { fit: true, zoom: 1, page: Infinity, offset: 0 }, { fit: true, zoom: 1, page: 1 }]) {
    expect(readPos(bad, 10)).toBe(null);
  }
  expect(readPos(START, 0)).toBe(null); // a document with no pages has nothing to go to
});

test("EDIT-029: the page under the top of the view and the scroll that returns to it agree", () => {
  const tops = [0, 800, 1600, 2400];
  const heights = [800, 800, 800, 800];
  expect(pageAt(tops, heights, 0)).toEqual({ page: 1, offset: 0 });
  expect(pageAt(tops, heights, 1000)).toEqual({ page: 2, offset: 0.25 });
  expect(pageAt(tops, heights, 99999)).toEqual({ page: 4, offset: 1 });
  expect(pageAt([], [], 50)).toEqual({ page: 1, offset: 0 });
  expect(scrollFor(tops, heights, { page: 2, offset: 0.25 })).toBe(1000);
  expect(scrollFor(tops, heights, { page: 99, offset: 0 })).toBe(2400);
  expect(scrollFor([], [], { page: 1, offset: 0 })).toBe(0);
});

test("EDIT-029: a file's zoom and position are kept while its tab is open and dropped when it closes", () => {
  const before = keptCount();
  remember("C:\\a.pdf", { fit: false, zoom: 2, page: 3, offset: 0.1 });
  expect(readPos(recall("C:\\a.pdf"), 10)).toEqual({ fit: false, zoom: 2, page: 3, offset: 0.1 });
  expect(recall("C:\\b.pdf")).toBeUndefined(); // another file has its own
  forget("C:\\a.pdf");
  expect(recall("C:\\a.pdf")).toBeUndefined();
  expect(keptCount()).toBe(before);
});

test("EDIT-029: a PDF that would not open says why in words", () => {
  expect(whyNotOpened(new Error("No password given"), "a.pdf")).toMatch(/password/);
  expect(whyNotOpened({ message: "x" }, "a.pdf")).toMatch(/could not be opened/);
  expect(whyNotOpened(new Error("Invalid PDF structure."), "a.pdf")).toMatch(/damaged/);
  expect(whyNotOpened("empty", "a.pdf")).toBe("a.pdf is empty.");
});
