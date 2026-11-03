import { describe, expect, it } from "vitest";
import { extText, focusAfterRemove, group, matches, section, sizeText, view, viewerLink, viewerUrl } from "./ArtifactsPage";
import type { Artifact } from "./ArtifactsPage";

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

  it("shows a page or text in the frame, an image as a picture, and the rest in its own app", () => {
    expect(view(undefined)).toBe("frame");
    expect(view("page")).toBe("frame");
    expect(view("text")).toBe("frame");
    expect(view("image")).toBe("image");
    expect(view("pdf")).toBe("app");
    expect(view("other")).toBe("app");
    expect(extText("shot.png")).toBe("PNG");
    expect(extText("no-extension")).toBe("");
  });
});

describe("focus after a removal", () => {
  it("goes to the next row, else the previous, else nowhere", () => {
    expect(focusAfterRemove(["a", "b", "c"], "b")).toBe("c");
    expect(focusAfterRemove(["a", "b", "c"], "c")).toBe("b");
    expect(focusAfterRemove(["a"], "a")).toBeNull();
    expect(focusAfterRemove(["a", "b"], "zz")).toBeNull();
  });
});

describe("a link the viewer asks to open (T-682)", () => {
  const frame = {};
  const msg = (source: unknown, data: unknown) => ({ source, data });
  it("opens a link clicked inside the viewer's own frame", () => {
    expect(viewerLink(msg(frame, { koluxOpen: "https://example.com/" }), frame, { isActive: true }, true)).toBe("https://example.com/");
  });
  it("ignores a page script that posts with no click, such as on load", () => {
    expect(viewerLink(msg(frame, { koluxOpen: "https://example.com/" }), frame, { isActive: false }, true)).toBeNull();
  });
  it("ignores a page that posts while focus is outside the frame, such as right after the row click that opened it", () => {
    expect(viewerLink(msg(frame, { koluxOpen: "https://example.com/" }), frame, { isActive: true }, false)).toBeNull();
  });
  it("opens nothing on an engine that cannot say whether a click happened", () => {
    expect(viewerLink(msg(frame, { koluxOpen: "https://example.com/" }), frame, undefined, true)).toBeNull();
  });
  it("ignores other windows, a missing frame and messages that are not a link", () => {
    expect(viewerLink(msg({}, { koluxOpen: "https://example.com/" }), frame, { isActive: true }, true)).toBeNull();
    expect(viewerLink(msg(undefined, { koluxOpen: "https://example.com/" }), undefined, { isActive: true }, true)).toBeNull();
    expect(viewerLink(msg(frame, { koluxOpen: 7 }), frame, { isActive: true }, true)).toBeNull();
    expect(viewerLink(msg(frame, null), frame, { isActive: true }, true)).toBeNull();
  });
});
