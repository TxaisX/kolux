import { afterEach, describe, expect, it, vi } from "vitest";

// DT-C77. A page in the viewer frame runs its own script, and the frame's sandbox lets it post to the
// app (link_script needs that), so a koluxOpen message proves nothing about the user: the page can
// post on load, in a loop, or after one real click. A message therefore never opens the browser. It
// only raises Kolux's own question ("Open example.com?"), and the browser opens when the user clicks
// Open in Kolux. One question at a time: a newer request replaces the older, nothing queues.
const invoke = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { linkAsk, linkPrompt, type LinkAsk } from "./ArtifactsPage";

const frame = { name: "artifact-a" } as unknown as Window;
const msg = (over: Partial<{ data: unknown; source: unknown }>) => ({ data: { koluxOpen: "https://example.com/path?q=1" }, source: frame, ...over }) as MessageEvent;

afterEach(() => invoke.mockClear());

describe("a link asked for by the viewer (SKILL-036, DT-C77)", () => {
  it("names the destination host, and only for our own frame", () => {
    expect(linkAsk(msg({}), frame)).toEqual({ url: "https://example.com/path?q=1", host: "example.com" });
    expect(linkAsk(msg({ data: { koluxOpen: "https://Sub.Example.com:8443/x" } }), frame)?.host).toBe("sub.example.com:8443");
    expect(linkAsk(msg({ data: { koluxOpen: "mailto:someone@example.com" } }), frame)).toEqual({ url: "mailto:someone@example.com", host: "someone@example.com" });
    expect(linkAsk(msg({ source: {} }), frame)).toBeNull();
    expect(linkAsk(msg({}), null)).toBeNull();
    expect(linkAsk(msg({ data: { koluxOpen: 5 } }), frame)).toBeNull();
    expect(linkAsk(msg({ data: null }), frame)).toBeNull();
    // Not a web or mail link: no question is worth asking.
    expect(linkAsk(msg({ data: { koluxOpen: "file:///C:/Windows/notepad.exe" } }), frame)).toBeNull();
    expect(linkAsk(msg({ data: { koluxOpen: "javascript:alert(1)" } }), frame)).toBeNull();
    expect(linkAsk(msg({ data: { koluxOpen: "not a url" } }), frame)).toBeNull();
  });

  it("a message never opens the browser, however many a page posts", () => {
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt((url) => invoke("open_external", { url }), (a) => shown.push(a));
    for (let i = 0; i < 20; i++) p.ask(msg({ data: { koluxOpen: `https://example.com/${i}` } }), frame);
    expect(invoke).not.toHaveBeenCalled();
    expect(shown[shown.length - 1]).toEqual({ url: "https://example.com/19", host: "example.com" });
  });

  it("only one question is pending: a new request replaces the old one, with no queue", async () => {
    const p = linkPrompt((url) => invoke("open_external", { url }), () => {});
    p.ask(msg({ data: { koluxOpen: "https://first.example/" } }), frame);
    p.ask(msg({ data: { koluxOpen: "https://second.example/" } }), frame);
    await p.accept();
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://second.example/" }]]);
  });

  it("clicking Open opens the link once; Cancel opens nothing", async () => {
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt((url) => invoke("open_external", { url }), (a) => shown.push(a));
    p.ask(msg({}), frame);
    await p.accept();
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://example.com/path?q=1" }]]);
    expect(shown[shown.length - 1]).toBeNull();
    invoke.mockClear();
    p.ask(msg({}), frame);
    p.cancel();
    await p.accept();
    expect(invoke).not.toHaveBeenCalled();
    expect(shown[shown.length - 1]).toBeNull();
  });

  it("a message from another frame leaves the pending question alone", async () => {
    const p = linkPrompt((url) => invoke("open_external", { url }), () => {});
    p.ask(msg({}), frame);
    p.ask(msg({ source: {}, data: { koluxOpen: "https://evil.example/" } }), frame);
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://example.com/path?q=1" }]]);
  });
});
