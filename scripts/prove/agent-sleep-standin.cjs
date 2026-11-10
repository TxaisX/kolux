// A stand-in for Claude Code, for the agent-sleep proof (scripts/stress/s13-agent-sleep.mjs) only. It is NOT Claude Code: no
// network, no account, no model. The proof copies it into its scratch folder as claude.js beside a claude.cmd that runs it, and
// points the scratch profile's Claude command at that claude.cmd, so Kolux starts it the way it starts Claude Code
// (`node ...\claude.js` is credited to Claude by Kolux's foreground check, as an npm install of Claude Code is).
// What it does, as Claude Code would:
//   - holds HOLD_MB of memory, every page touched, to stand in for a session's footprint;
//   - reads the hooks Kolux installed in the scratch CLAUDE_CONFIG_DIR/settings.json and runs each hook command for its events with
//     the event JSON on stdin (SessionStart, UserPromptSubmit, PreToolUse, Stop), so Kolux learns the session id and the turn state
//     through its own hook script and listener;
//   - `--resume <id>` comes back on that session id (SessionStart source "resume").
// Its mode for a fresh start is the next line of modes.txt beside it (written by the proof, one per pane, in opening order):
//   finished[:S]: a turn runs and finishes (Stop) after S seconds (1.5 by default); busy: a turn starts a tool and never finishes. A resume is always "finished".
// Every start and hook run is appended to standin.log beside it (JSON lines), which the proof reads.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const HOLD_MB = 600;
const dir = __dirname;
const log = (o) => fs.appendFileSync(path.join(dir, "standin.log"), JSON.stringify({ t: Date.now(), pid: process.pid, ...o }) + "\n");
const argv = process.argv.slice(2);
const ri = argv.indexOf("--resume");
const resumed = ri >= 0 && argv[ri + 1] ? argv[ri + 1] : null;

function nextMode() {
  const f = path.join(dir, "modes.txt");
  try {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean);
    const m = lines.shift() ?? "finished";
    fs.writeFileSync(f, lines.join("\n"));
    return m;
  } catch {
    return "finished";
  }
}
const [mode, finishS] = (resumed ? "finished" : nextMode()).split(":");
const finishMs = finishS ? Number(finishS) * 1000 : 1500;
const session = resumed ?? crypto.randomUUID();

// The held memory: allocated and every 4 KB page written, so it is both committed (private bytes) and resident (working set).
const hold = Buffer.allocUnsafe(HOLD_MB * 1048576);
for (let i = 0; i < hold.length; i += 4096) hold[i] = (i >> 12) & 0xff;
globalThis.__hold = hold;

// Kolux rewrites settings.json as agent panes start, so a read can land on a file being written or on a set without this event yet:
// try again for up to 3 s, and log what was seen when the event never shows up.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let seen = "";
// The stand-in only reads a settings file inside its own scratch run folder (the folder above its own), so a pane that
// inherited the owner's real CLAUDE_CONFIG_DIR can never make it read or run his hooks.
const scratchRoot = path.resolve(dir, "..").toLowerCase() + path.sep;
const cfgIn = () => {
  const c = process.env.CLAUDE_CONFIG_DIR;
  return !!c && (path.resolve(c).toLowerCase() + path.sep).startsWith(scratchRoot);
};
const hooksFor = (event) => {
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (!cfg) return (seen = "no CLAUDE_CONFIG_DIR"), [];
  if (!cfgIn()) return (seen = "CLAUDE_CONFIG_DIR outside the scratch run folder: not read"), [];
  for (let i = 0; i < 15; i++) {
    try {
      const h = JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")).hooks ?? {};
      seen = Object.keys(h).join(",") || "(no hooks)";
      if (h[event]) return h[event];
    } catch (e) {
      seen = `unreadable: ${e.code ?? e.message}`;
    }
    sleepMs(200);
  }
  return [];
};
function fire(event, extra = {}) {
  const groups = hooksFor(event);
  const cmds = groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command)).filter(Boolean);
  const payload = { session_id: session, transcript_path: "", cwd: process.cwd(), permission_mode: "default", hook_event_name: event, ...extra };
  for (const c of cmds) {
    const r = cp.spawnSync(c, { shell: true, input: JSON.stringify(payload), encoding: "utf8", timeout: 15000, windowsHide: true });
    log({ hook: event, status: r.status, out: String(r.stdout ?? "").slice(0, 120), err: String(r.stderr ?? "").slice(0, 120) });
  }
  if (!cmds.length) log({ hook: event, status: "no hook installed", seen });
}

log({ start: true, argv, mode, finishMs, session, resumed: !!resumed, cwd: process.cwd(), heldMB: HOLD_MB, configInScratch: cfgIn() });
process.stdout.write(`Claude Code stand-in (agent-sleep proof; not Claude Code)\r\nsession ${session}${resumed ? " (resumed)" : ""}, mode ${mode}, holding ${HOLD_MB} MB\r\n`);
// Claude Code takes a moment to start before its first hook; so does the stand-in (and Kolux's own hook install settles).
sleepMs(1000);
fire("SessionStart", { source: resumed ? "resume" : "startup" });
if (!resumed) {
  fire("UserPromptSubmit", { prompt: "stand-in task" });
  process.stdout.write("> stand-in task\r\n");
  if (mode === "busy") {
    fire("PreToolUse", { tool_name: "Bash", tool_input: { command: "stand-in long job" } });
    process.stdout.write("working (a tool is running; this turn never finishes)\r\n");
  } else {
    setTimeout(() => {
      process.stdout.write("Done.\r\n> ");
      fire("Stop", { stop_hook_active: false });
      log({ finished: true });
    }, finishMs);
  }
} else {
  process.stdout.write("> ");
}
setInterval(() => {}, 1 << 30);
