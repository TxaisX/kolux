// T-791 (P2b-13, P2b-14, P2A-04, P2b-09): the Privacy list names every host the Rust source can talk
// to. This reads src-tauri/src (test modules and test files aside), takes each https address in code,
// and requires either a row of OUTBOUND (src/settings/outbound.ts) that names the host, or a stated
// reason the address is not a connection the app makes. A new host with neither fails here.
import { expect, test } from "vitest";
// @ts-expect-error vitest runs on Node; the app's browser tsconfig has no Node types.
import { readdirSync, readFileSync } from "node:fs";
import { OUTBOUND } from "../settings/outbound";

const SRC = new URL("../../src-tauri/src/", import.meta.url);
const list = OUTBOUND.map((o) => `${o.to} ${o.when}`).join("\n").toLowerCase();

/** Each host the app's own code (not its test modules) writes after http(s)://, with where. */
function hostsInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = (readdirSync(SRC, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith(".rs") && !/_tests?\.rs$/.test(f));
  for (const f of files.sort()) {
    const lines: string[] = readFileSync(new URL(f.split("\\").join("/"), SRC), "utf8").split(/\r?\n/);
    const cut = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
    (cut < 0 ? lines : lines.slice(0, cut)).forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const m of line.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
        const host = m[1].toLowerCase();
        found.set(host, [...(found.get(host) ?? []), `${f.split("\\").join("/")}:${i + 1}`]);
      }
    });
  }
  return found;
}

/** A host the app connects to: the text a row of the list must carry for it. */
const CONNECTS: Record<string, string> = {
  "api.github.com": "github account",
  "github.com": "github account",
  "avatars.githubusercontent.com": "avatars.githubusercontent.com",
  "raw.githubusercontent.com": "raw.githubusercontent.com",
  "api.moonshot.ai": "api.moonshot.ai",
  "www.minimax.io": "www.minimax.io",
  "cdnjs.cloudflare.com": "cdnjs",
  "cdn.jsdelivr.net": "jsdelivr",
  "unpkg.com": "unpkg",
  "cdn.tailwindcss.com": "tailwindcss",
  "code.jquery.com": "jquery",
  "claude.ai": "claude.ai",
  "chatgpt.com": "chatgpt.com",
  "cursor.com": "cursor.com",
  "x.ai": "x.ai",
  "antigravity.google": "antigravity.google",
  "aider.chat": "aider.chat",
  "app.factory.ai": "app.factory.ai",
  "app.primeintellect.ai": "app.primeintellect.ai",
  "cli.kiro.dev": "cli.kiro.dev",
  "code.kimi.com": "code.kimi.com",
  "hermes-agent.nousresearch.com": "hermes-agent.nousresearch.com",
  "mimo.xiaomi.com": "mimo.xiaomi.com",
  "omp.sh": "omp.sh",
  "openclaw.ai": "openclaw.ai",
  "static.devin.ai": "static.devin.ai",
};

/** An address in the code that is not a connection the app makes, and why. */
const NOT_A_CONNECTION: Record<string, string> = {
  "127.0.0.1": "this computer: the browser pane's own preview and port probe",
  "kolux-artifact.localhost": "the app's own scheme for showing a saved artifact",
  "git-scm.com": "words in an error message; the person decides whether to open it",
  "avatars.": "the start of the GitHub Enterprise picture host, built from the repository's own host",
  host: "a placeholder in a code comment or doc string",
  "example.com": "a placeholder in a doc string",
};

test("t791: every host the app's code can reach has a row in the Privacy list, or a stated reason", () => {
  const found = hostsInCode();
  expect(found.size).toBeGreaterThan(20); // the reader finds the source at all
  const unnamed = [...found].filter(([h]) => !(h in CONNECTS) && !(h in NOT_A_CONNECTION)).map(([h, at]) => `${h} (${at[0]})`);
  expect(unnamed, "add a row to OUTBOUND in src/settings/outbound.ts and a line to CONNECTS here").toEqual([]);
});

test("t791: each host in CONNECTS is named by a row of the Privacy list, and still appears in the code", () => {
  const found = hostsInCode();
  expect(Object.entries(CONNECTS).filter(([, text]) => !list.includes(text)).map(([h]) => h)).toEqual([]);
  expect(Object.keys(CONNECTS).filter((h) => !found.has(h))).toEqual([]);
  expect(Object.keys(NOT_A_CONNECTION).filter((h) => !found.has(h))).toEqual([]);
});

test("t791: the list says what the installers, skills, artifacts ticker and pane keys do", () => {
  expect(list).toContain("press install on an agent");
  expect(list).toContain("npx --yes skills");
  expect(list).toContain("every 3 seconds");
  expect(list).toContain("claude_code_oauth_token");
  expect(list).toContain("xai_api_key");
  expect(list).toContain("avatars.githubusercontent.com");
});

test("t791: the installer hosts in the list are exactly the Url rows of the installer table", () => {
  const table = readFileSync(new URL("agent_install_official.rs", SRC), "utf8");
  const urls = [...table.matchAll(/Url\("https:\/\/([^/"]+)/g)].map((m) => m[1]);
  expect(urls.length).toBeGreaterThan(10);
  expect(urls.filter((h) => !list.includes(h))).toEqual([]);
});
