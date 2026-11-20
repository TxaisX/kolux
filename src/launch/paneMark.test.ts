// FIX-3: the pane mark, with real catalogue ids and real program paths, and the one credit rule shared with Rust.
import { expect, test } from "vitest";
import { CREDIT_NAMES, creditedAgent, creditedProgram, markFor, paneMark, programMark } from "./paneMark";
import { markFor as markForViaMenu } from "./PlusMenu";
import rustSource from "../../src-tauri/src/agents.rs?raw";
import toolsSource from "../../src-tauri/src/tools.rs?raw";
import { windowSource as appSource } from "../test/windowSource";

const rust = rustSource.replace(/\r/g, "");
const tools = toolsSource.replace(/\r/g, "");

/** The test module of a Rust file: from its last `#[cfg(test)]` to the end, without whole-line comments. */
const testModule = (src: string) =>
  src
    .slice(src.lastIndexOf("#[cfg(test)]"))
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
/** A Rust string literal as written in source (plain with escapes, r"..." or r#"..."#). */
const STR = String.raw`(?:r#"(.*?)"#|r"(.*?)"|"((?:[^"\\]|\\.)*)")`;
const unescape = (s: string) => s.replace(/\\(.)/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === "0" ? "\0" : c));
/** Escapes `unescape` cannot read: `\u{..}` and `\x..` (a parsed literal holding one is a failure, not a silently wrong input). */
const unreadable = (s: string) => [...s.matchAll(/\\(.)/g)].some((m) => m[1] === "u" || m[1] === "x");
/**
 * Every `assert_eq!(<fn>(<literal>), None|Some("..."))` in a Rust test module, how many uses of `<fn>` that module holds
 * (a call, or a function pointer such as `.map(<fn>)`: any whole-word use), and the parsed literals it cannot read.
 */
function rustCases(src: string, fn: string): { cases: [string, string | null][]; calls: number; unreadable: string[] } {
  const mod = testModule(src);
  const re = new RegExp(String.raw`assert_eq!\(${fn}\(${STR}\), (?:None|Some\("(.*?)"\))`, "g");
  const found = [...mod.matchAll(re)];
  const cases = found.map((m): [string, string | null] => [m[1] ?? m[2] ?? unescape(m[3] ?? ""), m[4] ?? null]);
  return {
    cases,
    calls: [...mod.matchAll(new RegExp(String.raw`\b${fn}\b`, "g"))].length,
    unreadable: found.filter((m) => m[3] !== undefined && unreadable(m[3])).map((m) => m[3]),
  };
}

/** The pane-building calls in App.tsx: every `paneMark(` argument list, and every `markFor(` argument list, balanced. */
function calls(source: string, name: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(new RegExp(String.raw`\b${name}\(`, "g"))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < source.length && depth > 0; i++) depth += source[i] === "(" ? 1 : source[i] === ")" ? -1 : 0;
    out.push(source.slice(from, i - 1));
  }
  return out;
}
/** What the guard demands of an App.tsx text: `paneMark(a|agent, line)` at 3+ sites, and no `markFor(` that names an agent. Returns the reasons it fails. */
function guardFailures(app: string): string[] {
  const bad: string[] = [];
  const marks = calls(app, "paneMark");
  if (marks.length < 3) bad.push(`only ${marks.length} paneMark( sites`);
  for (const c of marks) if (!/^\s*(?:a|agent)\s*,\s*line\s*$/.test(c)) bad.push(`paneMark(${c})`);
  for (const c of calls(app, "markFor")) if (/\b(?:a|agent)\b/.test(c)) bad.push(`markFor(${c})`);
  return bad;
}

test("FIX-3: the real catalogue ids take the mark of the program their Command names", () => {
  // OpenClaude, Gemini and the rest never have a custom id: the Command field is the only route.
  expect(markFor("openclaude", "C:\\tools\\claude.exe")).toBe("claude");
  expect(markFor("openclaude", "claude")).toBe("claude");
  expect(markFor("openclaude", "C:\\Users\\me\\AppData\\Roaming\\npm\\Claude.CMD")).toBe("claude");
  expect(markFor("gemini", "/usr/local/bin/codex")).toBe("codex");
  expect(markFor("aider", "codex.exe")).toBe("codex");
  expect(markFor("gemini", "C:\\tools\\codex-nightly.exe")).toBe("codex");
  // Their own programs stay the plain shell glyph, and so does a Command that is not Claude or Codex.
  expect(markFor("openclaude", "openclaude")).toBe("shell");
  expect(markFor("gemini", "gemini")).toBe("shell");
  expect(markFor("gemini", "pwsh")).toBe("shell");
  expect(markFor("gemini", null)).toBe("shell");
  expect(markFor("gemini")).toBe("shell");
  // Built-in ids keep their marks whatever program is passed; the menu re-exports the same function.
  expect(markFor("claude", "pwsh")).toBe("claude");
  expect(markFor("codex", "claude")).toBe("codex");
  // T-335-b: Copilot and Cursor carry their own marks without driving the Claude-only pane logic.
  expect(markFor("copilot", "pwsh")).toBe("copilot");
  expect(markFor("cursor", "pwsh")).toBe("cursor");
  expect(markFor("openclaude", "pwsh")).toBe("shell");
  expect(markForViaMenu).toBe(markFor);
});

test("FIX-3: a program is read as a command line, the way Rust credits it", () => {
  expect(markFor("openclaude", "claude --x")).toBe("claude");
  expect(markFor("openclaude", "claude.exe --permission-mode auto")).toBe("claude");
  expect(markFor("openclaude", "  codex   --sandbox x")).toBe("codex");
  expect(markFor("openclaude", '"C:\\Program Files\\Claude\\claude.exe" --x')).toBe("claude");
  expect(markFor("openclaude", '"claude"')).toBe("claude");
  expect(markFor("gemini", "node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js")).toBe("claude");
  expect(markFor("gemini", "node /usr/lib/node_modules/@openai/codex/bin/codex.js")).toBe("codex");
  // FIX-4: a spawn program is read quoted first, then as a line (tools.rs credited_program), so the
  // one launchable form with a space, a bare path, is credited. With arguments after an unquoted
  // path the cut is ambiguous and stays uncredited, the same as in Rust.
  expect(markFor("openclaude", "C:\\Program Files\\Claude\\claude.exe")).toBe("claude");
  expect(markFor("openclaude", "C:\\Program Files\\nodejs\\codex.cmd")).toBe("codex");
  expect(markFor("openclaude", "C:\\Program Files\\Claude\\claude.exe --x")).toBe("shell");
  expect(markFor("openclaude", "C:\\Program Files\\Tools\\notclaude.exe")).toBe("shell");
  // Look-alikes and other agents stay shell.
  expect(markFor("gemini", "claude-helper")).toBe("shell");
  expect(markFor("gemini", "claude-teams")).toBe("shell");
  expect(markFor("gemini", "notclaude.exe")).toBe("shell");
  expect(markFor("gemini", "C:\\claude\\run.exe")).toBe("shell");
  expect(markFor("gemini", "node build.js")).toBe("shell");
  expect(markFor("gemini", "python -m aider --model x")).toBe("shell");
  expect(programMark("")).toBe("shell");
  expect(programMark(undefined)).toBe("shell");
});

test("FIX-3: paneMark, the helper every pane-building site uses, follows the start line before the catalogue", () => {
  const openclaude = { id: "openclaude", program: "openclaude" };
  // The start line carries the Command the user set; the catalogue program alone would lose it.
  expect(paneMark(openclaude, { program: "C:\\tools\\claude.exe" })).toBe("claude");
  expect(paneMark(openclaude, { program: "codex" })).toBe("codex");
  expect(paneMark(openclaude, { program: "claude --x" })).toBe("claude");
  // No program on the line: the catalogue's own.
  expect(paneMark(openclaude, { program: null })).toBe("shell");
  expect(paneMark(openclaude, {})).toBe("shell");
  expect(paneMark({ id: "claude", program: "claude" }, { program: null })).toBe("claude");
  expect(paneMark({ id: "codex", program: "codex" }, { program: "pwsh" })).toBe("codex");
  expect(paneMark({ id: "gemini", program: "gemini" }, { program: "pwsh" })).toBe("shell");
});

test("FIX-3: App.tsx builds every pane mark from the start line's program", () => {
  // FIX-4: exactly paneMark(a, line) / paneMark(agent, line) at 3+ sites, and no markFor( call that names an agent.
  expect(guardFailures(appSource.replace(/\r/g, ""))).toEqual([]);
});

test("FIX-4: the App.tsx guard rejects the forms that would lose the Command override", () => {
  const good = "paneMark(a, line) paneMark(agent, line) paneMark(a, line)";
  expect(guardFailures(good)).toEqual([]);
  // The catalogue program wins over the line's: the Command never shows.
  expect(guardFailures(`${good} markFor(a.id, a.program ?? line.program)`)).toEqual(["markFor(a.id, a.program ?? line.program)"]);
  expect(guardFailures(`${good} markFor(agent.id, (line.program ?? agent.program))`)).toEqual(["markFor(agent.id, (line.program ?? agent.program))"]);
  expect(guardFailures("paneMark(a, line) paneMark(a, line.program) paneMark(agent, line)")).toEqual(["paneMark(a, line.program)"]);
  expect(guardFailures("paneMark(a, line) paneMark(agent, line)")).toEqual(["only 2 paneMark( sites"]);
  // Other markFor( uses (a rail footer from an id) are not pane builds.
  expect(guardFailures(`${good} markFor(railPick.agentId ?? "")`)).toEqual([]);
});

test("FIX-3: creditedAgent runs every case agents.rs asserts for credited_agent, and every call is parsed", () => {
  const { cases, calls, unreadable } = rustCases(rust, "credited_agent");
  expect(unreadable, "no u{..} or x.. escape in a parsed literal").toEqual([]);
  expect(cases.length).toBeGreaterThanOrEqual(16);
  // An assert written another way (a variable, assert!(..is_none())) must not be skipped silently.
  expect(cases.length, "every credited_agent( call in agents.rs tests is an assert_eq! with a literal this parser reads").toBe(calls);
  for (const [input, want] of cases) {
    expect(creditedAgent(input), `credited_agent(${JSON.stringify(input)})`).toBe(want);
  }
});

test("FIX-4: creditedProgram runs every case tools.rs asserts for credited_program, and every call is parsed", () => {
  const { cases, calls, unreadable } = rustCases(tools, "credited_program");
  expect(unreadable, "no u{..} or x.. escape in a parsed literal").toEqual([]);
  expect(cases.length).toBeGreaterThanOrEqual(20);
  expect(cases.length, "every credited_program( call in tools.rs tests is an assert_eq! with a literal this parser reads").toBe(calls);
  for (const [input, want] of cases) {
    expect(creditedProgram(input), `credited_program(${JSON.stringify(input)})`).toBe(want);
  }
});

test("FIX-4: the Rust assert parser reads escapes and counts calls it cannot read", () => {
  const src = 'x\n#[cfg(test)]\nmod t { fn a() { assert_eq!(f("a\\\\b\\"c"), Some("claude")); assert_eq!(f(r"C:\\x"), None); let v = f(var); assert!(f("z").is_none()); } }';
  const { cases, calls } = rustCases(src, "f");
  expect(cases).toEqual([['a\\b"c', "claude"], ["C:\\x", null]]);
  expect(calls).toBe(4);
  // FIX-5: a function-pointer use is counted (so it is not skipped); a \u{..} or \x.. escape in a parsed literal is reported, an escaped backslash before x is not one.
  const ptr = 'x\n#[cfg(test)]\nmod t { fn a() { assert_eq!(f("a"), None); let v = [1].map(f); } }';
  expect(rustCases(ptr, "f").calls).toBe(2);
  expect(rustCases(ptr, "f").cases.length).toBe(1);
  const esc = String.raw`x
#[cfg(test)]
mod t { fn a() { assert_eq!(f("\u{41}"), None); assert_eq!(f("\x41"), None); assert_eq!(f("a\\x"), None); assert_eq!(f(r"\x"), None); } }`;
  expect(rustCases(esc, "f").unreadable).toEqual([String.raw`\u{41}`, String.raw`\x41`]);
});

test("FIX-5: creditedProgram reads a line only when its first word is a bare name, otherwise the whole path", () => {
  expect(creditedProgram(String.raw`C:\Users\Grok Fan\bin\tool.exe`)).toBeNull();
  expect(creditedProgram(String.raw`C:\Users\Codex Fan\tools\x.exe`)).toBeNull();
  expect(creditedProgram(String.raw`D:\Apps\Claude Code\launcher.exe`)).toBeNull();
  expect(creditedProgram(String.raw`codex --cd C:\work\claude`)).toBe("codex");
  expect(creditedProgram(String.raw`claude C:\tools\codex.cmd`)).toBe("claude");
  expect(creditedProgram("/opt/Grok Tools/grok")).toBe("grok");
  expect(creditedProgram(String.raw`C:\Program Files\Claude\claude.exe`)).toBe("claude");
  // A Command like this must not draw another agent's mark: the folder name is not the program.
  expect(markFor("openclaude", String.raw`C:\Users\Codex Fan\tools\x.exe`)).toBe("shell");
  expect(markFor("openclaude", String.raw`codex --cd C:\work\claude`)).toBe("codex");
});

test("FIX-4: creditedAgent is exact outside ASCII the way Rust is: its whitespace set, ASCII-only lowercase", () => {
  // Rust char::is_whitespace includes U+0085 and not U+FEFF; JS \s is the other way round.
  expect(creditedAgent("\u0085claude")).toBe("claude");
  expect(creditedAgent("claude\u0085--x")).toBe("claude");
  expect(creditedAgent("claude\u00a0--x")).toBe("claude");
  expect(creditedAgent("\u3000claude")).toBe("claude");
  expect(creditedAgent("\ufeffclaude")).toBeNull();
  expect(creditedAgent("node\u0085C:\\x\\claude-code\\cli.js")).toBe("claude");
  // to_ascii_lowercase leaves the Kelvin sign alone; JS toLowerCase folds it to k.
  expect(creditedAgent("\u212Airo-cli")).toBeNull();
  expect(creditedAgent("KIRO-CLI")).toBe("kiro");
  expect(markFor("openclaude", "\ufeffclaude")).toBe("shell");
});

test("FIX-3: the program-name table matches the catalogue in agents.rs, in order", () => {
  const body = rust.slice(rust.indexOf("pub const CATALOGUE"), rust.indexOf("/// The catalogue with each agent"));
  const rows = [...body.matchAll(/^\s*\("([a-z-]+)", "[^"]*", &\[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((n) => n[1])]);
  expect(rows.length).toBe(35); // T-572: OpenCode is back in the catalogue
  expect(CREDIT_NAMES.map(([id, names]) => [id, [...names]])).toEqual(rows);
});
