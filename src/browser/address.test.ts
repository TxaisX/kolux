// BROW-003: what the address bar makes of typed text.
import { expect, test } from "vitest";
import { resolveAddress } from "./address";

const url = (t: string, e?: Parameters<typeof resolveAddress>[1]) => {
  const r = resolveAddress(t, e);
  if ("error" in r) throw new Error(r.error);
  return r.url;
};

test("BROW-003: words search, domains open over HTTPS, local hosts over HTTP", () => {
  expect(url("rust ownership")).toBe("https://www.google.com/search?q=rust%20ownership");
  expect(url("example.com")).toBe("https://example.com/");
  expect(url("example.com:8080/x?y=1")).toBe("https://example.com:8080/x?y=1");
  expect(url("localhost:3000")).toBe("http://localhost:3000/");
  expect(url("127.0.0.1/api")).toBe("http://127.0.0.1/api");
  expect(url("http://plain.test/")).toBe("http://plain.test/");
});

test("BROW-003: queries are escaped for the engine, and each engine has its own search address", () => {
  expect(url("café ☕ & co")).toBe("https://www.google.com/search?q=caf%C3%A9%20%E2%98%95%20%26%20co");
  expect(url("rust ownership", "duckduckgo")).toBe("https://duckduckgo.com/?q=rust%20ownership");
  expect(url("rust ownership", "bing")).toBe("https://www.bing.com/search?q=rust%20ownership");
  expect(url("rust ownership", "kagi")).toBe("https://kagi.com/search?q=rust%20ownership");
});

test("BROW-003: the empty bar is the blank page", () => {
  expect(url("")).toBe("about:blank");
  expect(url("  about:blank ")).toBe("about:blank");
});

test("T-500: file paths and file addresses are refused; a browser tab is for the web only", () => {
  // evidence/T-500-isolation.txt: a tab's page carries Tauri's IPC script; local files stay out.
  const refused = { error: "invalid address: a browser tab opens web pages only (http or https)" };
  expect(resolveAddress("G:\\My Docs\\a #1.html")).toEqual(refused);
  expect(resolveAddress("/srv/www/index.html")).toEqual(refused);
  expect(resolveAddress("file:///G:/x.html")).toEqual(refused);
});

test("BROW-003: any other scheme is refused as an invalid address", () => {
  expect(resolveAddress("javascript:alert(1)")).toEqual({ error: "invalid address: javascript: is not a web or blank address" });
  expect(resolveAddress("mailto:someone@example.com")).toMatchObject({ error: expect.stringContaining("mailto:") });
  expect(resolveAddress("https://exa mple.com/")).toMatchObject({ error: expect.stringContaining("invalid address") });
});

test("BROW-003: a typed IP address or a .localhost name is a local dev server and opens over HTTP, as browsers do", () => {
  expect(url("192.168.1.20:5173")).toBe("http://192.168.1.20:5173/");
  expect(url("0.0.0.0:8000/admin")).toBe("http://0.0.0.0:8000/admin");
  expect(url("10.0.0.5")).toBe("http://10.0.0.5/");
  expect(url("app.localhost:3000")).toBe("http://app.localhost:3000/");
  expect(url("1.2.3.4.example.com")).toBe("https://1.2.3.4.example.com/");
});
