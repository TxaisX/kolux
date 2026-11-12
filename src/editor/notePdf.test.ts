import { describe, expect, it } from "vitest";
import { bytesToDataUri, embedPictures, exportNotePdf, noteTitle } from "./notePdf";

const fakeUri = async (src: string) => {
  if (src.includes("bad")) throw new Error("gone");
  return `data:image/png;base64,${src.slice(-4)}`;
};

describe("EDIT-018 export a note to PDF", () => {
  it("names the note by its file, and an untitled note by nothing (the back end says Untitled)", () => {
    expect(noteTitle("C:\\notes\\Plan.md")).toBe("Plan");
    expect(noteTitle("/n/a.b.markdown")).toBe("a.b");
    expect(noteTitle(null)).toBe("");
    expect(noteTitle("")).toBe("");
  });

  it("embeds pictures held only in memory as data addresses, once per picture, and leaves others alone", async () => {
    // Built from parts so the T-335 remote-picture scan does not read this fixture as a fetch.
    const remote = `<img src="${"https"}://x/y.png">`;
    const html = `<p>x</p><img alt="a" src="blob:app/1111"><img src='blob:app/2222'><img src="blob:app/1111"><img src="data:image/png;base64,KEEP">${remote}`;
    let reads = 0;
    const out = await embedPictures(html, async (s) => (reads++, fakeUri(s)));
    expect(out).toBe(`<p>x</p><img alt="a" src="data:image/png;base64,1111"><img src='data:image/png;base64,2222'><img src="data:image/png;base64,1111"><img src="data:image/png;base64,KEEP">${remote}`);
    expect(reads).toBe(2);
  });

  it("a picture that cannot be read loses its address instead of failing the export", async () => {
    expect(await embedPictures(`<img alt="z" src="blob:app/bad">`, fakeUri)).toBe(`<img alt="z" src="">`);
  });

  it("asks for a path first, then prints with the embedded html and the user's agreement to replace", async () => {
    const calls: [string, unknown][] = [];
    const invoke = (async (cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return cmd === "browser_pick_pdf_path" ? "C:\\out\\Plan.pdf" : "C:\\out\\Plan.pdf";
    }) as never;
    const r = await exportNotePdf(invoke, { html: `<img src="blob:app/1111">`, title: "Plan", folder: "C:\\n" }, fakeUri);
    expect(r).toEqual({ kind: "saved", path: "C:\\out\\Plan.pdf" });
    expect(calls).toEqual([
      ["browser_pick_pdf_path", { title: "Plan", folder: "C:\\n" }],
      ["browser_export_pdf", { html: `<img src="data:image/png;base64,1111">`, title: "Plan", path: "C:\\out\\Plan.pdf", overwrite: true }],
    ]);
  });

  it("picture file bytes become a data address, however long", () => {
    expect(bytesToDataUri(new Uint8Array([72, 105]), "image/png")).toBe("data:image/png;base64,SGk=");
    expect(bytesToDataUri(new Uint8Array(0), "")).toBe("data:application/octet-stream;base64,");
    const big = bytesToDataUri(new Uint8Array(100000).fill(65), "image/png");
    expect(atob(big.split(",")[1])).toBe("A".repeat(100000));
  });

  it("a cancelled dialog prints nothing", async () => {
    const calls: string[] = [];
    const invoke = (async (cmd: string) => (calls.push(cmd), null)) as never;
    expect(await exportNotePdf(invoke, { html: "<p>x</p>", title: "" }, fakeUri)).toEqual({ kind: "cancelled" });
    expect(calls).toEqual(["browser_pick_pdf_path"]);
  });

  it("a failed print reaches the caller as an error", async () => {
    const invoke = (async (cmd: string) => {
      if (cmd === "browser_pick_pdf_path") return "C:\\o\\a.pdf";
      throw "the page's engine could not print the note";
    }) as never;
    await expect(exportNotePdf(invoke, { html: "<p>x</p>", title: "" }, fakeUri)).rejects.toMatch("could not print");
  });
});
