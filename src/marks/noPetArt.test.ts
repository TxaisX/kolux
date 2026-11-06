// @vitest-environment node
// HID-042 (T-338): the old app's pet characters (a Claude-themed wizard and a gremlin) are
// third-party themed art. Kolux ships no pet, so the card is a standing check that nothing of
// that art, or any pet picture at all, is in what the app bundles. If a pet is ever revived, its
// art is the owner's own and this test is changed in the same commit as that card.
import { expect, test } from "vitest";
import conf from "../../src-tauri/tauri.conf.json";

// Vite lists the files (keys only for the lazy globs; text for the SVGs and NOTICE.md), so no Node types are needed.
const srcLazy = import.meta.glob("/src/**/*.*", { query: "?url", import: "default" });
const iconLazy = import.meta.glob("/src-tauri/icons/*.*", { query: "?url", import: "default" });
const svgText = import.meta.glob("/src/**/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const iconSvgText = import.meta.glob("/src-tauri/icons/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const noticeText = Object.values(import.meta.glob("/src/assets/vendors/NOTICE.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0] ?? "";

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|ico|icns|svg|apng|avif|mp4|webm|lottie)$/i;
/** Every picture the app can bundle: the web app's own and the window icons (the config lists no other resource folder, checked below). */
const bundled = (): string[] => [...Object.keys(srcLazy), ...Object.keys(iconLazy)].filter((f) => PICTURE.test(f)).map((f) => f.slice(1));

test("HID-042: no picture in the bundle is named for a pet or for either old pet character", () => {
  const files = bundled();
  expect(files.length).toBeGreaterThan(10); // the icons and vendor marks are found, so the scan is not empty
  const bad = files.filter((f) => /claudino|gremlin|wizard|(^|[/_.-])(pet|pets|mascot|sprite)s?([/_.-]|\d|$)/i.test(f));
  expect(bad).toEqual([]);
});

test("HID-042: no bundled SVG names a pet character inside its own text", () => {
  for (const [f, text] of Object.entries({ ...svgText, ...iconSvgText })) {
    expect(text, f).not.toMatch(/claudino|gremlin/i);
  }
});

test("HID-042: the bundle config lists no resource folder, so no art rides along outside src and icons", () => {
  expect((conf as { bundle?: { resources?: unknown } }).bundle?.resources ?? null).toBeNull();
});

test("HID-042: the only pictures under src are vendor marks listed in NOTICE.md; the icons folder holds only app icons", () => {
  // A picture counts as listed only when it has its own table row (a row starts with the file name in
  // back-ticks), not when the name merely appears in the NOTICE prose (review 52195201 AFTER 3).
  const listed = new Set(noticeText.split("\n").map((line) => /^\| `([^`]+)` \|/.exec(line)?.[1]).filter(Boolean));
  expect(listed.size).toBeGreaterThanOrEqual(8);
  for (const f of bundled().filter((p) => p.startsWith("src/"))) {
    expect(f.startsWith("src/assets/vendors/"), f).toBe(true);
    expect(listed.has(f.split("/").pop()!), f).toBe(true);
  }
  const icons = bundled().filter((p) => p.startsWith("src-tauri/icons/")).map((p) => p.split("/").pop()!);
  for (const f of icons) expect(f, f).toMatch(/^(\d+x\d+(@2x)?\.png|icon\.(png|ico|icns)|Square\d+x\d+Logo\.png|StoreLogo\.png|app-icon\.svg)$/);
});
