import { expect, it, vi } from "vitest";
import { forgetPrinted, isLocalWeb, notePrinted, printedFor } from "./printedAddresses";

const DIR = "G:\\Dev\\app";

it("remembers the local web addresses a folder's terminals print, per folder, newest last", () => {
  forgetPrinted(DIR);
  notePrinted(DIR, "  VITE v5  ready\n  -> Local:   http://localhost:5173/\n  -> Network: http://192.168.1.4:5173/\n");
  notePrinted(DIR, new TextEncoder().encode("Server listening on http://0.0.0.0:3000 (see https://docs.example.com)"));
  notePrinted("G:/dev/other", "http://localhost:9999/");
  notePrinted(null, "http://localhost:1/");
  notePrinted(DIR, "plain text, no address");
  expect(printedFor("g:/dev/app/")).toEqual(["http://localhost:5173/", "http://0.0.0.0:3000"]);
  // A reprinted address moves to the end instead of repeating.
  notePrinted(DIR, "http://localhost:5173/");
  expect(printedFor(DIR)).toEqual(["http://0.0.0.0:3000", "http://localhost:5173/"]);
  expect(printedFor(null)).toEqual([]);
  expect(isLocalWeb("http://[::1]:4000/")).toBe(true);
  expect(isLocalWeb("http://app.localhost/")).toBe(true);
  expect(isLocalWeb("postgres://localhost:5432")).toBe(false);
  expect(isLocalWeb("http://example.com")).toBe(false);
});

it("output with a colon but no address is not decoded; an address in bytes is still found", () => {
  const dir = "G:/dev/bytes";
  const enc = new TextEncoder();
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  notePrinted(dir, enc.encode("error: build failed at src/main.ts:12:4\n"));
  expect(decode).not.toHaveBeenCalled();
  expect(printedFor(dir)).toEqual([]);
  notePrinted(dir, enc.encode("ready → http://localhost:4321/ ✓"));
  expect(printedFor(dir)).toEqual(["http://localhost:4321/"]);
  // an address split across two chunks is not joined, as before
  notePrinted(dir, enc.encode("open http:/"));
  notePrinted(dir, enc.encode("/localhost:8080/ now"));
  expect(printedFor(dir)).toEqual(["http://localhost:4321/"]);
  decode.mockRestore();
  forgetPrinted(dir);
});
