// APP-058: one ship command. Commits what is in this worktree (message by AI unless --message),
// merges the latest remote in (never a rebase), pushes, and with --main lands the work on main and
// starts the release job (APP-059) in the background. Any conflict stops everything before a push.
//
//   pnpm ship [--main] [--no-release] [--merge <branch>] [--dry-run] [--model <id>] [--message <text>]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkoutDir, logDir } from "./release.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL = "haiku";

export function parseArgs(argv) {
  const o = { main: false, release: true, merge: null, dryRun: false, model: DEFAULT_MODEL, message: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--main") o.main = true;
    else if (a === "--no-release") o.release = false;
    else if (a === "--merge") o.merge = value();
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--model") o.model = value();
    else if (a === "--message") o.message = value();
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--") continue; // pnpm passes this through
    else throw new Error(`unknown option ${a}; run pnpm ship --help`);
  }
  if (o.message !== null && !o.message.trim()) throw new Error("--message is empty");
  if (!/^[\w.:[\]-]+$/.test(o.model)) throw new Error(`--model ${o.model} is not a model id`);
  return o;
}

const HELP = `pnpm ship: commit, sync and push this worktree (APP-058)

  --main             also land the work on main and start a release in the background
  --no-release       with --main, land on main without starting a release
  --merge <branch>   merge that branch into this one first
  --dry-run          print what would happen and change nothing
  --model <id>       the model that writes the commit message (default ${DEFAULT_MODEL})
  --message <text>   use this commit message instead of one written by AI
`;

class Stop extends Error {}

export function ship(o, { cwd = process.cwd(), log = console.log, env = process.env } = {}) {
  const git = (args, { quiet = false, allowFail = false } = {}) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    if (r.status !== 0 && !allowFail) throw new Stop(`git ${args.join(" ")} failed:\n${(r.stderr || r.stdout).trim()}`);
    if (!quiet && r.stdout.trim()) log(r.stdout.trim());
    return r;
  };
  // Commands that change something only print in a dry run.
  const change = (args, opts) => {
    if (o.dryRun) {
      log(`would run: git ${args.join(" ")}`);
      return { status: 0, stdout: "", stderr: "" };
    }
    return git(args, opts);
  };
  const mergeOrStop = (ref) => {
    if (o.dryRun) return void log(`would run: git merge --no-edit ${ref}`);
    const r = git(["merge", "--no-edit", ref], { allowFail: true });
    if (r.status !== 0) {
      git(["merge", "--abort"], { allowFail: true, quiet: true });
      throw new Stop(`merging ${ref} ran into a conflict. Nothing was pushed and the merge was undone.\nResolve it by hand (git merge ${ref}), then ship again.`);
    }
  };

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true }).stdout.trim();
  if (branch === "HEAD") throw new Stop("this checkout is not on a branch; switch to one and ship again");
  if (git(["remote"], { quiet: true }).stdout.split(/\s+/).indexOf("origin") < 0) throw new Stop("this repository has no remote called origin");

  if (o.merge) mergeOrStop(o.merge);

  // 1. Commit what is here.
  const dirty = git(["status", "--porcelain"], { quiet: true }).stdout.trim() !== "";
  if (dirty) {
    let message = o.message;
    if (!message) {
      if (o.dryRun) log(`would write the commit message with AI (${o.model})`);
      else {
        git(["add", "-A"], { quiet: true });
        message = aiMessage(git, o.model, env);
        log(`commit message: ${message}`);
      }
    }
    if (!o.dryRun) {
      git(["add", "-A"], { quiet: true });
      git(["commit", "-q", "-m", message]);
    } else log(`would run: git add -A && git commit -m ${JSON.stringify(message ?? "<AI message>")}`);
  } else log("nothing to commit; syncing");

  // 2. Bring the remote in by merge, never by rebase.
  change(["fetch", "-q", "origin"]);
  const has = (ref) => git(["rev-parse", "--verify", "-q", ref], { quiet: true, allowFail: true }).status === 0;
  if (has(`origin/${branch}`)) mergeOrStop(`origin/${branch}`);
  if (o.main && branch !== "main" && has("origin/main")) mergeOrStop("origin/main");

  // 3. Push. With --main the branch now holds origin/main, so main moves forward without a force.
  change(["push", "-q", "-u", "origin", branch]);
  if (o.main && branch !== "main") {
    const r = change(["push", "-q", "origin", "HEAD:main"], { allowFail: true });
    if (r.status !== 0) throw new Stop(`main moved on the remote while shipping; your branch ${branch} is pushed. Ship again to land it.\n${r.stderr.trim()}`);
  }
  const head = o.dryRun ? "(dry run)" : git(["rev-parse", "--short", "HEAD"], { quiet: true }).stdout.trim();
  log(o.main ? `landed ${head} on main` : `pushed ${head} to origin/${branch}`);

  // 4. A ship to main starts a release by itself (APP-059), unless asked not to.
  if (o.main && o.release) {
    const repo = git(["remote", "get-url", "origin"], { quiet: true }).stdout.trim();
    if (o.dryRun) log(`would start the release job for ${repo} in ${checkoutDir(env)}`);
    else log(`release job started; its log is ${startRelease(repo, env)}`);
  }
}

function aiMessage(git, model, env) {
  const stat = git(["diff", "--cached", "--stat"], { quiet: true }).stdout;
  const diff = git(["diff", "--cached"], { quiet: true }).stdout.slice(0, 20000);
  const prompt = `Write one git commit subject line for this change: imperative, under 72 characters, saying what the user can now do or what was fixed. Reply with the line only.\n\n${stat}\n${diff}`;
  // The prompt goes in on stdin; the arguments are fixed words, so the shell sees nothing typed.
  // The model id passed parseArgs' check, so it holds no shell characters.
  const win = process.platform === "win32";
  const r = win ? spawnSync(`claude -p --model ${model}`, { input: prompt, encoding: "utf8", shell: true, env, timeout: 120000, windowsHide: true }) : spawnSync("claude", ["-p", "--model", model], { input: prompt, encoding: "utf8", env, timeout: 120000, windowsHide: true });
  const line = (r.stdout || "").split(/\r?\n/).map((l) => l.trim().replace(/^["'`]|["'`]$/g, "")).find(Boolean);
  if (r.status !== 0 || !line) throw new Stop(`the AI could not write a commit message (${(r.stderr || r.error?.message || "no answer").trim().slice(0, 200)}). Pass --message "<text>" and ship again.`);
  return line;
}

export function startRelease(repo, env = process.env) {
  const dir = logDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `release-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const fd = fs.openSync(file, "a");
  // Detached and outside this worktree, so the worktree can be deleted straight after the ship.
  const child = spawn(process.execPath, [path.join(HERE, "release.mjs"), "--repo", repo], {
    cwd: path.dirname(dir),
    detached: true,
    stdio: ["ignore", fd, fd],
    env,
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(fd);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) process.stdout.write(HELP);
    else ship(o);
  } catch (e) {
    console.error(e instanceof Stop || e.message ? e.message : e);
    process.exit(1);
  }
}
