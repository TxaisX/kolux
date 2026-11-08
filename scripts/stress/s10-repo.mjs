// S10 throwaway repo: ~50k small tracked files, branch `feature` 200 commits ahead of `main` (edits, renames, additions), then
// ~2k modified and ~500 untracked files left in the working tree. Built with `git fast-import` so no 50k-file `git add` is needed.
// Standalone: node scripts/stress/s10-repo.mjs <dir> (the dir is wiped first). Never inside a checkout.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const FILES = 50000;
export const COMMITS = 200;
export const MODIFIED = 2000;
export const UNTRACKED = 500;
export const BIG = "aaa-bigfile.txt";
const BIG_LINES = 12000;

const pad = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(4);
const line = (tag, i) => `${tag} ${i} ${pad}`.slice(0, 99) + "\n";
const content = (n, rev) => `file ${n} rev ${rev}\n` + line("body", n) + line("more", n + rev);
const baseDir = (n) => `d${n % 25}/s${Math.floor(n / 25) % 20}/t${Math.floor(n / 500) % 10}`;
const bigText = (rev) => Array.from({ length: BIG_LINES }, (_, i) => (rev && i % 20 === 7 ? line("changed", i + rev) : line("big", i))).join("");

class Stream {
  constructor(child) {
    this.child = child;
  }
  async put(s) {
    const b = Buffer.isBuffer(s) ? s : Buffer.from(s);
    if (!this.child.stdin.write(b)) await new Promise((r) => this.child.stdin.once("drain", r));
  }
  async file(path, text) {
    const b = Buffer.from(text);
    await this.put(`M 644 inline ${path}\ndata ${b.length}\n`);
    await this.put(b);
    await this.put("\n");
  }
}

export async function buildRepo(dir, log = console.log) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const git = (args, opt = {}) => {
    const r = spawnSync("git", ["-c", "user.name=stress", "-c", "user.email=stress@example.invalid", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true, ...opt });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || "").slice(0, 300)}`);
    return r.stdout;
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "core.autocrlf", "false"]);
  const cur = new Map(); // file number -> current path
  const child = spawn("git", ["fast-import", "--quiet", "--date-format=raw"], { cwd: dir, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise((r) => child.on("close", r));
  const s = new Stream(child);
  let clock = 1700000000;
  const commit = async (ref, msg, from, body) => {
    clock += 60;
    await s.put(`commit ${ref}\ncommitter stress <stress@example.invalid> ${clock} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\n${from ? `from ${from}\n` : ""}`);
    await body();
    await s.put("\n");
  };
  await commit("refs/heads/main", "base: 50k small files", null, async () => {
    for (let n = 0; n < FILES; n++) {
      const p = `${baseDir(n)}/f${n}.txt`;
      cur.set(n, p);
      await s.file(p, content(n, 0));
    }
    await s.file(BIG, bigText(0));
  });
  log(`base commit written (${FILES} files)`);
  for (let i = 1; i <= COMMITS; i++) {
    await commit("refs/heads/feature", `feature ${i}`, i === 1 ? "refs/heads/main" : null, async () => {
      const touched = new Set();
      if (i % 4 === 0) {
        for (let k = 0; k < 8; k++) {
          const n = (i * 613 + k * 2111) % FILES;
          if (touched.has(n)) continue;
          touched.add(n);
          const np = `r${i}/f${n}.txt`;
          await s.put(`R ${cur.get(n)} ${np}\n`);
          cur.set(n, np);
          if (k % 2 === 0) await s.file(np, content(n, i)); // rename plus edit
        }
      }
      for (let k = 0; k < 15; k++) {
        const n = (i * 977 + k * 131) % FILES;
        if (touched.has(n)) continue;
        touched.add(n);
        await s.file(cur.get(n), content(n, i));
      }
      if (i % 10 === 0) for (let k = 0; k < 5; k++) await s.file(`n${i}/new${k}.txt`, content(FILES + i * 10 + k, i));
      if (i % 20 === 0) await s.file(BIG, bigText(i));
    });
  }
  child.stdin.end();
  const code = await exited;
  if (code !== 0) throw new Error(`git fast-import exited ${code}: ${err.slice(0, 300)}`);
  git(["checkout", "-q", "-f", "feature"]);
  log(`feature checked out; ahead by ${git(["rev-list", "--count", "main..feature"]).trim()}`);
  // The working tree: ~2k modified files (one appended line each), the big file rewritten in places, ~500 untracked files.
  for (let k = 0; k < MODIFIED; k++) {
    const n = (k * 23 + 5) % FILES;
    appendFileSync(join(dir, cur.get(n)), `local edit ${k}\n`);
  }
  const big = readFileSync(join(dir, BIG), "utf8").split("\n");
  for (let i = 3; i < big.length; i += 20) big[i] = `local ${i} ${pad}`.slice(0, 99);
  writeFileSync(join(dir, BIG), big.join("\n"));
  for (let k = 0; k < UNTRACKED; k++) {
    const n = (k * 97 + 11) % FILES;
    writeFileSync(join(dir, dirname(cur.get(n)), `untracked-${k}.txt`), `untracked ${k}\n`);
  }
  const status = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const modified = status.filter((l) => l[1] === "M" || l[0] === "M").length;
  const untracked = status.filter((l) => l.startsWith("??")).length;
  const tracked = git(["ls-files"]).split("\n").filter(Boolean).length;
  const renames = git(["diff", "--name-status", "-M", "main..feature"]).split("\n").filter((l) => l.startsWith("R")).length;
  const facts = { tracked, ahead: Number(git(["rev-list", "--count", "main..feature"]).trim()), modified, untracked, renamesAgainstBase: renames };
  writeFileSync(join(dir, ".git", "s10-facts.json"), JSON.stringify(facts));
  return facts;
}

if (process.argv[1]?.endsWith("s10-repo.mjs")) {
  const dir = process.argv[2];
  if (!dir || !/stress-s10/.test(dir.replace(/\\/g, "/"))) {
    console.error("usage: node scripts/stress/s10-repo.mjs G:/Temp/stress-s10/repo");
    process.exit(2);
  }
  const t = Date.now();
  buildRepo(dir).then((f) => console.log(JSON.stringify(f), `${((Date.now() - t) / 1000).toFixed(0)} s`)).catch((e) => (console.error(e.message), process.exit(1)));
}
