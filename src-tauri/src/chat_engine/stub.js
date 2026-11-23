// Test stand-in for `claude -p --input-format stream-json --output-format stream-json --verbose`,
// run by the chat engine's process tests through node. It never calls a model or reads a config
// folder. It first prints a `stub_args` line (its arguments and two environment variables) so a
// test can check the command line, then an init message, then answers each user message:
// - a message starting with "slow" starts a turn that only an interrupt ends;
// - a message starting with "hold" gets an assistant reply but no result until the next user message
//   arrives; then the held result is printed and the new message is answered 300 ms later (a message
//   the user wrote while a turn was still running, queued the way Claude Code queues it);
// - a message starting with "queue" starts a turn that only an interrupt ends; messages arriving while
//   it runs are queued. The interrupt ends the turn 300 ms later; with "cancel_queued": true it drops the
//   queued messages (their results never come), without it they are answered after the turn's result,
//   as Claude Code does (checked live 2026-11-23). A message arriving after the interrupt is a new one;
// - a message starting with "late" is answered 800 ms after it arrives;
// - a message containing "[big]" reports a 500,000-token prompt, any other 1 token;
// - any other message gets an assistant echo and a success result.
// An interrupt control request ends a slow turn with an error_during_execution result, unless
// STUB_IGNORE_INTERRUPT=1 (to test the engine's fallback of ending the process).
const readline = require("node:readline");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const session = flag("--resume") ?? `stub-session-${process.pid}`;
const deaf = process.env.STUB_IGNORE_INTERRUPT === "1";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

out({ type: "stub_args", args, bare_env: process.env.CLAUDE_CODE_SIMPLE ?? null, config_dir: process.env.CLAUDE_CONFIG_DIR ?? null });
out({ type: "system", subtype: "init", session_id: session, cwd: process.cwd(), model: flag("--model") ?? "stub-model", permissionMode: flag("--permission-mode"), tools: ["Read"], slash_commands: [], skills: [], plugins: [], mcp_servers: [] });
process.stderr.write("stub ready\n");

let slow = false;
let held = null;
let queueing = false;
let queued = [];
const usage = (text) => ({ input_tokens: text.includes("[big]") ? 500000 : 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 });
const done = (text) => out({ type: "result", subtype: "success", is_error: false, result: `echo: ${text}`, session_id: session, num_turns: 1, duration_ms: 5, total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [] });
const answer = (text, images) => {
  if (text.startsWith("queue")) {
    queueing = true;
    out({ type: "assistant", session_id: session, parent_tool_use_id: null, message: { id: "msg-queue", model: "stub-model", content: [{ type: "text", text: "queueing" }], usage: usage(text) } });
    return;
  }
  if (text.startsWith("late")) {
    setTimeout(() => answer(text.slice(4), images), 800);
    return;
  }
  if (text.startsWith("slow")) {
    slow = true;
    out({ type: "assistant", session_id: session, parent_tool_use_id: null, message: { id: "msg-slow", model: "stub-model", content: [{ type: "text", text: "working" }] } });
    return;
  }
  if (text.startsWith("hold")) {
    held = text;
    out({ type: "assistant", session_id: session, parent_tool_use_id: null, message: { id: "msg-hold", model: "stub-model", content: [{ type: "text", text: "holding" }], usage: usage(text) } });
    return;
  }
  out({ type: "assistant", session_id: session, parent_tool_use_id: null, message: { id: "msg-echo", model: "stub-model", content: [{ type: "text", text: `echo: ${text} (${images} images)` }], usage: usage(text) } });
  done(text);
};
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === "user") {
    const content = m.message?.content ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    const images = content.filter((c) => c.type === "image").length;
    if (queueing) {
      queued.push([text, images]);
      return;
    }
    if (held !== null) {
      done(held);
      held = null;
      setTimeout(() => answer(text, images), 300);
      return;
    }
    answer(text, images);
  } else if (m.type === "control_request" && m.request?.subtype === "interrupt") {
    if (deaf) return;
    out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
    const interrupted = () => out({ type: "result", subtype: "error_during_execution", is_error: true, session_id: session, errors: ["interrupted"], permission_denials: [] });
    if (queueing) {
      queueing = false;
      const left = m.request.cancel_queued === true ? [] : queued;
      queued = [];
      setTimeout(() => {
        interrupted();
        for (const [text, images] of left) answer(text, images);
      }, 300);
    } else if (slow) {
      slow = false;
      interrupted();
    }
  }
});
rl.on("close", () => process.exit(0));
