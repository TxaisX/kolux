// T-591 (brief Phase 1): every command the front end invokes by name is one lib.rs registers. A name
// in an invoke("...") call in src/ (tests aside) that generate_handler! does not list fails only when
// that code runs ("command ... not found"); this check fails at the gate instead.
//   node scripts/invoke-contract.mjs        exit 0 = OK, 1 = unknown names listed
// T-811: a name passed in a variable goes through invokeNamed(name: CommandName) in src/ipc/commands.ts;
// the type keeps the name inside NAMED_COMMANDS, and this check reads that list against generate_handler!
// too. Calls that still pass a plain variable to invoke are counted, not checked.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDLER = "generate_handler![";

/** The command names lib.rs registers: the last segment of each path in generate_handler![...]. */
export function registered(libRs) {
  const at = libRs.indexOf(HANDLER);
  if (at < 0) throw new Error("src-tauri/src/lib.rs has no generate_handler![...]");
  const list = libRs.slice(at + HANDLER.length).replace(/\/\/[^\n]*|#\[[^\]]*\]/g, ""); // comments, #[cfg(...)]
  return new Set(list.slice(0, list.indexOf("]")).split(",").map((p) => p.trim().split("::").pop()).filter(Boolean));
}

/** The literal command names `text` invokes, with their lines; `dynamic` counts calls whose name is not a literal. */
export function invoked(text) {
  const names = [];
  let dynamic = 0;
  for (const m of text.matchAll(/\binvoke\s*(?=[<(])/g)) {
    let i = m.index + m[0].length;
    // Type arguments nest, and the `>` of a function type's `=>` closes nothing.
    for (let depth = 0; text[i] === "<" || depth > 0; i++) {
      if (text[i] === "<") depth++;
      else if (text[i] === ">" && text[i - 1] !== "=") depth--;
      if (i >= text.length) break;
    }
    const arg = /^\s*\(\s*(?:(["'])([^"'\n]*)\1)?/.exec(text.slice(i));
    if (!arg) continue; // `invoke<T>` as a type, not a call
    if (arg[2] === undefined) dynamic++;
    else if (!arg[2].startsWith("plugin:")) names.push({ name: arg[2], line: text.slice(0, m.index).split("\n").length });
  }
  return { names, dynamic };
}

/** The names src/ipc/commands.ts lists in NAMED_COMMANDS, with their lines; empty when the file is absent. */
export function listed(text) {
  const at = text.indexOf("NAMED_COMMANDS = [");
  if (at < 0) return [];
  const end = text.indexOf("] as const", at);
  const out = [];
  for (const m of text.slice(at, end).matchAll(/"([^"\n]+)"/g)) out.push({ name: m[1], line: text.slice(0, at + m.index).split("\n").length });
  return out;
}

/** Unknown names as `name (file:line)`, with how many literal names were checked and how many were dynamic. */
export function check(root = ROOT) {
  const known = registered(fs.readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8"));
  const src = path.join(root, "src");
  const files = fs.readdirSync(src, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|[\\/])__cards__[\\/]/.test(f));
  const out = { unknown: [], checked: 0, dynamic: 0, registered: known.size };
  const NAMES = "ipc/commands.ts";
  for (const f of files.sort()) {
    if (f.replaceAll("\\", "/") === NAMES) continue; // its one invoke(name, args) is the typed wrapper
    const found = invoked(fs.readFileSync(path.join(src, f), "utf8"));
    out.dynamic += found.dynamic;
    out.checked += found.names.length;
    for (const { name, line } of found.names) if (!known.has(name)) out.unknown.push(`${name} (src/${f.replaceAll("\\", "/")}:${line})`);
  }
  const map = path.join(src, NAMES);
  if (fs.existsSync(map)) {
    const names = listed(fs.readFileSync(map, "utf8"));
    out.mapped = names.length;
    out.checked += names.length;
    for (const { name, line } of names) if (!known.has(name)) out.unknown.push(`${name} (src/${NAMES}:${line})`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = check();
  for (const u of r.unknown) console.error(`not a registered command: ${u}`);
  console.log(`invoke-contract: ${r.checked} invoke calls by name against ${r.registered} registered commands (${r.mapped ?? 0} of them named in src/ipc/commands.ts; ${r.dynamic} pass a name in a variable, not checked)`);
  console.log(r.unknown.length ? "invoke-contract: FAILED" : "invoke-contract: OK");
  process.exit(r.unknown.length ? 1 : 0);
}
