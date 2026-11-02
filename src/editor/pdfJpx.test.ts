import { expect, test } from "vitest";
import { drawnImage } from "./pdfJpxProbe";

// EDIT-029 (T-235-b, Txais 2026-11-01): JPEG 2000 images in a PDF show. pdf.js decodes them with its plain-JavaScript
// openjpeg module from the app's own pdfjs/ folder (public/pdfjs), loaded as a module: the window's policy is unchanged.
test("EDIT-029: a PDF with a JPEG 2000 image decodes it, through the viewer's own options and the shipped fallback", async () => {
  const image = await drawnImage(new URL("../../public/", import.meta.url).href);
  expect([image.width, image.height]).toEqual([32, 32]);
  // the picture is a colour pattern, not a blank or single-colour box
  expect(image.colours).toBeGreaterThan(16);
}, 60000);
