import { expect, test, vi } from "vitest";
import { ANNOTATION_OPTIONS, destinationSpot, makeLinkService, spotOffset, webLink, type LinkHost } from "./pdfPageLayers";
import { LOCKED_OPTIONS } from "./pdfFiles";
import layersSource from "./pdfPageLayers.ts?raw";
// Vitest returns "" for a .css import, so the stylesheet is read from disk through the global process.
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const extrasCss = nodeFs.readFileSync(new URL("./editor-extras.css", import.meta.url), "utf8");

// A two-page PDF written by hand: text, an https link, a mailto link, an internal link (explicit and named), a script link and a sticky note.
function fixture(): Uint8Array {
  const stream = "BT /F1 24 Tf 20 200 Td (Hello PDF) Tj ET";
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const objs: (string | null)[] = [
    "<< /Type /Catalog /Pages 2 0 R /Dests << /chap2 [5 0 R /XYZ 0 150 null] >> >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 ${font} >> >> /Annots [6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R] >>`,
    null,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    "<< /Type /Annot /Subtype /Link /Rect [20 190 150 230] /Border [0 0 0] /A << /S /URI /URI (https://example.com/docs) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [20 100 150 130] /Border [0 0 0] /Dest [5 0 R /FitH 80] >>",
    "<< /Type /Annot /Subtype /Link /Rect [20 60 150 90] /Border [0 0 0] /Dest /chap2 >>",
    "<< /Type /Annot /Subtype /Link /Rect [20 20 150 50] /Border [0 0 0] /A << /S /URI /URI (mailto:a@example.com) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [160 20 280 50] /Border [0 0 0] /A << /S /JavaScript /JS (app.alert\\(1\\)) >> >>",
    "<< /Type /Annot /Subtype /Text /Rect [250 350 270 370] /Contents (A sticky note) /Name /Note >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o ?? `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

async function open() {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return lib.getDocument({ ...LOCKED_OPTIONS, data: fixture() }).promise;
}

test("EDIT-029: the text of a page reaches the text layer (select and copy), read by the installed reader", async () => {
  const doc = await open();
  const page = await doc.getPage(1);
  const text = await page.getTextContent();
  expect(text.items.map((i) => ("str" in i ? i.str : "")).join("")).toBe("Hello PDF");
  // the layer itself takes a stream of the same content: the call the viewer makes exists on the page
  expect(typeof page.streamTextContent).toBe("function");
  await doc.loadingTask.destroy();
}, 20000);

test("EDIT-029: the annotations of a page come through; a link is a web address, a place in the file, or nothing runnable", async () => {
  const doc = await open();
  const notes = await (await doc.getPage(1)).getAnnotations({ intent: "display" });
  const links = notes.filter((a) => a.subtype === "Link");
  expect(links.map((a) => a.url).filter(Boolean)).toEqual(["https://example.com/docs", "mailto:a@example.com"]);
  expect(links.filter((a) => a.dest).map((a) => a.dest)).toEqual([expect.any(Array), "chap2"]);
  // the script link carries nothing the viewer can follow: no address, no place, so no element is bound to it
  const script = links.find((a) => !a.url && !a.dest);
  expect(script).toBeTruthy();
  expect(notes.some((a) => a.subtype === "Text" && a.contentsObj?.str === "A sticky note")).toBe(true);
  await doc.loadingTask.destroy();
}, 20000);

test("EDIT-029: an internal link, explicit or named, resolves to a page and a height; a bad one resolves to nothing", async () => {
  const doc = await open();
  const notes = await (await doc.getPage(1)).getAnnotations({ intent: "display" });
  const explicit = notes.find((a) => Array.isArray(a.dest))!.dest;
  expect(await destinationSpot(doc, explicit)).toEqual({ page: 2, top: 80 });
  expect(await destinationSpot(doc, "chap2")).toEqual({ page: 2, top: 150 });
  expect(await destinationSpot(doc, "nowhere")).toBeNull();
  expect(await destinationSpot(doc, [{ num: 999, gen: 0 }, { name: "Fit" }])).toBeNull();
  expect(await destinationSpot(doc, [7, { name: "Fit" }])).toEqual({ page: 8, top: null });
  expect(await destinationSpot(doc, [])).toBeNull();
  await doc.loadingTask.destroy();
}, 20000);

test("EDIT-029: a destination height (from the page bottom) becomes how far down the page, held to 0..1", () => {
  expect(spotOffset(null, 400)).toBe(0);
  expect(spotOffset(400, 400)).toBe(0);
  expect(spotOffset(100, 400)).toBe(0.75);
  expect(spotOffset(0, 400)).toBe(1);
  expect(spotOffset(-50, 400)).toBe(1);
  expect(spotOffset(900, 400)).toBe(0);
  expect(spotOffset(Number.NaN, 400)).toBe(0);
  expect(spotOffset(10, 0)).toBe(0);
});

test("EDIT-029: only web links leave the file, by the app's own link rules; mail, file, script and odd addresses do nothing", () => {
  expect(webLink("https://example.com/a?b=1", "C:\\n\\a.pdf", "C:\\n")).toEqual({ kind: "web", url: "https://example.com/a?b=1" });
  expect(webLink("http://example.com", "/n/a.pdf", null)).toEqual({ kind: "web", url: "http://example.com" });
  for (const bad of ["mailto:a@example.com", "javascript:alert(1)", "file:///C:/secret.txt", "tel:123", "../other.md", "C:\\secret.txt", "#page=2", "", "ftp://example.com/x"]) {
    expect(webLink(bad, "C:\\n\\a.pdf", "C:\\n"), bad).toBeNull();
  }
});

function host(over: Partial<LinkHost> = {}): LinkHost & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    pages: () => 5,
    current: () => 3,
    follow: (u, s) => void calls.push(["follow", u, s]),
    goTo: (d) => void calls.push(["goTo", d]),
    goToPage: (n) => void calls.push(["page", n]),
    ...over,
  };
}
const anchor = () => ({ title: "", tabIndex: -1, href: "", attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, onclick: null as null | ((e: unknown) => unknown), onkeydown: null as null | ((e: unknown) => unknown) });

test("EDIT-029: a clicked PDF link goes to the app (Shift for the system browser), never navigates the window itself", () => {
  const h = host();
  const svc = makeLinkService(h);
  const a = anchor();
  svc.addLinkAttributes(a as unknown as HTMLAnchorElement, "https://example.com/x");
  expect(a.href).toBe(""); // no address on the element: no middle-click or drag can open the webview on it
  expect(a.title).toBe("https://example.com/x");
  expect(a.attrs.role).toBe("link");
  const stop = vi.fn();
  expect(a.onclick?.({ preventDefault: stop, shiftKey: false })).toBe(false);
  a.onclick?.({ preventDefault: stop, shiftKey: true });
  expect(stop).toHaveBeenCalledTimes(2);
  a.onkeydown?.({ key: "Enter", preventDefault: stop, shiftKey: false });
  a.onkeydown?.({ key: "x", preventDefault: stop, shiftKey: false });
  expect(h.calls).toEqual([["follow", "https://example.com/x", false], ["follow", "https://example.com/x", true], ["follow", "https://example.com/x", false]]);
});

test("EDIT-029: internal links and the four page actions go through the viewer; any other action does nothing", async () => {
  const h = host();
  const svc = makeLinkService(h);
  expect(svc.pagesCount).toBe(5);
  expect(svc.getDestinationHash([1])).toBe("");
  expect(svc.getAnchorUrl("x")).toBe("");
  await svc.goToDestination("chap2");
  svc.goToPage(4);
  svc.goToPage("2");
  svc.goToPage("abc");
  svc.goToXY(2, 10, 10);
  for (const action of ["NextPage", "PrevPage", "FirstPage", "LastPage", "Print", "SaveAs", "GoToPage"]) svc.executeNamedAction(action);
  svc.executeSetOCGState({});
  expect(h.calls).toEqual([["goTo", "chap2"], ["page", 4], ["page", 2], ["page", 2], ["page", 4], ["page", 2], ["page", 1], ["page", 5]]);
});

test("EDIT-029: forms and scripting stay off in the annotation layer, and no address is given for its icons", () => {
  expect(ANNOTATION_OPTIONS.renderForms).toBe(false);
  expect(ANNOTATION_OPTIONS.enableScripting).toBe(false);
  expect(ANNOTATION_OPTIONS.hasJSActions).toBe(false);
  expect(ANNOTATION_OPTIONS.imageResourcesPath).toBe("data:,"); // an icon name is appended to it: never a request
  // the viewer hands the layer no download manager and no event bus
  const code = layersSource.replace(/\/\/.*$/gm, "");
  expect(/downloadManager|eventBus/.test(code)).toBe(false);
  expect(/annotationEditorUIManager:(?!\s*null)/.test(code)).toBe(false);
});

test("EDIT-029: the text layer can be selected although the window turns selection off everywhere else", () => {
  const css = extrasCss;
  const text = css.split("\n").filter((l: string) => /\.pdf-page .textLayer :is\(span, br\)/.test(l)).join("\n");
  expect(text).toMatch(/user-select:\s*text/);
  expect(text).toMatch(/color:\s*transparent/); // the picture is the canvas; the layer only carries the selection
  expect(css).toMatch(/\.pdf-page \.annotationLayer \.linkAnnotation > a/);
  expect(css).toMatch(/\.textLayer\.selecting ~ \.annotationLayer section\s*\{\s*pointer-events:\s*none/);
});
