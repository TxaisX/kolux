// Proves each user guide page (docs/guide/*.md) was checked against the code at the commit its marker
// names (P1-02, P4B-05). The last line of a page is a marker:
//   <!-- verified against: src/a.ts, src/b.tsx at 1a2b3c4 -->
// The check fails when a page, ignoring its marker line, differs from the same page at that commit, when
// the commit is not in this history, or when a source file the marker lists is gone. Edit a page, then
// re-read it against the code, commit, and move the marker to that commit (a second commit).
//   node scripts/guide-check.mjs      exit 0 = OK, 1 = problems listed
// Test: pnpm exec vitest run scripts/guide-check.test.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER_LINE = /^<!--\s*verified against:(.*)\s+at\s+([0-9a-f]{7,40})\s*-->\s*$/;

/** Runs git in the repository; returns its output, or null when git exits with an error. */
export function gitIn(root) {
  return (args) => {
    try {
      return execFileSync("git", args, { windowsHide: true, cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
}

const unix = (text) => text.replace(/\r\n/g, "\n");

/** The page without its marker lines (and the older "generated from" line), so moving the marker never counts as a change. */
export function stripMarker(text) {
  return unix(text)
    .split("\n")
    .filter((line) => !/^<!--\s*(verified against:|generated from)/.test(line))
    .join("\n")
    .trimEnd();
}

/** The marker of a page: { files, sha }, or null when it has none. */
export function readMarker(text) {
  for (const line of unix(text).split("\n")) {
    const m = MARKER_LINE.exec(line.trim());
    if (m) return { files: [...new Set(m[1].match(/(?:src|src-tauri|scripts|tools)\/[\w./-]+\.\w+/g) ?? [])], sha: m[2] };
  }
  return null;
}

export function check(root = ROOT, git = gitIn(root)) {
  const dir = path.join(root, "docs", "guide");
  const problems = [];
  const pages = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
  if (pages.length === 0) problems.push("docs/guide has no pages");
  for (const page of pages) {
    const rel = `docs/guide/${page}`;
    const text = fs.readFileSync(path.join(dir, page), "utf8");
    const marker = readMarker(text);
    if (!marker) {
      problems.push(`${rel} has no "<!-- verified against: ... at <commit> -->" line`);
      continue;
    }
    if (git(["cat-file", "-e", `${marker.sha}^{commit}`]) === null) {
      problems.push(`${rel}: marker commit ${marker.sha} is not in this repository's history (a shallow clone needs a deeper fetch)`);
      continue;
    }
    if (git(["merge-base", "--is-ancestor", marker.sha, "HEAD"]) === null) {
      problems.push(`${rel}: marker commit ${marker.sha} is not an ancestor of HEAD`);
      continue;
    }
    const then = git(["show", `${marker.sha}:${rel}`]);
    if (then === null) problems.push(`${rel} did not exist at its marker commit ${marker.sha}`);
    else if (stripMarker(then) !== stripMarker(text)) {
      problems.push(`${rel} changed after its marker commit ${marker.sha}: re-check it against the code, commit, then move the marker to that commit`);
    }
    for (const file of marker.files) {
      if (!fs.existsSync(path.join(root, file))) problems.push(`${rel}: the marker lists ${file}, which no longer exists`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`guide-check: ${p}`);
    process.exit(1);
  }
  console.log(`guide-check: OK (${fs.readdirSync(path.join(ROOT, "docs", "guide")).filter((f) => f.endsWith(".md")).length} guide pages match their markers)`);
}
