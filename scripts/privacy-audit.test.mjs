// APP-070: a network client anywhere in the shipped source would be a connection the privacy
// statement (src/settings/privacy.ts) does not name.
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|rs|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};

// \s* on both sides of :: so `TcpStream :: connect` and a line break inside it are caught too.
const TCP_CONNECT = /TcpStream\s*::\s*connect/;
const TCP_CONNECT_ALL = new RegExp(TCP_CONNECT.source, "g");
// http.request (Node) and urllib.request (Python) cover a script Kolux embeds for a vendor's extension or plugin.
const CLIENTS = [/\bfetch\(\s*["'`]https?:/, /XMLHttpRequest/, /sendBeacon/, /new WebSocket\(/, /\breqwest::/, /tauri_plugin_updater/, /\bureq::/, /\bhyper::/, /\bhttp\.request\(/, /\burllib\.request\b/, TCP_CONNECT];
const ALLOWED = {
  "src-tauri/src/artifacts.rs": [/\breqwest::/], // the script CDNs, when saving an artifact for offline use
  "src-tauri/src/browser.rs": [/\breqwest::/], // the open page's own site icon (APP-070: sites the user opens in the browser pane)
  "src-tauri/src/update.rs": [/tauri_plugin_updater/], // GitHub Releases
  "src-tauri/src/lib.rs": [/tauri_plugin_updater/],
  "src-tauri/src/cli/mod.rs": [TCP_CONNECT], // kolux-dev talking to the app on 127.0.0.1
  "src-tauri/src/pty_service.rs": [TCP_CONNECT], // pty_service.rs:514 Client::connect: the host is the literal [127,0,0,1], only the port comes from the service's endpoint file
  "src-tauri/src/labels.rs": [TCP_CONNECT], // labels.rs:180 the label proxy to a workspace dev server: its only target comes from target_of (labels.rs:75), which refuses any host that is not a loopback IP or localhost
};
// The one loopback call each file may make, as exact text: it is cut out before the scan, so any
// other fetch in the same file is still caught (an ALLOWED entry would pass the whole file).
// A whole-file reqwest pass covers one client only: a second builder in the same file fails the audit.
const ONE_CLIENT = { "src-tauri/src/artifacts.rs": "reqwest::Client::builder(" };
// browser.rs (council FIX-4, Ruling 1): its icon clients both come from one builder line, kept as
// exact text with the public-only lookup and no proxy, and from exactly three calls of the function
// that holds it; any other way of making a client (a bare constructor, an imported Client, the
// one-shot get) is counted too, so a second client written any of the ways the second test lists fails the audit.
const PINNED = {
  "src-tauri/src/browser.rs": [
    ["reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(policy).no_proxy().dns_resolver(resolver).build()", 1],
    [/\b(?:Client|ClientBuilder)\s*::\s*(?:builder|new|default)\s*\(|\breqwest\s*::\s*(?:blocking\s*::\s*)?get\s*\(/g, 1],
    ["icon_client_for(", 3],
    // every reqwest path and every mention of the client function, so an aliased import or a function pointer moves a count
    [/\breqwest::/g, 11],
    [/\bicon_client_for\b/g, 4],
  ],
  // pty_service.rs holds exactly one loopback connect (its ALLOWED line); a second one fails the audit.
  "src-tauri/src/pty_service.rs": [[TCP_CONNECT_ALL, 1]],
  // labels.rs holds exactly one connect, behind the loopback guard in target_of; a second one fails the audit.
  "src-tauri/src/labels.rs": [[TCP_CONNECT_ALL, 1]],
};
const EXACT = {
  // browser.rs:285 the page script wraps the open PAGE's own XHR (offline/intercept/extra headers); it opens no connection of its own, so the page's requests stay "the sites you open in the browser pane"
  "src-tauri/src/browser.rs": /\bXMLHttpRequest\.prototype\b/g,
  "src-tauri/src/agent_hooks/vendors.rs": /\bfetch\(`http:\/\/127\.0\.0\.1:\$\{port\}\/amp`/g, // the Amp status plugin posting to Kolux on 127.0.0.1
};

const count = (text, what) => (typeof what === "string" ? text.split(what).length - 1 : (text.match(what) ?? []).length);
// Rust tests sit at the end of each file in its `#[cfg(test)] mod tests`; a client used only there is
// not shipped. The cut is at that module, not at the first `#[cfg(test)]`, so a test-only helper
// earlier in the file cannot hide the rest of the file from the scan (council FIX-4, Ruling 1).
const shipped = (text) => {
  const m = /#\[cfg\(test\)\]\s*mod tests\b/.exec(text);
  return m ? text.slice(0, m.index) : text;
};
const clientProblems = (rel, text) => CLIENTS.filter((re) => re.test(text) && !(ALLOWED[rel] ?? []).some((a) => a.source === re.source)).map((re) => `${rel}: ${re.source}`);
const pinnedProblems = (rel, text) => (PINNED[rel] ?? []).filter(([what, n]) => count(text, what) !== n).map(([what, n]) => `${rel}: ${String(what)} x${count(text, what)}, want ${n}`);

test("app070: no network client in the shipped source beyond the connections the statement names", () => {
  // scripts/evidence, scripts/prove and scripts/stress drive a hidden dev build over loopback CDP for proofs and
  // never ship: tauri.conf.json bundles only ../dist (no resources), package.json is private, nothing in src or src-tauri imports them.
  const harness = ["evidence", "prove", "stress"].map((d) => `${path.sep}scripts${path.sep}${d}${path.sep}`);
  const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "src-tauri/src")), ...walk(path.join(root, "scripts")).filter((f) => !harness.some((h) => f.includes(h)))];
  expect(files.length).toBeGreaterThan(50);
  // Keeps the folder exclusions honest: nothing shipped may name a harness folder, and the bundle carries no extra files or sidecars.
  const imports = [...walk(path.join(root, "src")), ...walk(path.join(root, "src-tauri/src"))].filter((f) => /scripts[\\/]+(?:evidence|prove|stress)\b/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
  expect(imports).toEqual([]);
  const bundle = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).bundle ?? {};
  expect(bundle.resources, "bundle.resources").toBeUndefined();
  expect(bundle.externalBin, "bundle.externalBin").toBeUndefined();
  const found = [];
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, "/");
    let text = shipped(fs.readFileSync(f, "utf8"));
    if (EXACT[rel]) {
      expect(text.match(EXACT[rel]) ?? [], rel).toHaveLength(1);
      text = text.replace(EXACT[rel], "");
    }
    if (ONE_CLIENT[rel]) expect(text.split(ONE_CLIENT[rel]).length - 1, rel).toBe(1);
    found.push(...pinnedProblems(rel, text), ...clientProblems(rel, text));
  }
  expect(found).toEqual([]);
});

test("app070: a Node http.request or a Python urllib.request in shipped source is flagged like a fetch", () => {
  // An embedded script (a vendor extension or plugin Kolux writes) could open a connection with either; neither is in use today.
  const node = 'const req = http.request({ host: "127.0.0.1", port, path, method: "POST" }, () => {});\n';
  const py = "import urllib.request\nurllib.request.urlopen(url)\n";
  const rust = 'let body = "import urllib.request\\nurllib.request.urlopen(u)";\n';
  for (const text of [node, py, rust]) expect(clientProblems("src/other.ts", text).length, text).toBeGreaterThan(0);
  // A plain request call, a request field or a longer name is not one of these clients.
  expect(clientProblems("src/other.ts", "const r = await request(url); x.request = 1; http.requestCount++; myhttp.requests();\n")).toEqual([]);
});

test("app070: a spaced TcpStream :: connect is flagged like the plain spelling", () => {
  const spaced = "fn x() { let _ = std::net::TcpStream :: connect(addr); }\n";
  const split = "fn x() { let _ = TcpStream\n    ::connect(addr); }\n";
  for (const text of [spaced, split]) {
    expect(clientProblems("src-tauri/src/other.rs", text).length, text).toBeGreaterThan(0);
    // labels.rs holds exactly one connect: a second one, however spaced, moves the pinned count.
    const labels = shipped(fs.readFileSync(path.join(root, "src-tauri/src/labels.rs"), "utf8"));
    expect(pinnedProblems("src-tauri/src/labels.rs", labels + text).length, text).toBeGreaterThan(0);
  }
});

test("app070: a second network client in browser.rs fails the audit in each listed form", () => {
  const rel = "src-tauri/src/browser.rs";
  const full = fs.readFileSync(path.join(root, rel), "utf8");
  const real = shipped(full);
  expect(pinnedProblems(rel, real)).toEqual([]);
  const chain = PINNED[rel][0][0];
  const second = {
    "Client::new": real + "\nfn x() { let _ = reqwest::Client::new(); }\n",
    "ClientBuilder::new": real + "\nfn x() { let _ = reqwest::ClientBuilder::new().build(); }\n",
    "imported Client": real + "\nuse reqwest::Client;\nfn x() { let _ = Client::builder().build(); }\n",
    "one-shot get": real + "\nasync fn x() { let _ = reqwest::get(\"https://example.com\").await; }\n",
    "a third icon_client_for": real + "\nfn x() { let _ = icon_client_for(None, true, system_lookup); }\n",
    "no public-only lookup": real.replace(chain, chain.replace(".dns_resolver(resolver)", "")),
    "through a proxy": real.replace(chain, chain.replace(".no_proxy()", "")),
    "Client::default": real + "\nfn x() { let _ = reqwest::Client::default(); }\n",
    "ClientBuilder::default": real + "\nfn x() { let _ = reqwest::ClientBuilder::default().build(); }\n",
    "aliased import": real + "\nuse reqwest::Client as Web;\nfn x() { let _ = Web::builder().build(); }\n",
    "function pointer": real + "\nfn x() { let make = icon_client_for; let _ = make(None, true, system_lookup); }\n",
    "spaced path": real + "\nfn x() { let _ = reqwest::Client :: new(); }\n",
  };
  for (const [name, text] of Object.entries(second)) expect(pinnedProblems(rel, text).length, name).toBeGreaterThan(0);
  // A test-only helper above the shipped code no longer hides what follows it.
  const hidden = real + "\n#[cfg(test)]\nfn helper() {}\nfn x() { let _ = reqwest::Client::new(); }\n" + full.slice(real.length);
  expect(shipped(hidden).includes("reqwest::Client::new()")).toBe(true);
  expect(pinnedProblems(rel, shipped(hidden)).length).toBeGreaterThan(0);
});
