// T-235-b: shared by the two JPEG 2000 tests (pdfJpx.test.ts, pdfJpxOff.test.ts), which each need pdf.js loaded fresh
// because pdf.js remembers the decoder it first started. Not part of the app.
import { viewerOptions } from "./pdfFiles";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL): Uint8Array } } }).process.getBuiltinModule("node:fs");

/** The one-image PDF (src/editor/testdata/jpx.pdf: a 32 x 32 colour pattern stored as JPXDecode). */
export const jpxPdf = (): Uint8Array => Uint8Array.from(nodeFs.readFileSync(new URL("./testdata/jpx.pdf", import.meta.url)));

/** Opens the fixture with the viewer's own options; `base` is the folder (ending in a slash) that holds `pdfjs/`, as the app's base address does. */
export async function drawnImage(base: string | null): Promise<{ width: number; height: number; colours: number }> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const options = base === null ? { ...viewerOptions(""), wasmUrl: undefined } : viewerOptions(base);
  const doc = await lib.getDocument({ ...options, data: jpxPdf() }).promise;
  try {
    const page = await doc.getPage(1);
    const list = await page.getOperatorList();
    const at = list.fnArray.indexOf(lib.OPS.paintImageXObject);
    if (at < 0) throw new Error("the page paints no image");
    const name = list.argsArray[at][0] as string;
    const image = await new Promise<{ width: number; height: number; data?: Uint8ClampedArray }>((ok) => page.objs.get(name, ok));
    if (!image?.data) throw new Error("the image has no pixel data");
    const channels = image.data.length / (image.width * image.height);
    const seen = new Set<string>();
    for (let i = 0; i < image.data.length; i += channels) seen.add(Array.from(image.data.subarray(i, i + channels)).join(","));
    return { width: image.width, height: image.height, colours: seen.size };
  } finally {
    await doc.destroy();
  }
}
