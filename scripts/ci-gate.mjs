// APP-060: a release built through CI publishes only when CI passed for that exact commit. Waits up
// to 30 minutes for a run still queued or running; any refusal is written to the job summary.
//
//   node scripts/ci-gate.mjs <commit sha>        (exit 0 = go, 1 = refused)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WAIT_MS = 30 * 60 * 1000;
export const POLL_MS = 30 * 1000;

/** runs: newest first, as `gh run list --json status,conclusion,url` prints them. */
export function decide(runs, sha, elapsedMs) {
  const short = sha.slice(0, 7);
  const run = runs[0];
  const late = elapsedMs >= WAIT_MS;
  if (!run) return late ? { verdict: "refuse", reason: `No CI run for commit ${short} appeared within 30 minutes, so this release was not published.` } : { verdict: "wait", reason: `waiting for CI to start on ${short}` };
  if (run.status !== "completed") return late ? { verdict: "refuse", reason: `CI for commit ${short} was still ${run.status} after 30 minutes, so this release was not published. ${run.url ?? ""}`.trim() } : { verdict: "wait", reason: `CI for ${short} is ${run.status}` };
  if (run.conclusion === "success") return { verdict: "pass", reason: `CI passed for commit ${short}.` };
  return { verdict: "refuse", reason: `CI for commit ${short} ended "${run.conclusion}", so this release was not published. Fix main and ship again. ${run.url ?? ""}`.trim() };
}

function runsFor(sha) {
  // gh is a plain program on CI; the shell is only for a .cmd stand-in on Windows. The sha is checked hex.
  const r = spawnSync("gh", ["run", "list", "--workflow", "ci.yml", "--commit", sha, "--json", "status,conclusion,url", "--limit", "20"], { windowsHide: true, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`gh run list failed: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout || "[]");
}

async function main() {
  const sha = process.argv[2] ?? "";
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("usage: node scripts/ci-gate.mjs <commit sha>");
  const start = Date.now();
  for (;;) {
    const d = decide(runsFor(sha), sha, Date.now() - start);
    console.log(d.reason);
    if (d.verdict === "pass") return 0;
    if (d.verdict === "refuse") {
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release refused\n\n${d.reason}\n`);
      return 1;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release refused\n\n${e.message}\n`);
      process.exit(1);
    },
  );
}
