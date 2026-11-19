import { describe, expect, it } from "vitest";
import { type Block, parseInline, parseMarkdown, safeHref } from "./markdown";

/** What each block shows as plain words (a list's items are not read). */
const words = (blocks: Block[]) => blocks.map((b) => (b.t === "code" ? b.text : b.t === "list" ? "" : b.spans.map((x) => x.text).join("")));

describe("GIT-050 rendered descriptions", () => {
  it("turns markdown into blocks", () => {
    const blocks = parseMarkdown("# Title\n\nSome **bold** and `code`\nsecond line\n\n- one\n- two\n\n1. a\n\n> quoted\n\n```ts\nlet x = 1;\n```\n");
    expect(blocks.map((b) => b.t)).toEqual(["heading", "para", "list", "list", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ t: "code", text: "let x = 1;" });
    expect(parseMarkdown("")).toEqual([]);
  });
  it("only ever links http(s) addresses, and never builds HTML", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("https://github.com/a/b")).toBe("https://github.com/a/b");
    const spans = parseInline("[ok](https://x.example/a) [bad](javascript:alert(1)) <img src=x onerror=alert(1)> see https://y.example/z");
    expect(spans.filter((s) => s.t === "link").map((s) => (s as { href: string }).href)).toEqual(["https://x.example/a", "https://y.example/z"]);
    expect(spans.some((s) => s.t === "text" && s.text.includes("<img src=x onerror=alert(1)>"))).toBe(true);
    expect(spans.some((s) => s.t === "text" && s.text.includes("[bad](javascript:alert(1)"))).toBe(true);
  });
  it("leaves HTML comments out, as a pull request template's hints, but keeps them in code", () => {
    const blocks = parseMarkdown("Intro\n\n<!-- Describe the change\nover two lines -->\n\nAfter <!-- inline --> text\n\n```\n<!-- kept -->\n```\n");
    expect(words(blocks)).toEqual(["Intro", "After  text", "<!-- kept -->"]);
  });
  it("shows the text as written when a comment never closes (stand-in review FIX-SOON 2)", () => {
    // prose that merely mentions the opener must not swallow the rest of the description
    expect(words(parseMarkdown("Use <!-- to start a hint\n\nSecond paragraph\n\n- item"))).toEqual(["Use <!-- to start a hint", "Second paragraph", ""]);
    // a closed comment before it is still left out; only the one that never closes is kept
    expect(words(parseMarkdown("A <!-- gone --> B <!-- open\n\nlast"))).toEqual(["A  B <!-- open", "last"]);
    // two openers, the first closed by the only terminator: the second shows
    expect(words(parseMarkdown("x <!-- one\nstill one --> y <!-- two\nz"))).toEqual(["x y <!-- two z"]);
  });
  it("reads a description full of unclosed comment openers in one pass (stand-in review FIX-BEFORE 1)", () => {
    const run = (text: string) => {
      const t0 = performance.now();
      const blocks = parseMarkdown(text);
      return { blocks, ms: performance.now() - t0 };
    };
    // 16000 openers on one line (about GitHub's body cap), then 8000 lines with one each: the old
    // one-opener-per-pass loop took 38 s and 7.6 s here
    const openers = "<!--".repeat(16000);
    const one = run(openers);
    expect(words(one.blocks)).toEqual([openers]);
    expect(one.ms).toBeLessThan(500);
    const many = run(Array(8000).fill("a <!-- b").join("\n"));
    expect(words(many.blocks)).toEqual([Array(8000).fill("a <!-- b").join(" ")]);
    expect(many.ms).toBeLessThan(500);
    // a closed comment before them is still left out; every opener after the last closer shows
    const mixed = run(`keep <!-- gone --> after\n${"<!-- x\n".repeat(3000)}`);
    expect(words(mixed.blocks)).toEqual([`keep  after ${Array(3000).fill("<!-- x").join(" ")}`]);
    expect(mixed.ms).toBeLessThan(500);
    // an opener closed by a later line's terminator still pairs with it, then the stray ones show
    expect(words(parseMarkdown("<!-- a\n<!-- b\nc --> d\n<!-- e"))).toEqual(["d <!-- e"]);
  });
  it("treats a tilde fence like a backtick fence, so a comment inside it is kept", () => {
    const blocks = parseMarkdown("Before\n\n~~~\n<!-- kept in tildes -->\n~~~\n\nAfter <!-- hint -->\n");
    expect(blocks.map((b) => b.t)).toEqual(["para", "code", "para"]);
    expect(words(blocks)).toEqual(["Before", "<!-- kept in tildes -->", "After"]);
    // a fence closes only with its own marker: backticks inside a tilde fence do not end it
    const mixed = parseMarkdown("~~~\n```\n<!-- still code -->\n~~~\n\nok");
    expect(words(mixed)).toEqual(["```\n<!-- still code -->", "ok"]);
  });
  it("reads bold, italic and inline code", () => {
    expect(parseInline("a **b** *c* `d`").map((s) => s.t)).toEqual(["text", "bold", "text", "italic", "text", "code"]);
  });
});
