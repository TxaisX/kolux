import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../terminal/newTabEntry";
import { entryMemory, entryTarget, loadEntries, openWebAddress, remember } from "./newTabEntryRun";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const row = (r: Partial<Row> & { kind: Row["kind"] }) => ({ label: "", detail: "", ...r }) as Row;

describe("after776 TERM-042 what a row opens", () => {
  it("an address opens in the system browser through open_external", async () => {
    await openWebAddress("https://example.com/");
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/" });
  });
  it("an address row opens the system browser, a file row the editor, a tab row jumps to the tab", () => {
    expect(entryTarget(row({ kind: "url", url: "http://192.168.1.10:3000" }))).toEqual({ kind: "browser", url: "http://192.168.1.10:3000" });
    expect(entryTarget(row({ kind: "file", path: "C:/w/notes.md" }))).toEqual({ kind: "file", path: "C:/w/notes.md" });
    expect(entryTarget(row({ kind: "tab", key: 7 }))).toEqual({ kind: "tab", key: 7 });
  });
  it("a remembered entry is read again: an address opens the system browser, a path a file, anything else nothing", () => {
    expect(entryTarget(row({ kind: "recent", value: "https://example.com/a" }))).toEqual({ kind: "browser", url: "https://example.com/a" });
    expect(entryTarget(row({ kind: "history", value: "localhost:5173" }))).toEqual({ kind: "browser", url: "http://localhost:5173" });
    expect(entryTarget(row({ kind: "recent", value: "C:/w/a.txt" }))).toEqual({ kind: "file", path: "C:/w/a.txt" });
    expect(entryTarget(row({ kind: "recent", value: "just words" }))).toBeNull();
  });
  it("switching to a tab remembers nothing; the rest remember what they opened", () => {
    expect(entryMemory(row({ kind: "tab", key: 1 }))).toBeNull();
    expect(entryMemory(row({ kind: "url", url: "http://localhost:3000" }))).toBe("http://localhost:3000");
    expect(entryMemory(row({ kind: "file", path: "C:/w/a.txt" }))).toBe("C:/w/a.txt");
  });
});

describe("after776 TERM-042 remembered entries", () => {
  afterEach(() => vi.unstubAllGlobals());
  const store = () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    return data;
  };
  it("keeps newest first without repeats and reads them back", () => {
    store();
    let list = loadEntries();
    expect(list).toEqual([]);
    list = remember(list, row({ kind: "url", url: "http://localhost:3000" }));
    list = remember(list, row({ kind: "file", path: "C:/w/a.txt" }));
    list = remember(list, row({ kind: "url", url: "http://localhost:3000" }));
    expect(list).toEqual(["http://localhost:3000", "C:/w/a.txt"]);
    expect(loadEntries()).toEqual(list);
  });
  it("a store that throws or holds junk is an empty list, and a refused save still returns the list", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{not json", setItem: () => { throw new Error("full"); } });
    expect(loadEntries()).toEqual([]);
    expect(remember([], row({ kind: "url", url: "http://localhost:1" }))).toEqual(["http://localhost:1"]);
  });
});
