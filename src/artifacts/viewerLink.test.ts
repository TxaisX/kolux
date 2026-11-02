import { afterEach, describe, expect, it, vi } from "vitest";

// DT-C77. A page in the viewer frame runs its own script, and the frame's sandbox lets it post to the
// app (link_script needs that), so a koluxOpen message proves nothing about the user: the page can
// post on load, in a loop, or after one real click. A message therefore never opens the browser. It
// only raises Kolux's own question ("Open example.com?"), and the browser opens when the user clicks
// Open in Kolux. One question at a time: the first ask wins, later asks are ignored until it is
// answered, and Open stays disabled for 1 s after the question appears (worker decision, 2f).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const invoke = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LINK_BACKOFF, LINK_OPEN_DELAY_MS, LinkAskBar, displayText, linkAsk, linkPrompt, type LinkAsk } from "./ArtifactsPage";

const frame = { name: "artifact-a" } as unknown as Window;
const msg = (over: Partial<{ data: unknown; source: unknown }>) => ({ data: { koluxOpen: "https://example.com/path?q=1" }, source: frame, ...over }) as MessageEvent;

afterEach(() => invoke.mockClear());

/** A clock the tests move by hand, so the 1 s input-protection delay is exact. */
function clock() {
  let t = 5000;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
}
const open = (url: string) => invoke("open_external", { url });

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
    const p = linkPrompt(open, (a) => shown.push(a), clock().now);
    for (let i = 0; i < 20; i++) p.ask(msg({ data: { koluxOpen: `https://example.com/${i}` } }), frame);
    expect(invoke).not.toHaveBeenCalled();
    // First ask wins: the one on screen is the first, and it was shown once.
    expect(shown).toEqual([{ url: "https://example.com/0", host: "example.com" }]);
  });

  it("first ask wins: a second ask while one is pending changes nothing, so Open opens what was shown", async () => {
    const c = clock();
    const p = linkPrompt(open, () => {}, c.now);
    p.ask(msg({ data: { koluxOpen: "https://first.example/" } }), frame);
    // A page that swaps the ask right before the user's click (on mouseleave or blur) gets nowhere.
    c.tick(500);
    p.ask(msg({ data: { koluxOpen: "https://second.example/" } }), frame);
    c.tick(600);
    p.ask(msg({ data: { koluxOpen: "https://third.example/" } }), frame);
    await p.accept();
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://first.example/" }]]);
  });

  it("after Open or Cancel a new ask may come", async () => {
    const c = clock();
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt(open, (a) => shown.push(a), c.now);
    p.ask(msg({ data: { koluxOpen: "https://a.example/" } }), frame);
    p.cancel();
    p.ask(msg({ data: { koluxOpen: "https://b.example/" } }), frame);
    c.tick(LINK_OPEN_DELAY_MS);
    await p.accept();
    p.ask(msg({ data: { koluxOpen: "https://c.example/" } }), frame);
    c.tick(LINK_OPEN_DELAY_MS);
    await p.accept();
    expect(invoke.mock.calls.map((x) => (x[1] as { url: string }).url)).toEqual(["https://b.example/", "https://c.example/"]);
  });

  it("Open clicked before the 1 s delay opens nothing and leaves the question up; after it, Open works once", async () => {
    const c = clock();
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt(open, (a) => shown.push(a), c.now);
    p.ask(msg({}), frame);
    expect(p.ready()).toBe(false);
    await p.accept();
    c.tick(LINK_OPEN_DELAY_MS - 1);
    await p.accept();
    expect(invoke).not.toHaveBeenCalled();
    expect(shown[shown.length - 1]).not.toBeNull();
    c.tick(1);
    expect(p.ready()).toBe(true);
    await p.accept();
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://example.com/path?q=1" }]]);
    expect(shown[shown.length - 1]).toBeNull();
  });

  it("Cancel opens nothing, whenever it is clicked", async () => {
    const c = clock();
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt(open, (a) => shown.push(a), c.now);
    p.ask(msg({}), frame);
    c.tick(5000);
    p.cancel();
    await p.accept();
    expect(invoke).not.toHaveBeenCalled();
    expect(shown[shown.length - 1]).toBeNull();
  });

  it("a message from another frame leaves the pending question alone", async () => {
    const c = clock();
    const p = linkPrompt(open, () => {}, c.now);
    p.ask(msg({}), frame);
    p.ask(msg({ source: {}, data: { koluxOpen: "https://evil.example/" } }), frame);
    c.tick(LINK_OPEN_DELAY_MS);
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://example.com/path?q=1" }]]);
  });

  it("a malformed percent-escape in a mailto address asks nothing and does not throw", () => {
    expect(linkAsk(msg({ data: { koluxOpen: "mailto:%E0%A4%A@example.com" } }), frame)).toBeNull();
  });

  it("a mailto with a query shows the whole address, not the query", () => {
    expect(linkAsk(msg({ data: { koluxOpen: "mailto:a@example.com,b@example.com?body=hi&attach=C:/x" } }), frame)?.host).toBe("a@example.com,b@example.com");
  });

  // T-624 round 5, S6.
  it("a mailto address is shown without control or bidi characters, and no longer than 80", () => {
    const rlo = "\u202E", lri = "\u2066", zw = "\u200B", nul = "%00", lf = "%0A";
    const shownOf = (addr: string) => linkAsk(msg({ data: { koluxOpen: `mailto:${addr}` } }), frame)?.host;
    expect(shownOf(`a@example.com${rlo}gpj.exe`)).toBe("a@example.comgpj.exe");
    expect(shownOf(`${lri}x${zw}@example.com${lf}${nul}`)).toBe("x@example.com");
    expect(shownOf(`${"a".repeat(300)}@example.com`)?.length).toBe(80);
    expect(shownOf(`${"a".repeat(300)}@example.com`)?.endsWith("…")).toBe(true);
    // An address that is nothing but invisible characters asks nothing.
    expect(shownOf(`${rlo}${zw}`)).toBeUndefined();
    expect(displayText("a\u200Eb\u2069c\u202Ad")).toBe("abcd");
    expect(displayText(" ok ")).toBe("ok");
  });

  it("after three Cancels in a row the same entry is not asked again until it is chosen again", async () => {
    const c = clock();
    const shown: (LinkAsk | null)[] = [];
    const p = linkPrompt(open, (a) => shown.push(a), c.now);
    for (let i = 0; i < LINK_BACKOFF; i++) {
      p.ask(msg({ data: { koluxOpen: `https://spam.example/${i}` } }), frame);
      p.cancel();
    }
    const before = shown.length;
    p.ask(msg({}), frame);
    c.tick(5 * LINK_OPEN_DELAY_MS);
    expect(p.ready()).toBe(false);
    await p.accept();
    expect(shown.length).toBe(before);
    expect(invoke).not.toHaveBeenCalled();
    // Choosing the entry (again) is a new conversation.
    p.reset();
    p.ask(msg({}), frame);
    c.tick(LINK_OPEN_DELAY_MS);
    await p.accept();
    expect(invoke.mock.calls).toEqual([["open_external", { url: "https://example.com/path?q=1" }]]);
  });

  it("an Open (or two Cancels and an Open) clears the count; fewer than three Cancels never silence a page", async () => {
    const c = clock();
    const p = linkPrompt(open, () => {}, c.now);
    for (let round = 0; round < 3; round++) {
      p.ask(msg({}), frame);
      p.cancel();
      p.ask(msg({}), frame);
      p.cancel();
      p.ask(msg({}), frame);
      c.tick(LINK_OPEN_DELAY_MS);
      await p.accept();
    }
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("a click, key or focus change while Open is disabled restarts the delay", async () => {
    const c = clock();
    const p = linkPrompt(open, () => {}, c.now);
    p.ask(msg({}), frame);
    c.tick(LINK_OPEN_DELAY_MS - 100);
    p.touch(); // input that was meant for the page
    c.tick(LINK_OPEN_DELAY_MS - 100);
    expect(p.ready()).toBe(false);
    await p.accept();
    expect(invoke).not.toHaveBeenCalled();
    p.touch();
    c.tick(LINK_OPEN_DELAY_MS);
    expect(p.ready()).toBe(true);
    p.touch(); // once Open is ready a touch changes nothing
    expect(p.ready()).toBe(true);
    await p.accept();
    expect(invoke).toHaveBeenCalledTimes(1);
    p.touch(); // nothing pending: nothing happens
  });
});

describe("the question strip (M1)", () => {
  const ask: LinkAsk = { url: "https://example.com/", host: "example.com" };
  const html = (ready: boolean) => renderToStaticMarkup(createElement(LinkAskBar, { ask, ready, onOpen: () => {}, onCancel: () => {} }));

  it("Open is not focused on mount: a keystroke typed into the page cannot land on it", () => {
    expect(html(true).toLowerCase()).not.toContain("autofocus");
  });

  it("Open is disabled until the delay has passed; Cancel never is", () => {
    const wait = html(false);
    expect(wait).toMatch(/<button[^>]*disabled=""[^>]*>Open<\/button>/);
    expect(wait).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
    expect(html(true)).not.toContain("disabled");
  });

  it("the strip is a status line, not a dialog that asks for the focus", () => {
    const out = html(true);
    expect(out).toContain('role="status"');
    expect(out).not.toContain("alertdialog");
  });

  it("the strip sits in normal layout above the frame, never positioned over it", () => {
    const rule = css.split(/\r?\n/).find((l) => l.startsWith(".art-ask {")) ?? "";
    expect(rule).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(css).toMatch(/\.art-view\s*\{[^}]*flex-direction:\s*column/);
  });
});
