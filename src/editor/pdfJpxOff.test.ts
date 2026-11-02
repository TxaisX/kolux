import { expect, test } from "vitest";
import { drawnImage } from "./pdfJpxProbe";

// The control for pdfJpx.test.ts: the same file with no folder for the decoder gets no picture (the reader reports the
// damaged image instead of drawing a blank), so the passing test above is the shipped fallback's doing.
test("EDIT-029: without the pdfjs/ folder the JPEG 2000 image is not drawn", async () => {
  await expect(drawnImage(null)).rejects.toThrow();
}, 60000);
