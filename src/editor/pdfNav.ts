// Small pure parts of the PDF tab's layout and page box (PdfView.tsx).

/** The top of every page when pages of `heights` stand one under another with `gap` above each: a running sum, so a
 *  document of thousands of pages is laid out in one pass (the old reduce per page took the sum again for every page). */
export function pageTops(heights: readonly number[], gap: number): number[] {
  const tops: number[] = [];
  let at = gap;
  for (const h of heights) {
    tops.push(at);
    at += h + gap;
  }
  return tops;
}

/** The page a typed page number names, kept inside the document; null when the text is not a whole number or the
 *  document has no pages. */
export function pageFromText(text: string, pages: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t) || pages < 1) return null;
  return Math.min(pages, Math.max(1, Number(t)));
}
