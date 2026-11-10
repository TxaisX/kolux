// LIVE proof, USAGE-007 box 4 (spec/06): with the resume switch off nothing is ever typed into a Claude pane stopped on a usage limit.
// Usage: node live-USAGE-007.mjs off   (switch unset: the default; nothing may be typed)
//        node live-USAGE-007.mjs on    (control: claudeResumeAfterLimit true; the continue prompt appears exactly once)
// The stop is real input to the app's own hook server (the same two posts the Claude hooks make: the status line's rate limits, then a StopFailure
// with a rate-limit error), for a pane Kolux started as Claude (the stand-in, which echoes anything typed into it as a GOT line). No real agent runs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, norm } from "./live-proj-common.mjs";
import { runCli, allPaneBuffers } from "./live-cli-common.mjs";

const STANDIN = ["echo ARGV: %*", "echo CWD: %CD%", "echo IDENT: %KOLUX_HOOK_IDENTITY%", ":again", "set /p L=", "echo GOT: %L%", "goto again"];
const PROMPT_WORDS = "The usage limit has reset. Please continue where you left off.";
const IDENTIFIER = "com.txaisxiong.kolux.prove";

const post = (port, path, headers, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(data);
  });

/** The pane's own "<port> <token>" file somewhere under the scratch roaming folder (T-793: the shared file carries no token). */
function endpointFile(roaming, terminal) {
  const stack = [roaming];
  while (stack.length) {
    const d = stack.pop();
    for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) stack.push(p);
      else if (e.name === `agent-hooks-endpoint-${terminal}.txt`) return p;
    }
  }
  return null;
}

export async function run007(ctx, mode, { check, log }) {
  const { app } = ctx;
  const r = await runCli(ctx, "worktree create --name a --agent claude --prompt hi --activate");
  log(`worktree a with a stand-in Claude pane started by Kolux: exit=${r.exit}`);
  const pane = await poll(async () => (await allPaneBuffers(app, 'section.pane[data-agent*="claude"]')).find((b) => /IDENT: \S+/.test(b.text ?? "")) ?? null, 40000, 800);
  const ident = pane?.text.match(/IDENT: (\S+)/)?.[1];
  let who = null;
  try {
    who = JSON.parse(Buffer.from(ident, "base64").toString("utf8"));
  } catch {
    who = null;
  }
  log(`pane identity: paneKey=${who?.paneKey} terminal=${who?.terminal}`);
  check("setup: the Claude pane's hook identity is known", !!who?.paneKey && !!who?.terminal, `identity ${who ? "decoded" : "missing"}`);
  const file = endpointFile(app.paths.roaming, who?.terminal);
  const [port, token] = file ? readFileSync(file, "utf8").trim().split(/\s+/) : [];
  log(`hook endpoint file found: ${!!file}; port=${port}`);
  check("setup: the hook server endpoint is known", !!port && !!token, `port=${port}`);
  if (!who || !port || !token) return;

  // The pane stops on a usage limit that resets in 8 seconds.
  const headers = { "x-kolux-token": token, "x-kolux-pane": Buffer.from(JSON.stringify({ paneKey: who.paneKey, terminal: who.terminal, hookVersion: 1 })).toString("base64") };
  const resetsAt = Date.now() + 8000;
  const s1 = await post(port, "/claude-status", headers, { session_id: "live-usage-007", context_window: {}, rate_limits: [{ kind: "five_hour", percentUsed: 100, resetsAt }] });
  const s2 = await post(port, "/claude", headers, { hook_event_name: "StopFailure", error: "rate_limit", error_details: "5-hour limit" });
  const t0 = Date.now();
  log(`posted /claude-status (five_hour 100% used, resets in 8 s) -> HTTP ${s1}; /claude StopFailure rate_limit -> HTTP ${s2}`);
  check("setup: the hook server accepted both reports", s1 === 200 && s2 === 200, `statuses ${s1}/${s2}`);
  log(`screenshot after the stop: ${await ctx.shot(`USAGE-007-${mode}-stopped`)}`);

  const gots = async () => ((await allPaneBuffers(app, 'section.pane[data-agent*="claude"]'))[0]?.text ?? "").split("\n").filter((l) => l.startsWith("GOT:"));
  if (mode === "on") {
    // Reset + 60 s delay, then the 15 s tick: the prompt appears.
    const hit = await poll(async () => ((await gots()).length ? true : null), 150000, 2000);
    const first = Math.round((Date.now() - t0) / 1000);
    await sleep(45000);
    const list = await gots();
    log(`control: first GOT line after ${hit ? first : "never"} s; GOT lines after a further 45 s: ${list.length}; text matches the continue prompt: ${list.every((l) => l.includes(PROMPT_WORDS))}`);
    check("control (switch on): the continue prompt is typed once, about a minute after the reset", !!hit && first >= 60 && first <= 110 && list.length === 1 && list[0].includes(PROMPT_WORDS), `after ${first} s, ${list.length} line(s)`);
  } else {
    // Wait well past reset + 60 s + two ticks, then some more.
    await sleep(150000);
    const list = await gots();
    const buf = (await allPaneBuffers(app, 'section.pane[data-agent*="claude"]'))[0]?.text ?? "";
    log(`switch off: ${Math.round((Date.now() - t0) / 1000)} s after the stop (reset +${Math.round((Date.now() - resetsAt) / 1000)} s); GOT lines: ${list.length}; the continue prompt anywhere in the pane: ${buf.includes("usage limit has reset")}`);
    check("switch off: nothing was typed into the pane", list.length === 0 && !buf.includes("usage limit has reset"), `GOT lines=${list.length}`);
  }
  log(`screenshot end: ${await ctx.shot(`USAGE-007-${mode}-end`)}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] === "on" ? "on" : "off";
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain(`USAGE-007-${mode}`, { report: rep, standin: STANDIN, settings: mode === "on" ? { claudeResumeAfterLimit: true } : {} });
    log(`mode ${mode}: claudeResumeAfterLimit ${mode === "on" ? "true" : "unset (default)"}; real agent programs at start: ${JSON.stringify(await ctx.realAgents())}`);
    await sleep(3000);
    await run007(ctx, mode, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, `USAGE-007-${mode}`, ev, ok) : 1);
}
