import { expect, test } from "vitest";
import { PrintedUrls, afterScan, decodeOutput, openAddress, openWhere, ownCount, stopArgs, stopNote, urlsIn, type PortRow } from "./ports";

const row = (port: number, addr = "127.0.0.1", external = false, terminal: number | null = 7): PortRow => ({ port, addr, pid: 1, external, started: "", terminal: external ? null : terminal });

test("VIEW-078 an address in coloured dev server output is found without its colour codes", () => {
  const out = "  \u001b[32m\u001b[1mLocal\u001b[22m:\u001b[39m   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m";
  expect(urlsIn(out)).toEqual([[5173, "http://localhost:5173/"]]);
});

test("VIEW-078 a printed address counts only while a process listens on its port", () => {
  const p = new PrintedUrls();
  p.record("ready on http://localhost:3000\n", 7);
  expect(p.forPort(3000, [row(3000)])).toBe("http://localhost:3000");
  expect(p.forPort(3000, [row(4000)])).toBeNull();
  p.record("now http://127.0.0.1:3000/app", 7);
  expect(p.forPort(3000, [row(3000)])).toBe("http://127.0.0.1:3000/app");
});

test("VIEW-078 a printed address binds only to a program under the terminal that printed it", () => {
  const p = new PrintedUrls();
  p.record("ready on http://localhost:3000/a\n", 7);
  p.record("ready on http://localhost:3000/b\n", 8);
  expect(p.forPort(3000, [row(3000, "127.0.0.1", false, 8)])).toBe("http://localhost:3000/b");
  expect(p.forPort(3000, [row(3000, "127.0.0.1", false, 7)])).toBe("http://localhost:3000/a");
  expect(p.forPort(3000, [row(3000, "127.0.0.1", false, 9)])).toBeNull();
  expect(p.forPort(3000, [row(3000, "127.0.0.1", true)])).toBeNull();
  expect(p.forPort(3000, [row(3000, "127.0.0.1", false, 9), row(3000, "::1", false, 8)])).toBe("http://localhost:3000/b");
});

test("VIEW-078 a Stop sends back the start time it saw, as text, so a reused process id is refused", () => {
  const r: PortRow = { port: 5173, addr: "127.0.0.1", pid: 4242, external: false, started: "133700000000000000", terminal: 7 };
  expect(stopArgs(["C:\\work\\app"], "C:\\work\\app", r)).toEqual({ workspaces: ["C:\\work\\app"], active: "C:\\work\\app", port: 5173, pid: 4242, started: "133700000000000000" });
  expect(typeof stopArgs([], "x", r).started).toBe("string");
});

test("VIEW-078 the note after a Stop says stopped only for a program that was ended", () => {
  expect(stopNote(5173, "stopped")).toBe("Stopped port 5173");
  expect(stopNote(5173, "gone")).toBe("Port 5173 was already gone; nothing was stopped");
  expect(stopNote(5173, "moved")).toBe("Port 5173 is no longer held by that program; nothing was stopped");
});

test("VIEW-078 Open uses the printed address, else plain http on the listening address", () => {
  expect(openAddress(row(5173), "http://localhost:5173/")).toBe("http://localhost:5173/");
  expect(openAddress(row(8080, "0.0.0.0"), null)).toBe("http://localhost:8080");
  expect(openAddress(row(8080, "::"), null)).toBe("http://localhost:8080");
  expect(openAddress(row(8080, "::1"), null)).toBe("http://[::1]:8080");
  expect(openAddress(row(8080, "192.168.1.5"), null)).toBe("http://192.168.1.5:8080");
});

test("VIEW-078 only Shift with Ctrl sends Open to the system browser", () => {
  expect(openWhere({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe("system");
  expect(openWhere({ shiftKey: true, ctrlKey: false, metaKey: true })).toBe("system");
});

test("VIEW-078 a failed scan names the problem and keeps the last good list", () => {
  const good = afterScan({ rows: [], error: null }, { rows: [row(5173)] });
  const bad = afterScan(good, { error: "The port scan failed: netstat did not finish" });
  expect(bad.rows).toEqual(good.rows);
  expect(bad.error).toContain("netstat");
  expect(afterScan(bad, { rows: [] })).toEqual({ rows: [], error: null });
});

test("VIEW-078 the item counts only the workspace's own ports", () => {
  expect(ownCount([row(1), row(2, "0.0.0.0", true), row(3)])).toBe(2);
});

test("VIEW-078 terminal output decodes from base64 and a bad payload is empty text", () => {
  expect(decodeOutput(btoa("http://localhost:1234"))).toBe("http://localhost:1234");
  expect(decodeOutput("%%%")).toBe("");
});
