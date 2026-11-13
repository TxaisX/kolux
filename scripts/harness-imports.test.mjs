// Static guards for the harness itself: the lane that tests Kolux is not covered by Kolux's tests, and a live proof
// only reveals a broken helper when someone finally launches the app (which cost this lane three rounds).
//
// Check 1 — every named import from a local module is really exported by it, and every relative import resolves.
// Check 2 — no shared constant is used without being declared or imported in that file. This is the check that would
// have caught the round-4 bug: scripts/prove/live-common.mjs used `TID` thirteen times and declared it nowhere, so
// `startPlain()` threw "TID is not defined" for every live proof, and nothing noticed because no run had happened.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");

/** Every .mjs under scripts/ (tests included: they import the same helpers). */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "target" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const files = walk(SCRIPTS);
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** Names a module exports: its own declarations, `export { a, b as c }`, and whatever it re-exports with `export * from`. */
function exportsOf(file, seen = new Set()) {
  const text = source.get(file);
  if (!text || seen.has(file)) return new Set();
  seen.add(file);
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias) names.add(alias);
    }
  }
  // `export * from "./x.mjs"`: the common modules (live-git-common, live-proj-common) are thin re-export skins.
  for (const m of text.matchAll(/^export\s*\*\s*from\s*["']([^"']+)["']/gm)) {
    if (!m[1].startsWith(".")) continue;
    for (const name of exportsOf(resolve(dirname(file), m[1]), seen)) names.add(name);
  }
  return names;
}

/** The file with comments and string/template literals blanked out, so only real code identifiers remain. */
function code(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") i++;
        i++;
      }
      out += '""';
    } else out += c;
  }
  return out;
}

/** `import { a, b as c } from "./x.mjs"` — the local ones only, with the names the importer expects. */
function namedImports(text) {
  const out = [];
  for (const m of text.matchAll(/^import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) {
    if (!m[2].startsWith(".")) continue;
    const names = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean);
    out.push({ spec: m[2], names });
  }
  return out;
}

/** Names the file declares itself (any binding form that can define a module-scope name). */
function declares(text, name) {
  const n = name.replace(/[$]/g, "\\$");
  return new RegExp(`(?:\\b(?:const|let|var|function|class)\\s+${n}\\b)|(?:\\b${n}\\s*[,=])|(?:\\b(?:const|let|var)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=)`).test(text);
}

/** Names the file imports (named or default-aliased). */
function importsName(text, name) {
  for (const m of text.matchAll(/^import\s+([\s\S]*?)\s+from\s*["'][^"']+["']/gm)) {
    const clause = m[1];
    if (new RegExp(`\\b${name}\\b`).test(clause)) return true;
  }
  return false;
}

// Globals a Node script may use without declaring: the standard library's all-caps names, and the harness's own
// environment words (PROVE_*, KOLUX_* are read through process.env, never as bare names).
const GLOBALS = new Set(["JSON", "URL", "Math", "Date", "Object", "Array", "String", "Number", "Boolean", "RegExp", "Error", "Map", "Set", "Promise", "Symbol", "BigInt", "Infinity", "NaN", "EOF"]);

describe("proofs that are imported must not launch the app", () => {
  test("a proof another proof imports carries a main guard", () => {
    // A proof runs its body at module level, so importing one for a helper would launch an app as a side effect.
    // The convention is the `if (import.meta.url === pathToFileURL(process.argv[1]).href) { … }` guard around the body;
    // this makes it a rule instead of a habit (the audit found 41 proofs without one, and only the imported ones matter).
    const imported = new Set();
    for (const [file, text] of source) {
      for (const { spec } of namedImports(text)) imported.add(resolve(dirname(file), spec));
    }
    const unguarded = [];
    for (const file of imported) {
      const text = source.get(file);
      if (!text) continue;
      const launches = /(^|\n)\s*await start(?:Plain|Prove|Claude)\(/.test(text);
      const guarded = /pathToFileURL\(process\.argv\[1\]\)/.test(text);
      if (launches && !guarded) unguarded.push(relative(ROOT, file));
    }
    expect(unguarded).toEqual([]);
  });
});

describe("harness imports", () => {
  test("every local import resolves to a file", () => {
    const missing = [];
    for (const [file, text] of source) {
      for (const { spec } of namedImports(text)) {
        const target = resolve(dirname(file), spec);
        if (!source.has(target) && !files.includes(target)) {
          try {
            statSync(target);
          } catch {
            missing.push(`${relative(ROOT, file)} → ${spec}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("every named import is exported by the module it comes from", () => {
    const bad = [];
    for (const [file, text] of source) {
      for (const { spec, names } of namedImports(text)) {
        const target = resolve(dirname(file), spec);
        const targetText = source.get(target);
        if (!targetText) continue; // a missing file is the check above
        const have = exportsOf(target);
        for (const name of names) if (!have.has(name)) bad.push(`${relative(ROOT, file)} imports ${name} from ${spec}, which does not export it`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("a shared constant is never used without being declared or imported", () => {
    // Only ALL-CAPS names, and only where they are used as a value: `TID.x`, `TERM)`, `LIVE_LOGS,`. Lowercase and
    // mixed-case identifiers (JSON, URL) are excluded, and so is anything the file declares or imports.
    const bad = [];
    for (const [file, text] of source) {
      const codeText = code(text);
      const used = new Set();
      // Only member access on an ALL-CAPS name (`TID.addProject`, `LIVE_LOGS`): that is a constant used as a
      // namespace, which is exactly the shape a missing import takes. Bare ALL-CAPS words are too often prose,
      // a status string or a `process.env` key to be worth flagging, and `NAME.md` in a comment or a string is a
      // filename. (A constant used only inside a template literal's `${}` is not seen — strings are blanked; every
      // real case also appears bare, as `TID` did.)
      for (const m of codeText.matchAll(/(^|[^\w$.])([A-Z][A-Z0-9_]{2,})\s*\.([A-Za-z0-9_]+)/g)) {
        if (/^(?:md|txt|json|json5|png|jpg|log|mjs|cjs|ts|tsx|js|jsx|ps1|exe|out|yml|yaml|toml|css|html|svg|rs)$/i.test(m[3])) continue; // a filename
        used.add(m[2]);
      }
      for (const name of used) {
        if (GLOBALS.has(name) || declares(codeText, name) || importsName(text, name)) continue;
        bad.push(`${relative(ROOT, file)}: ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
