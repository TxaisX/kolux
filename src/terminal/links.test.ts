// TERM-092 / TERM-093: links and file paths found in terminal text; wrapped rows joined; paths resolved.
import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { applyKoluxUnicode } from "../shell/unicodeWidth";
import { clickTarget, findLinks, fromFileUrl, handlesOn, hintFor, LINK_SCAN_CAP, linkFor, linksIn, rangeOf, resolvePath, spanOf, type Range, type Row } from "./links";

const targets = (s: string) => findLinks(s).map((f) => `${f.kind}:${f.target}${f.line !== undefined ? `@${f.line}` : ""}${f.column !== undefined ? `,${f.column}` : ""}`);

describe("TERM-095 link detection never freezes on huge lines", () => {
  it("a 1 MB line on screen gets no link scan, and a hover over it costs a bounded walk", () => {
    const cols = 200;
    const text = "x".repeat(cols - 20) + " https://a.b/in-a-huge-line";
    const rowCount = Math.ceil((1 << 20) / cols); // one logical line of 1 MB, wrapped
    let reads = 0;
    const row = (y: number): Row | undefined => (y >= 0 && y < rowCount ? (reads++, { cells: text, wrapped: y > 0 }) : undefined);
    const t0 = performance.now();
    for (const y of [0, 1, 2500, rowCount - 1]) expect(findLinks(spanOf(row, y, cols).text)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(reads).toBeLessThan(4 * 2 * (LINK_SCAN_CAP / cols + 2));
  });
  it("a span at the cap with no separator (base64, dots, hyphens) scans in linear time", () => {
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const spans = ["x".repeat(LINK_SCAN_CAP), "a.".repeat(LINK_SCAN_CAP / 2), "a-".repeat(LINK_SCAN_CAP / 2), Array.from({ length: LINK_SCAN_CAP }, (_, i) => b64[i % 64]).join("")];
    for (const s of spans) {
      const t0 = performance.now();
      expect(findLinks(s)).toEqual([]);
      expect(performance.now() - t0, `${s.slice(0, 4)}...`).toBeLessThan(40);
    }
    // the run-start rule changes nothing about what is found
    expect(targets("x=src/a/b.ts:3 at ~/w/y.md (./c/d) k:lib/e.rs")).toEqual(["file:src/a/b.ts@3", "file:~/w/y.md", "file:./c/d", "file:lib/e.rs"]);
    expect(targets(" -foo.ts:3 --a-b.rs:4,1 x-y.md:2")).toEqual(["file:foo.ts@3", "file:a-b.rs@4", "file:x-y.md@2"]);
    const hyphens = "-".repeat(LINK_SCAN_CAP - 8) + "a.ts:1";
    const t0 = performance.now();
    expect(targets(hyphens)).toEqual(["file:a.ts@1"]);
    expect(performance.now() - t0).toBeLessThan(40);
  });
  it("a long line under the cap is still joined whole and scanned", () => {
    const cols = 80;
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({ cells: i === 11 ? "end https://a.b/x" : "y".repeat(cols), wrapped: i > 0 }));
    const span = spanOf((y) => rows[y], 5, cols);
    expect(span.first).toBe(0);
    expect(findLinks(span.text).map((f) => f.target)).toEqual(["https://a.b/x"]);
    expect(spanOf((y) => rows[y], 5, cols, 10 * cols).text).toBe(""); // the same line past a smaller cap: no scan
  });
});

describe("T-586 link click areas count screen cells, not string positions", () => {
  /** A real xterm buffer, with Kolux's Unicode 16 widths (an emoji such as U+2705 and CJK take two cells), holding `text`. */
  const screen = async (text: string, cols: number) => {
    const term = new Terminal({ cols, rows: 6, allowProposedApi: true });
    applyKoluxUnicode(term);
    await new Promise<void>((done) => term.write(text, done));
    return term;
  };
  /** What the cells under a range show, row after row: what an underline marks and a Ctrl+click hits. */
  const under = (term: Terminal, r: Range) => {
    let s = "";
    for (let y = r.start.y; y <= r.end.y; y++) {
      const l = term.buffer.active.getLine(y - 1)!;
      const to = y === r.end.y ? r.end.x - 1 : term.cols - 1;
      for (let x = y === r.start.y ? r.start.x - 1 : 0; x <= to; x++) s += l.getCell(x)?.getChars() ?? "";
    }
    return s;
  };
  const shown = (term: Terminal, y = 0) => linksIn(term.buffer.active, y, term.cols).map(({ f, range }) => [f.target, under(term, range)]);

  it("a web link and a file path after a check mark and Chinese text sit on their own cells", async () => {
    const term = await screen("\u2705 \u5df2\u5b8c\u6210 see https://example.com/pull/7 and src/a.ts:3", 80);
    expect(shown(term)).toEqual([
      ["https://example.com/pull/7", "https://example.com/pull/7"],
      ["src/a.ts", "src/a.ts:3"],
    ]);
  });

  it("an emoji sequence (a ZWJ family, a skin tone) before a link moves nothing", async () => {
    const term = await screen("\u{1F469}\u200D\u{1F4BB} \u{1F44D}\u{1F3FD} https://a.example/x", 60);
    expect(shown(term)).toEqual([["https://a.example/x", "https://a.example/x"]]);
  });

  it("a link wrapped after wide characters opens whole, with its cells on both rows", async () => {
    // 11 wide characters fill 22 cells of a 40-cell row; the address runs over onto the next row.
    const term = await screen("\u6211\u5df2\u7ecf\u521b\u5efa\u4e86\u62c9\u53d6\u8bf7\u6c42\uff1ahttps://github.com/o/r/pull/123", 40);
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(true);
    for (const y of [0, 1]) expect(shown(term, y), `asked for row ${y}`).toEqual([["https://github.com/o/r/pull/123", "https://github.com/o/r/pull/123"]]);
  });

  it("a term-N handle after a check mark is a link on its own cells", async () => {
    const term = await screen("\u2705 \u4efb\u52a1 sent to term-3, then term-12.", 60);
    expect(handlesOn(term.buffer.active, 0, term.cols).map(({ handle, range }) => [handle, under(term, range)])).toEqual([
      ["term-3", "term-3"],
      ["term-12", "term-12"],
    ]);
  });
});

describe("TERM-092 clickable web links", () => {
  it("finds http(s) links and leaves the sentence's trailing punctuation out", () => {
    expect(targets("see https://example.com/a/b?x=1, then (https://en.wikipedia.org/wiki/Foo_(bar)).")).toEqual(["url:https://example.com/a/b?x=1", "url:https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(findLinks("open http://localhost:1424/x.").map((f) => f.target)).toEqual(["http://localhost:1424/x"]);
    expect(findLinks("x")).toEqual([]);
    const [f] = findLinks("go https://a.b/c now");
    expect([f.start, f.end]).toEqual([3, 16]);
  });

  it("a link wrapped over rows is read as one: the joined span, then cell ranges back", () => {
    const rows: Row[] = [
      { cells: "unrelated", wrapped: false },
      { cells: "see https://example.com/", wrapped: false },
      { cells: "very/long/path.html", wrapped: true },
      { cells: "next", wrapped: false },
    ];
    const span = spanOf((y) => rows[y], 2, 24);
    expect(span).toMatchObject({ first: 1, text: "see https://example.com/very/long/path.html" });
    const [f] = findLinks(span.text);
    expect(f.target).toBe("https://example.com/very/long/path.html");
    expect(rangeOf(span, f.start, f.end, 24)).toEqual({ start: { x: 5, y: 2 }, end: { x: 19, y: 3 } });
    expect(spanOf((y) => rows[y], 1, 24).first).toBe(1); // asked for the first row: the same span
    expect(spanOf((y) => rows[y], 3, 24)).toMatchObject({ first: 3, text: "next" });
  });

  it("the click goes to the system browser unless Open-in-Kolux is on; Shift always means the browser; no modifier, no click", () => {
    const url = findLinks("https://a.b")[0];
    const mods = (m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...m });
    expect(clickTarget(url, mods({}), false, false)).toBeNull();
    expect(clickTarget(url, mods({ ctrlKey: true }), false, false)).toBe("system");
    expect(clickTarget(url, mods({ ctrlKey: true }), false, true)).toBe("kolux");
    expect(clickTarget(url, mods({ ctrlKey: true, shiftKey: true }), false, true)).toBe("system");
    expect(clickTarget(url, mods({ metaKey: true }), true, false)).toBe("system"); // macOS: Cmd
    expect(clickTarget(url, mods({ ctrlKey: true }), true, false)).toBeNull();
    expect(hintFor(url, false, "browser")).toBe("Ctrl+click to open https://a.b in your browser");
    expect(hintFor(url, true, "kolux")).toBe("Cmd+click to open https://a.b in Kolux");
  });

  it("Alt with the modifier inverts the destination when a Kolux viewer exists; Shift beats Alt; no viewer, always the browser", () => {
    const url = findLinks("https://a.b")[0];
    const e = (m: Partial<{ shiftKey: boolean; altKey: boolean }>) => ({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...m });
    expect(clickTarget(url, e({ altKey: true }), false, false, true)).toBe("kolux"); // setting off, Alt: Kolux
    expect(clickTarget(url, e({ altKey: true }), false, true, true)).toBe("system"); // setting on, Alt: browser
    expect(clickTarget(url, e({ altKey: true, shiftKey: true }), false, false, true)).toBe("system");
    expect(clickTarget(url, e({}), false, true, false)).toBe("system"); // setting on but nothing wired
    expect(clickTarget(url, e({ altKey: true }), false, false, false)).toBe("system");
  });

  it("non-Latin letters in a URL path stay part of the link", () => {
    expect(targets("docs: https://zh.wikipedia.org/wiki/终端模拟器 and https://ja.wikipedia.org/wiki/端末エミュレータ.")).toEqual(["url:https://zh.wikipedia.org/wiki/终端模拟器", "url:https://ja.wikipedia.org/wiki/端末エミュレータ"]);
  });
});

describe("TERM-093 clickable file paths", () => {
  it("finds Windows, UNC, POSIX, relative and file:// paths with an optional :line(:col) or (line,col)", () => {
    expect(targets("error in C:\\src\\app\\main.rs:12:5 and D:/x/y.txt")).toEqual(["file:C:\\src\\app\\main.rs@12,5", "file:D:/x/y.txt"]);
    expect(targets("see \\\\server\\share\\doc.md")).toEqual(["file:\\\\server\\share\\doc.md"]);
    expect(targets("at /usr/lib/x.so and ./src/a.ts:3 and src/b/c.tsx(7,2)")).toEqual(["file:/usr/lib/x.so", "file:./src/a.ts@3", "file:src/b/c.tsx@7,2"]);
    expect(targets("file:///C:/a/b%20c.txt and file:///home/u/x")).toEqual(["file:C:/a/b c.txt", "file:/home/u/x"]);
    expect(targets("main.rs:12 but not node.js alone")).toEqual(["file:main.rs@12"]);
  });

  it("trailing punctuation is left out; numbers and bare words are not paths", () => {
    expect(targets("(C:\\a\\b.txt).")).toEqual(["file:C:\\a\\b.txt"]);
    expect(targets("open src/a.ts, then 'src/b.ts'.")).toEqual(["file:src/a.ts", "file:src/b.ts"]);
    expect(targets("16/10 and 3/4 at 12:30")).toEqual([]);
    expect(targets("PS G:\\Temp\\repo> ")).toEqual(["file:G:\\Temp\\repo"]);
  });

  it("a relative path resolves against the pane's folder; an absolute one is kept; no folder, no link", () => {
    expect(resolvePath("src/a.ts", "G:\\Dev\\proj")).toBe("G:\\Dev\\proj\\src\\a.ts");
    expect(resolvePath("./src/a.ts", "G:\\Dev\\proj\\")).toBe("G:\\Dev\\proj\\src\\a.ts");
    expect(resolvePath("../other/b.rs", "G:\\Dev\\proj")).toBe("G:\\Dev\\other\\b.rs");
    expect(resolvePath("src/a.ts", "/home/u/proj")).toBe("/home/u/proj/src/a.ts");
    expect(resolvePath("C:\\x\\y.txt", "G:\\Dev")).toBe("C:\\x\\y.txt");
    expect(resolvePath("\\\\srv\\share\\f", "G:\\Dev")).toBe("\\\\srv\\share\\f");
    expect(resolvePath("src/a.ts", null)).toBeNull();
    // review A2: Windows folds ".." in a drive path as text, so the path handed over is already folded
    expect(resolvePath("C:\\repo\\a\\..\\b\\x.txt", "G:\\Dev")).toBe("C:\\repo\\b\\x.txt");
    expect(resolvePath("C:/repo/./a/../../../x.txt", null)).toBe("C:\\x.txt");
    expect(resolvePath("/home/u/a/../b", "/x")).toBe("/home/u/a/../b"); // POSIX ".." follows links; left as is
    expect(resolvePath("\\\\srv\\share\\..\\f", "G:\\Dev")).toBe("\\\\srv\\share\\..\\f"); // a share is refused whole
    // review A3: a pane folder holding ".." is folded too, so a plain relative link is not refused for it
    expect(resolvePath("x.txt", "C:\\a\\..\\b")).toBe("C:\\b\\x.txt");
    expect(resolvePath("../x.txt", "C:\\a\\.\\b\\..\\..")).toBe("C:\\x.txt");
    expect(resolvePath("x.txt", "\\\\srv\\share")).toBe("\\\\srv\\share\\x.txt"); // a share folder keeps its form
    expect(fromFileUrl("file://server/share/x.txt")).toBe("\\\\server\\share\\x.txt");
    expect(hintFor(findLinks("src/a.ts:3")[0], false, "editor")).toBe("Ctrl+click to open src/a.ts at line 3 in the editor");
    expect(clickTarget(findLinks("src/a.ts")[0], { ctrlKey: true, metaKey: false, shiftKey: true }, false, true)).toBe("file");
  });
});

describe("TERM-093 a file link never hides a control character", () => {
  it("drops a file URL that decodes to a NUL or another control character", () => {
    expect(findLinks("file:///C:/a/run.bat%00.txt")).toEqual([]);
    expect(findLinks("see file:///G:/repo/tools/run.bat%00.txt now")).toEqual([]);
    expect(linkFor("file:///C:/x%00.txt")).toBeNull();
    expect(linkFor("file:///C:/x%0A.txt")).toBeNull();
    expect(linkFor("file:///C:/x%7F.txt")).toBeNull();
    expect(linkFor("file:///C:/x%20y.txt")?.target).toBe("C:/x y.txt");
  });

  it("a malformed % escape is no link and never throws", () => {
    expect(() => findLinks("file:///%E0%A4%A")).not.toThrow();
    expect(findLinks("file:///%E0%A4%A")).toEqual([]);
    expect(fromFileUrl("file:///C:/%ZZ")).toBeNull();
  });
});

describe("wave 2: a file URL never decodes into a name Windows rewrites", () => {
  it("drops an empty, . or .. step, a step ending in a dot or space, and a stream colon", () => {
    for (const url of [
      "file:///C:/repo/LICENSE%2E",
      "file:///C:/repo/run.cmd%20",
      "file:///C:/repo/run.cmd/.",
      "file:///C:/repo/x/%2E%2E/run.cmd",
      "file:///C:/repo/./a.txt",
      "file:///C:/repo//a.txt",
      "file:///C:/repo/notes.txt:run.vbs",
      "file:///C:/repo/notes.txt%3Arun.vbs",
      "file://server/share/a.txt%3Ax",
      "file:///home/me/a%2F..%2Fb",
    ]) {
      expect(fromFileUrl(url), url).toBeNull();
      expect(findLinks(url), url).toEqual([]);
    }
    // in running text a final dot is the sentence's and is left off the link before decoding
    expect(fromFileUrl("file:///C:/repo/LICENSE.")).toBeNull();
  });

  it("an ordinary file URL still decodes", () => {
    expect(fromFileUrl("file:///C:/repo/a%20b.txt")).toBe("C:/repo/a b.txt");
    expect(fromFileUrl("file:///home/me/.bashrc")).toBe("/home/me/.bashrc");
    expect(fromFileUrl("file://localhost/C:/a/b.txt")).toBe("C:/a/b.txt");
    expect(fromFileUrl("file://server/share/x.txt")).toBe("\\\\server\\share\\x.txt");
    expect(fromFileUrl("C:\\plain\\path.txt")).toBe("C:\\plain\\path.txt");
  });
});
