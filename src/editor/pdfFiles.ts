// EDIT-029 (T-235-b): the plain rules behind the PDF viewer tab. Which files it opens, the locked-down options the
// PDF reader (pdf.js, Apache-2.0) is started with, the zoom, how a page is fitted to the width, and the zoom and
// position each file keeps while its tab is open. No DOM and no pdf.js here; PdfView.tsx draws.

/** A PDF file the viewer tab opens. */
export const isPdf = (path: string) => /\.pdf$/i.test(path);

/**
 * What pdf.js is started with. The bytes come from the app's own bounded file read and are handed over as data, so
 * nothing is ever fetched: no address for fonts, colour maps or wasm, the worker's own fetch is off, no string is
 * evaluated as code (the window's policy has no eval), no form scripting, and a damaged file is reported rather
 * than half-drawn.
 */
export const LOCKED_OPTIONS = {
  isEvalSupported: false,
  useWorkerFetch: false,
  useWasm: false,
  enableXfa: false,
  stopAtErrors: true,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true,
} as const;

/**
 * LOCKED_OPTIONS plus the one address the reader may load code from: the app's own `pdfjs/` folder (public/pdfjs), which
 * holds pdf.js's plain-JavaScript JPEG 2000 decoder. With `useWasm` off, pdf.js imports `${wasmUrl}openjpeg_nowasm_fallback.js`
 * as a module of the app (same origin, so `script-src 'self'` covers it; no eval, no wasm). `base` is the app's base
 * address, ending in a slash.
 */
export const JPX_DIR = "pdfjs/";
export const viewerOptions = (base: string) => ({ ...LOCKED_OPTIONS, wasmUrl: `${base}${JPX_DIR}` }) as const;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.25;
export const clampZoom = (z: number) => (Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : 1);

/** The scale at which a page `pageWidth` points wide fills `boxWidth` pixels (less a margin each side), within the zoom limits. */
export function fitWidthScale(pageWidth: number, boxWidth: number, margin = 12): number {
  if (!(pageWidth > 0) || !(boxWidth > 0)) return 1;
  return clampZoom((boxWidth - 2 * margin) / pageWidth);
}

/** What a tab remembers about its file: `fit` while the page follows the width, else the zoom chosen; and where it was scrolled to. */
export type PdfPos = { fit: boolean; zoom: number; page: number; offset: number };

/** A new tab: fills the width, at the top of the first page. */
export const START: PdfPos = { fit: true, zoom: 1, page: 1, offset: 0 };

/**
 * A stored position made safe for a document of `pages` pages: a page past the end becomes the last page, a page
 * below 1 the first; the offset (how far down the page, 0 to 1) and the zoom are held to their limits. Anything that
 * is not a readable position gives null, and the caller starts from the beginning instead.
 */
export function readPos(raw: unknown, pages: number): PdfPos | null {
  if (!raw || typeof raw !== "object" || !(pages >= 1)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fit !== "boolean" || typeof r.zoom !== "number" || typeof r.page !== "number" || typeof r.offset !== "number") return null;
  if (![r.zoom, r.page, r.offset].every(Number.isFinite)) return null;
  return { fit: r.fit, zoom: clampZoom(r.zoom), page: Math.min(Math.max(1, Math.round(r.page)), Math.floor(pages)), offset: Math.min(1, Math.max(0, r.offset)) };
}

/** Which page the top of the view is on, and how far down it (0 to 1), from each page's top edge and height. */
export function pageAt(tops: readonly number[], heights: readonly number[], scrollTop: number): { page: number; offset: number } {
  if (!tops.length) return { page: 1, offset: 0 };
  let at = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= scrollTop) at = i;
    else break;
  }
  const h = heights[at] > 0 ? heights[at] : 1;
  return { page: at + 1, offset: Math.min(1, Math.max(0, (scrollTop - tops[at]) / h)) };
}

/** The scroll position that puts `pos` at the top of the view. */
export function scrollFor(tops: readonly number[], heights: readonly number[], pos: Pick<PdfPos, "page" | "offset">): number {
  const i = Math.min(tops.length, Math.max(1, pos.page)) - 1;
  return i < 0 ? 0 : tops[i] + (heights[i] ?? 0) * pos.offset;
}

// What each open tab keeps, by file. Lives as long as the window; PdfView forgets a file when its tab closes.
const kept = new Map<string, PdfPos>();
export const remember = (path: string, pos: PdfPos) => void kept.set(path, pos);
export const recall = (path: string): unknown => kept.get(path);
export const forget = (path: string) => void kept.delete(path);
/** For tests: how many files are remembered. */
export const keptCount = () => kept.size;

/** The line that says why a PDF would not open. */
export function whyNotOpened(err: unknown, name: string): string {
  const t = String(err instanceof Error ? err.message : err);
  if (/password/i.test(t)) return `${name} is protected by a password, which this viewer cannot enter.`;
  if (/invalid pdf|missing pdf|format error|unexpected server response/i.test(t)) return `${name} could not be read: it is not a PDF this viewer understands, or the file is damaged.`;
  if (t === "empty") return `${name} is empty.`;
  return `${name} could not be opened: ${t.slice(0, 200)}`;
}
