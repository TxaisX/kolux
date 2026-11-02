import { describe, expect, it, vi } from "vitest";
import { extText, group, matches, newlySkipped, section, sizeText, ticker, view, viewerUrl } from "./ArtifactsPage";
import type { Artifact } from "./ArtifactsPage";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const pageSource = nodeFs.readFileSync(new URL("./ArtifactsPage.tsx", import.meta.url), "utf8");

const art = (over: Partial<Artifact>): Artifact => ({
  id: "a", title: "t", source: "claude", origin: "G:\\Dev\\minecraft\\shot.png", kind: "image",
  project: null, session: null, added: 0, size: 1, page: "shot.png", state: "ok", stored: true, ...over,
});

describe("Artifacts library (SKILL-036)", () => {
  it("matches titles holding every typed word, in any case and order", () => {
    expect(matches("Quarterly Sales Report", "sales quarterly")).toBe(true);
    expect(matches("Quarterly Sales Report", "SALES")).toBe(true);
    expect(matches("Quarterly Sales Report", "sales chart")).toBe(false);
    expect(matches("Anything", "   ")).toBe(true);
  });

  it("writes sizes as B, KB or MB with one decimal", () => {
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(1536)).toBe("1.5 KB");
    expect(sizeText(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("points the viewer at the entry's stored page on the app's scheme", () => {
    expect(viewerUrl({ id: "ab12", page: "my page.html" }, true)).toBe("http://kolux-artifact.localhost/ab12/my%20page.html");
    expect(viewerUrl({ id: "ab12", page: "sub/index.html" }, false)).toBe("kolux-artifact://localhost/ab12/sub/index.html");
  });

  it("cuts the list into one section per project, the newest project first", () => {
    const list = [
      art({ id: "1", project: "minecraft", added: 30 }),
      art({ id: "2", project: "Txais Brain", added: 20 }),
      art({ id: "3", project: "minecraft", added: 10 }),
      art({ id: "4", source: "hand", added: 5 }),
    ];
    const got = group(list);
    expect(got.map((s) => s.project)).toEqual(["minecraft", "Txais Brain", "Added by hand"]);
    expect(got[0].items.map((a) => a.id)).toEqual(["1", "3"]);
    expect(section(art({ source: "hand" }))).toBe("Added by hand");
    expect(section(art({ project: "minecraft" }))).toBe("minecraft");
  });

  it("shows a page or text in the frame, an image as a picture, media as a player, and a PDF or the rest in its own app", () => {
    expect(view(undefined)).toBe("frame");
    expect(view("page")).toBe("frame");
    expect(view("text")).toBe("frame");
    expect(view("image")).toBe("image");
    expect(view("video")).toBe("video");
    expect(view("audio")).toBe("audio");
    // A PDF is not shown in a frame: a sandboxed frame cannot run the PDF viewer, and an unsandboxed
    // one would follow a link inside the PDF in-app, so it opens in its own app like a document.
    expect(view("pdf")).toBe("app");
    expect(view("other")).toBe("app");
    expect(extText("shot.png")).toBe("PNG");
    expect(extText("clip.mp4")).toBe("MP4");
    expect(extText("no-extension")).toBe("");
  });

  it("every viewer frame on the page is sandboxed", () => {
    const frames = pageSource.match(/<iframe[\s\S]*?>/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(f, f).toMatch(/\ssandbox=/);
  });

  it("a scan tick that finds the last scan still running does nothing", async () => {
    let done!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (done = r)));
    const tick = ticker(run);
    tick();
    tick();
    expect(run).toHaveBeenCalledTimes(1);
    done();
    await Promise.resolve();
    await Promise.resolve();
    tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a file the scan could not keep is told once, not every three seconds", () => {
    const told = new Set<string>();
    expect(newlySkipped(["clip.mkv is larger than 100 MB"], told)).toEqual(["clip.mkv is larger than 100 MB"]);
    expect(newlySkipped(["clip.mkv is larger than 100 MB"], told)).toEqual([]);
    expect(newlySkipped(["clip.mkv is larger than 100 MB", "could not read x.bin: denied"], told)).toEqual(["could not read x.bin: denied"]);
    expect(newlySkipped([], told)).toEqual([]);
  });

  // T-624 round 5.
  it("Open on a file that opens in its own app hands over the library copy, not the workspace file", () => {
    const at = pageSource.indexOf("const openFile");
    expect(at).toBeGreaterThan(0);
    const body = pageSource.slice(at, pageSource.indexOf("\n", at));
    expect(body).toContain('invoke("artifact_open", { id: a.id })');
    expect(body).not.toMatch(/origin|open_path/);
    expect(pageSource).not.toContain('invoke("open_path"');
  });

  it("a click, a key or the focus leaving restarts the Open delay while Open is disabled", () => {
    for (const ev of ["pointerdown", "keydown", "blur"]) expect(pageSource, ev).toContain(`"${ev}"`);
    expect(pageSource).toContain("addEventListener(ev, again, true)");
    expect(pageSource).toContain("prompt.current?.touch()");
  });

  it("choosing an entry, even the one already shown, starts its link refusals over", () => {
    const at = pageSource.indexOf("const choose = ");
    expect(at).toBeGreaterThan(0);
    expect(pageSource.slice(at, at + 160)).toContain("prompt.current?.reset()");
    expect(pageSource).not.toMatch(/onClick=\{\(\) => (void )?setSelected\(/);
  });
});
