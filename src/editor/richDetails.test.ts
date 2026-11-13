import { describe, expect, test } from "vitest";
import { $createTextNode, $getRoot, createEditor, type ElementNode, type LexicalEditor } from "lexical";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { $convertFromMarkdownString, CHECK_LIST, TRANSFORMERS, type Transformer } from "@lexical/markdown";
import { DETAILS_NODES, makeDetails } from "./richDetails";
import { applyFormat, applyImage, applyLink, cleanUrl, imageLink, linkAt, MORE_BLOCKS, RICH_BUTTONS } from "./richFormat";
import { roundTrip, unsupported } from "./markdown";
import { $exportMarkdown } from "./mdExport";

const MD: Transformer[] = [makeDetails(() => MD), CHECK_LIST, ...TRANSFORMERS];

function editorWith(md: string, pick: "start" | "word" = "start"): LexicalEditor {
  const e = createEditor({ namespace: "t", nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, ...DETAILS_NODES], onError: (x) => { throw x; } });
  registerRichText(e);
  e.update(() => {
    $convertFromMarkdownString(md, MD);
    if (pick === "start") $getRoot().selectStart();
    else (($getRoot().getFirstChild() as ElementNode).getFirstChild() as ReturnType<typeof $createTextNode>).select(0, 5);
  }, { discrete: true });
  return e;
}
const md = (e: LexicalEditor) => {
  e.update(() => {}, { discrete: true });
  return e.getEditorState().read(() => $exportMarkdown(MD));
};

const SECTION = "<details>\n<summary>More</summary>\n\nInside text\n\n</details>";

describe("EDIT-057 collapsible section", () => {
  test("a section in a note is read as a section and written back the same", () => {
    expect(unsupported(`Intro\n\n${SECTION}\n\nAfter`)).toBeNull();
    expect(roundTrip(`Intro\n\n${SECTION}\n\nAfter`)).toBe(`Intro\n\n${SECTION}\n\nAfter`);
  });
  test("a section written without blank lines is read, and written in the standard shape", () => {
    const loose = "<details>\n<summary>More</summary>\nInside text\n</details>";
    expect(unsupported(loose)).toBeNull();
    expect(roundTrip(loose)).toBe(SECTION);
  });
  test("sections inside sections keep their order", () => {
    const nested = "<details>\n<summary>Outer</summary>\n\nA\n\n<details>\n<summary>Inner</summary>\n\nB\n\n</details>\n\nC\n\n</details>";
    expect(unsupported(nested)).toBeNull();
    expect(roundTrip(nested)).toBe(nested);
  });
  test("an open attribute or other HTML is read as plain HTML lines, nothing lost (row 94)", () => {
    const open = "<details open>\n<summary>x</summary>\n\ny\n\n</details>";
    expect(unsupported(open)).toBeNull();
    expect(roundTrip(open)).toBe(open);
    expect(unsupported("<div>x</div>")).toBeNull();
    expect(unsupported("<details>\n<summary>x</summary>\n\ny\n")).toBeNull(); // read as plain lines, nothing lost
  });
  test("More blocks offers heading 4, heading 5 and the collapsible section; choosing it inserts one with a paragraph after", () => {
    expect(MORE_BLOCKS.map((m) => m.tip)).toEqual(["Heading 4", "Heading 5", "Collapsible section"]);
    const e = editorWith("Text");
    expect(applyFormat(e, "details")).toBe(true);
    expect(md(e).trimEnd()).toBe("Text\n\n<details>\n<summary>Section</summary>\n\n</details>");
  });
  test("Enter in the title starts the body", () => {
    const e = editorWith(SECTION);
    e.update(() => {
      const t = ($getRoot().getFirstChild() as ElementNode).getFirstChild() as ElementNode;
      t.selectEnd();
      (t as ElementNode).insertNewAfter(null as never);
    }, { discrete: true });
    expect(md(e)).toContain("<summary>More</summary>\n\nInside text");
  });
});

describe("EDIT-057 link and image", () => {
  test("the toolbar offers Link and Image", () => {
    expect(RICH_BUTTONS.filter((b) => b.id === "link" || b.id === "image").map((b) => b.tip)).toEqual(["Link", "Image"]);
  });
  test("a selected word becomes a link, and the box is filled with its address next time", () => {
    const e = editorWith("Hello world", "word");
    expect(applyLink(e, "https://example.com/a")).toBe(true);
    expect(md(e)).toBe("[Hello](https://example.com/a) world");
    expect(linkAt(e)).toBe("https://example.com/a");
    expect(applyLink(e, "")).toBe(true);
    expect(md(e)).toBe("Hello world");
    expect(linkAt(e)).toBe("");
  });
  test("with nothing selected the address becomes the link text", () => {
    const e = editorWith("");
    expect(applyLink(e, "https://example.com")).toBe(true);
    expect(md(e)).toBe("[https://example.com](https://example.com)");
  });
  test("a script address is refused and spaces are escaped", () => {
    const e = editorWith("Hello world", "word");
    expect(applyLink(e, "javascript:alert(1)")).toBe(false);
    expect(cleanUrl(" DATA:text/html,x ")).toBeNull();
    expect(cleanUrl(" docs/my note.md ")).toBe("docs/my%20note.md");
    expect(md(e)).toBe("Hello world");
  });
  test("a picked picture is linked relative to the note, with spaces and brackets safe", () => {
    const bs = (p: string) => p.split("/").join(String.fromCharCode(92));
    expect(imageLink(bs("C:/w/notes/a.md"), bs("C:/w/notes/img/Screen shot (1).png"))).toBe("![Screen shot (1)](img/Screen%20shot%20%281%29.png)");
    expect(imageLink("C:/w/notes/a.md", "C:/w/pics/cat.jpg")).toBe("![cat](C:/w/pics/cat.jpg)");
    expect(imageLink("", "D:/x/y.png")).toBe("![y](D:/x/y.png)");
  });
  test("the picture's markdown goes in at the caret and is written back as it was", () => {
    const e = editorWith("Before");
    expect(applyImage(e, "![cat](img/cat.png)")).toBe(true);
    expect(md(e)).toBe("![cat](img/cat.png)Before");
  });
});
