// The agent stand-ins scripts/evidence/smoke.mjs puts in front of the app's PATH: one .cmd per agent that prints a
// banner, then reads one line at a time from its own pane and appends it to marks/agent-<id>.txt. A smoke check can
// then prove a pane took input with no AI account, no sign-in and no network call.
//
// Claude's also posts the SessionStart + UserPromptSubmit hook events Kolux's installed hook script (hooks.rs) posts,
// through the same endpoint file and curl call, so flow 4's status dot turns Working from a stand-in.
//
// Nothing here launches anything: the functions write files and return their paths, so the generated batch files can
// be tested without an app (scripts/evidence/smoke-standins.test.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The agents flow 6 starts from the New session menu, in menu order, with the label the menu shows. */
export const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "opencode", label: "OpenCode" },
];

/** Where a stand-in appends the lines its pane sends. */
export const agentLog = (marks, id) => join(marks, `agent-${id}.txt`);

/** The read loop as batch lines: set /p takes the line the pane sends, a line that arrived is appended to the log. */
const echoLoop = (logFile) => [":loop", 'set "L="', "set /p L=", "if not defined L goto loop", `>>"${logFile}" echo %L%`, "goto loop"];

/** The curl post of one hook event JSON file, with the same headers Kolux's installed hook script sends. */
const hookPost = (file) =>
  `type "%~dp0${file}" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;

/**
 * Writes the stand-in for one agent and returns its path.
 * dir: where the .cmd files go (put at the front of the app's PATH). marks: where received lines are logged.
 * repo: the scratch repo the hook events name as their cwd.
 */
export function standinFile(id, { dir, marks, repo }) {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`no stand-in for agent "${id}" (known: ${AGENTS.map((a) => a.id).join(", ")})`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(marks, { recursive: true });
  const file = join(dir, `${id}.cmd`);
  let lines;
  if (id === "claude") {
    const event = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "smoke-standin", cwd: repo, ...extra });
    writeFileSync(join(dir, "session-start.json"), event("SessionStart", { source: "startup" }));
    writeFileSync(join(dir, "prompt.json"), event("UserPromptSubmit", { prompt: "smoke: turn the dot to Working" }));
    lines = [
      "@echo off",
      "echo Kolux smoke stand-in for Claude Code (T-542): posts the hook events a session would.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      hookPost("session-start.json"),
      hookPost("prompt.json"),
      "echo hook events posted; reading lines",
    ];
  } else {
    lines = ["@echo off", `echo Kolux smoke stand-in for ${agent.label}: reads lines, calls nothing`];
  }
  writeFileSync(file, [...lines, ...echoLoop(agentLog(marks, id)), ""].join("\r\n"));
  return file;
}

/** Every agent stand-in written; returns { agent id: path }. */
export function writeStandins(paths) {
  return Object.fromEntries(AGENTS.map((a) => [a.id, standinFile(a.id, paths)]));
}

/**
 * Points agentOptions.<agent>.command at the stand-ins for `ids` (default: claude only) through the app's
 * settings_patch, and returns an async function that puts the old agentOptions back.
 */
export async function standinsOn(invoke, paths, ids = ["claude"]) {
  const files = Object.fromEntries(ids.map((id) => [id, standinFile(id, paths)]));
  const old = await invoke("get_settings");
  const had = old && typeof old === "object" && "agentOptions" in old;
  const base = (had ? old.agentOptions : null) ?? {};
  const agentOptions = { ...base };
  for (const [id, command] of Object.entries(files)) agentOptions[id] = { ...(base[id] ?? {}), command };
  await invoke("settings_patch", { set: { agentOptions }, remove: [] });
  return async () => {
    if (had) await invoke("settings_patch", { set: { agentOptions: old.agentOptions }, remove: [] }).catch(() => {});
    else await invoke("settings_patch", { set: {}, remove: ["agentOptions"] }).catch(() => {});
  };
}
