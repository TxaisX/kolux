// T-656: the page script's request wrapper (browser.rs CHORD_SCRIPT, the T-242 section) is run against a stub page, so what
// ships is what is tested: extra headers and credentials set for site A go with fetch and XHR requests to A, never to B.
import { describe, expect, it } from "vitest";
import source from "../../src-tauri/src/browser.rs?raw";
const from = source.indexOf("  const E = { intercept: null");
const to = source.indexOf("  window.__kxLog = ", from);
const section = source.slice(from, to);

const A = "http://127.0.0.1:5000";
const realUrl = Object.getOwnPropertyDescriptor(Request.prototype, "url")!.get!;
const B = "http://127.0.0.1:5001";

/** Loads the section on a stub page at `page` (its base address `base`, as a `<base>` tag sets it), hands it `state`;
 * returns what each request carried. */
function load(page: string, state: Record<string, unknown>, base = page) {
  const sent: { kind: string; url: string; headers: Record<string, string> }[] = [];
  // The engine resolves a request's address against the document's base address, as these stubs do.
  const fetch = (input: string | Request, init?: RequestInit) => {
    const url = input instanceof Request ? realUrl.call(input) : new URL(String(input), base).href;
    sent.push({ kind: "fetch", url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return Promise.resolve({ status: 200 });
  };
  class XHR {
    headers: Record<string, string> = {};
    status = 200;
    url = "";
    open(_m: string, u: string) { this.url = new URL(String(u), base).href; }
    setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
    addEventListener() {}
    dispatchEvent() { return true; }
    send() { sent.push({ kind: "xhr", url: this.url, headers: this.headers }); }
  }
  const win: Record<string, unknown> = { fetch, matchMedia: () => ({}), alert() {}, confirm() {}, prompt() {} };
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  class Nav {}
  class Node {
    get baseURI() { return base; }
  }
  const document = Object.assign(new Node(), { documentElement: { style: {} } });
  const loc = new URL(page);
  new Function("window", "XMLHttpRequest", "Navigator", "navigator", "location", "console", "addEventListener", "dispatchEvent", "document", "Node", section)(
    win, XHR, Nav, {}, { href: loc.href, origin: loc.origin }, quiet, () => {}, () => {}, document, Node,
  );
  const emu = (s: unknown) => (win.__kxEmu as (s: unknown) => void)(s);
  emu(state);
  const xhr = (url: unknown) => { const x = new XHR(); (x.open as (m: string, u: unknown) => void)("GET", url); x.send(); return x; };
  return { sent, fetch: win.fetch as (u: unknown, i?: RequestInit) => Promise<unknown>, xhr, XHR, win, emu };
}

const set = { headers: { "X-Token": "secret-token" }, headersOrigin: A, auth: "Basic bWU6c2VjcmV0", authOrigin: A };

describe("T-656: extra headers and credentials stay on their own site", () => {
  it("the whole page script compiles (a clash with an earlier name would drop all of it)", () => {
    const start = source.indexOf('pub const CHORD_SCRIPT: &str = r#"') + 'pub const CHORD_SCRIPT: &str = r#"'.length;
    expect(() => new Function(source.slice(start, source.indexOf('"#;', start)))).not.toThrow();
  });

  it("a page on A sends them with fetch and XHR to A, and not to B", async () => {
    const p = load(`${A}/form`, set);
    await p.fetch("/api");
    await p.fetch(`${B}/collect`);
    p.xhr(`${A}/api`);
    p.xhr(`${B}/collect`);
    const [fa, fb, xa, xb] = p.sent;
    expect(fa.headers["x-token"]).toBe("secret-token");
    expect(fa.headers.authorization).toBe("Basic bWU6c2VjcmV0");
    expect(xa.headers["x-token"]).toBe("secret-token");
    expect(xa.headers.authorization).toBe("Basic bWU6c2VjcmV0");
    for (const r of [fb, xb]) {
      expect(r.url.startsWith(B)).toBe(true);
      expect(r.headers["x-token"]).toBeUndefined();
      expect(r.headers.authorization).toBeUndefined();
    }
  });

  it("a page on B sends nothing, even to A, and even if the state reached it", async () => {
    const p = load(`${B}/`, set);
    await p.fetch(`${A}/api`);
    await p.fetch("/same");
    p.xhr(`${A}/api`);
    for (const r of p.sent) expect(r.headers).toEqual({});
  });

  it("a page that swaps the header setters after load never sees the values", async () => {
    const p = load(`${A}/`, set);
    const seen: string[] = [];
    const realSet = Headers.prototype.set;
    Headers.prototype.set = function (k: string, v: string) { seen.push(v); return realSet.call(this, k, v); };
    p.XHR.prototype.setRequestHeader = (_k: string, v: string) => void seen.push(v);
    try {
      await p.fetch("/api");
      p.xhr("/api");
    } finally {
      Headers.prototype.set = realSet;
    }
    expect(seen).toEqual([]);
    expect(p.sent[0].headers["x-token"]).toBe("secret-token");
    expect(p.sent[1].headers["x-token"]).toBe("secret-token");
  });

  it("a <base> tag pointing at B sends A's relative requests to B without the values", async () => {
    const p = load(`${A}/form`, set, `${B}/`);
    await p.fetch("/api");
    p.xhr("/api");
    for (const r of p.sent) {
      expect(r.url.startsWith(B)).toBe(true);
      expect(r.headers).toEqual({});
    }
  });

  it("an address that reads as A once and B the next time goes to A, the address that was checked", async () => {
    const shifty = () => { let n = 0; return { toString: () => (n++ === 0 ? `${A}/api` : `${B}/collect`) }; };
    const p = load(`${A}/`, set);
    await p.fetch(shifty());
    p.xhr(shifty());
    for (const r of p.sent) {
      expect(r.url).toBe(`${A}/api`);
      expect(r.headers["x-token"]).toBe("secret-token");
    }
  });

  it("a Request object is judged by its real address, not a getter the page overrides", async () => {
    class Lying extends Request { get url() { return `${A}/api`; } }
    const p = load(`${A}/`, set);
    await p.fetch(new Lying(`${B}/collect`));
    expect(p.sent[0].url).toBe(`${B}/collect`);
    expect(p.sent[0].headers).toEqual({});
  });

  it("a state naming another site holds nothing on this page, and the page cannot replace the hand-in", async () => {
    const p = load(`${B}/`, {});
    p.emu(set);
    await p.fetch("/same");
    expect(p.sent[0].headers).toEqual({});
    expect(() => { p.win.__kxEmu = () => {}; }).toThrow();
    expect(Object.getOwnPropertyDescriptor(p.win, "__kxEmu")?.configurable).toBe(false);
  });

  it("setters a page plants on Object.prototype never see the values, on another site or on their own", async () => {
    const seen: unknown[] = [];
    const names = ["headers", "auth", "headersOrigin", "authOrigin"];
    const b = load(`${B}/`, {});
    const a = load(`${A}/`, {});
    for (const k of names) Object.defineProperty(Object.prototype, k, { set(v) { seen.push(v); }, get() { return undefined; }, configurable: true });
    try {
      b.emu(set);
      a.emu(set);
      await a.fetch("/api", { method: "GET" });
    } finally {
      for (const k of names) delete (Object.prototype as Record<string, unknown>)[k];
    }
    expect(seen).toEqual([]);
    expect(a.sent[0].headers["x-token"]).toBe("secret-token");
  });

  it("an emptied set sends nothing; headers with no site recorded go nowhere", async () => {
    const p = load(`${A}/`, { headers: {}, headersOrigin: A });
    await p.fetch("/api");
    const q = load(`${A}/`, { headers: { "X-Token": "t" } });
    await q.fetch("/api");
    expect(p.sent[0].headers).toEqual({});
    expect(q.sent[0].headers).toEqual({});
  });
});
