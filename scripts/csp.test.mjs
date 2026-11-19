// T-500: the main web view runs under a content security policy (council r1-security finding 4:
// `csp: null`). The release policy lives in src-tauri/tauri.conf.json, applied by Tauri when it
// serves the app; in development Vite serves the app, so vite.config.ts sends the same policy as
// a header (plus inline scripts and the reload socket, which the dev server itself needs).
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const release = conf.app.security.csp;

test("T-500: the release build's main web view has a policy that keeps pages to the app's own files", () => {
  expect(typeof release).toBe("string");
  expect(release).toContain("default-src 'self'");
  expect(release).toContain("script-src 'self'");
  expect(release).toContain("object-src 'none'");
  expect(release).not.toContain("unsafe-eval");
  // No frame or media source of its own: both fall back to default-src 'self'.
  expect(release).not.toMatch(/\b(?:frame|media)-src\b/);
});

// T-590 (L1-tauri.1, R07-browser.1): a web page in a browser tab could load Kolux's own screen in a
// hidden frame, which on Windows gets the app's commands. The policy now forbids any page to frame it.
// It only counts as a header: Tauri sends the release policy as one, and so does the dev server.
test("T-590: no web page may put Kolux in a frame, in a release build or on the dev server", () => {
  expect(release.split(";").map((r) => r.trim())).toContain("frame-ancestors 'none'");
  const dev = /const DEV_CSP = "([^"]+)"/.exec(vite)?.[1] ?? "";
  expect(dev.split(";").map((r) => r.trim())).toContain("frame-ancestors 'none'");
});

test("T-500: the dev server sends the same policy, so the policy is proven while developing", () => {
  const dev = /"Content-Security-Policy": DEV_CSP/.test(vite) && /const DEV_CSP = "([^"]+)"/.exec(vite)?.[1];
  expect(dev).toBeTruthy();
  // The dev policy is the release policy with the dev server's own needs added, nothing removed.
  for (const rule of release.split(";").map((r) => r.trim()).filter(Boolean)) {
    const [name] = rule.split(" ");
    const devRule = String(dev).split(";").map((r) => r.trim()).find((r) => r.startsWith(name + " "));
    expect(devRule, name).toBeTruthy();
    for (const src of rule.split(" ").slice(1)) expect(devRule, `${name} keeps ${src}`).toContain(src);
  }
});
