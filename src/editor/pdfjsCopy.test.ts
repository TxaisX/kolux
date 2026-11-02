import { expect, test } from "vitest";

// DT-C71: public/pdfjs/ is a copy of pdfjs-dist's plain-JS JPEG 2000 decoder. A pdfjs-dist bump must bring a fresh copy,
// or the worker would load a decoder from another version.
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const read = (path: string) => nodeFs.readFileSync(new URL(path, import.meta.url), "utf8");

test.each(["openjpeg_nowasm_fallback.js", "LICENSE_OPENJPEG", "LICENSE_PDFJS_OPENJPEG"])(
  "public/pdfjs/%s matches the installed pdfjs-dist",
  (name) => {
    expect(read(`../../public/pdfjs/${name}`) === read(`../../node_modules/pdfjs-dist/wasm/${name}`)).toBe(true);
  },
);
