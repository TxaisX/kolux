// T-316-b (EDIT-018): a markdown note exported to a PDF. The back end (browser_pdf.rs) prints the
// note's rendered HTML in a hidden page that can load nothing from outside, so every picture must
// already sit inside the HTML as a data: address; the pure parts and the calls are here, with
// `invoke` and the picture reader passed in so a test fakes them.

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Turns one picture address (a blob: URL the preview made) into a data: address. */
export type ToDataUri = (src: string) => Promise<string>;

export type PdfOutcome = { kind: "saved"; path: string } | { kind: "cancelled" };

/** The note's title for the file name: the file's name without its ending; none for an untitled note. */
export function noteTitle(path: string | null | undefined): string {
  const name = (path ?? "").split(/[\\/]/).pop() ?? "";
  return name.replace(/\.(md|markdown|mdx|txt)$/i, "").trim();
}

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(blob:[^"']*)\2/gi;

/** The HTML with every picture held only in memory (a blob: address) replaced by its data: address.
 * A picture that cannot be read loses its address, so the PDF shows its alt text instead of a broken box. */
export async function embedPictures(html: string, toDataUri: ToDataUri): Promise<string> {
  const found = new Map<string, string>();
  for (const m of html.matchAll(IMG_SRC)) found.set(m[3], "");
  await Promise.all(
    [...found.keys()].map(async (src) => {
      try {
        found.set(src, await toDataUri(src));
      } catch {
        found.set(src, "");
      }
    }),
  );
  return html.replace(IMG_SRC, (_all, lead: string, quote: string, src: string) => `${lead}${quote}${found.get(src) ?? ""}${quote}`);
}

/** A picture file's bytes as a data: address. */
export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime || "application/octet-stream"};base64,${btoa(bin)}`;
}

/** Reads a blob: address into a data: address (the app's own page can fetch its blobs). */
export async function blobUrlToDataUri(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob();
  return new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error ?? new Error("the picture could not be read"));
    r.readAsDataURL(blob);
  });
}

/** Asks where to save, embeds the pictures, and has the back end print the PDF. The system save
 * dialog has already asked about replacing a file, so the back end is told it may. */
export async function exportNotePdf(invoke: Invoke, note: { html: string; title: string; folder?: string | null }, toDataUri: ToDataUri = blobUrlToDataUri): Promise<PdfOutcome> {
  const path = await invoke<string | null>("browser_pick_pdf_path", { title: note.title, folder: note.folder ?? null });
  if (!path) return { kind: "cancelled" };
  const html = await embedPictures(note.html, toDataUri);
  const saved = await invoke<string>("browser_export_pdf", { html, title: note.title, path, overwrite: true });
  return { kind: "saved", path: saved };
}
