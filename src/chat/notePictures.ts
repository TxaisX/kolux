// EDIT-009 (T-234-b): pictures written into a note as data (data:image/png;base64,...) are size-checked before
// they are shown: one over the limit, one that is not a picture type and one whose data is broken are left out
// and a short note stands in its place, so a huge or damaged picture can never stall or break the page.
// (Pictures that live in files need a file-bytes read on the Rust side and are not here.)

/** The most a data picture may weigh once decoded. */
export const DATA_PICTURE_LIMIT = 4 * 1024 * 1024;

const TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i;

export type PictureCheck = { ok: true; bytes: number } | { ok: false; why: "type" | "broken" | "large"; bytes: number };

/** Whether a data: address is a picture the note may show, and what it decodes to. */
export function checkDataPicture(src: string, limit = DATA_PICTURE_LIMIT): PictureCheck {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/is.exec(src.trim());
  if (!m || !TYPES.test(m[1])) return { ok: false, why: "type", bytes: 0 };
  const params = m[2].toLowerCase();
  const body = m[3];
  let bytes: number;
  if (params.includes(";base64")) {
    const b = body.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b) || b.length % 4 === 1 || b.length === 0) return { ok: false, why: "broken", bytes: 0 };
    bytes = Math.floor((b.length * 3) / 4) - (b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0);
  } else {
    try {
      bytes = new TextEncoder().encode(decodeURIComponent(body)).length;
    } catch {
      return { ok: false, why: "broken", bytes: 0 };
    }
    if (bytes === 0) return { ok: false, why: "broken", bytes };
  }
  return bytes > limit ? { ok: false, why: "large", bytes } : { ok: true, bytes };
}

const MB = (n: number) => `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;

/** The line that stands in for a picture that is left out. */
export function skippedNote(c: Extract<PictureCheck, { ok: false }>, limit = DATA_PICTURE_LIMIT): string {
  if (c.why === "large") return `Picture not shown: ${MB(c.bytes)} is over the ${MB(limit)} a note may hold inline.`;
  if (c.why === "type") return "Picture not shown: it is not a picture type.";
  return "Picture not shown: its data is damaged.";
}

/** Replaces every <img> with a data: address that fails the check by a note (HTML from the sanitiser, so attributes are quoted). */
export function filterDataPictures(html: string, limit = DATA_PICTURE_LIMIT): string {
  if (!/src\s*=\s*["']\s*data:/i.test(html)) return html;
  return html.replace(/<img\b[^>]*?\bsrc\s*=\s*(["'])(\s*data:[\s\S]*?)\1[^>]*>/gi, (whole, _q: string, src: string) => {
    const c = checkDataPicture(src.replace(/&amp;/g, "&"), limit);
    return c.ok ? whole : `<span class="md-picture-skipped">${skippedNote(c, limit)}</span>`;
  });
}
