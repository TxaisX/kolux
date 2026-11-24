// RED-02-AUDIT: which Rust files are pulled into the crate only by `mod` declarations marked
// `#[cfg(test)]`. The APP-070 privacy audit leaves those files out of its shipped-source scan.
import path from "node:path";

const isIdentStart = (c) => /[A-Za-z]/.test(c);
const isIdentPart = (c) => /[A-Za-z0-9_]/.test(c);

// The index just past a string literal that starts at `i`, or null when `i` is not one.
// Raw strings (r"..", r#".."#, br"..", cr"..") and ordinary strings are both handled.
const stringEnd = (text, i) => {
  if (i > 0 && isIdentPart(text[i - 1])) return null;
  const c = text[i];
  let j = i;
  let raw = false;
  if (c === "b" || c === "c") {
    if (text[j + 1] === "r" && (text[j + 2] === '"' || text[j + 2] === "#")) {
      raw = true;
      j += 2;
    } else if (text[j + 1] === '"') {
      j += 1;
    } else {
      return null;
    }
  } else if (c === "r" && (text[j + 1] === '"' || text[j + 1] === "#")) {
    raw = true;
    j += 1;
  } else if (c !== '"') {
    return null;
  }
  if (raw) {
    let hashes = 0;
    while (text[j] === "#") {
      hashes += 1;
      j += 1;
    }
    if (text[j] !== '"') return null;
    const close = '"' + "#".repeat(hashes);
    const end = text.indexOf(close, j + 1);
    return end === -1 ? text.length : end + close.length;
  }
  j += 1;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text[j] === '"') return j + 1;
    j += 1;
  }
  return text.length;
};

// The index just past a character literal that starts at `i`, or null when `i` is a lifetime.
const charEnd = (text, i) => {
  let j = i + 1;
  if (j >= text.length) return null;
  if (text[j] === "\\") {
    j += 2;
    while (j < text.length) {
      if (text[j] === "\\") {
        j += 2;
        continue;
      }
      if (text[j] === "'") return j + 1;
      j += 1;
    }
    return null;
  }
  return text[j + 1] === "'" ? j + 2 : null;
};

// A small Rust tokenizer: comments and whitespace are dropped, strings and characters are kept
// as single tokens so a `mod` written inside either is never mistaken for code.
const tokenize = (text) => {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const end = stringEnd(text, i);
    if (end !== null) {
      tokens.push({ type: "string", start: i, end });
      i = end;
      continue;
    }
    if (c === "'") {
      const char = charEnd(text, i);
      if (char !== null) {
        tokens.push({ type: "char", start: i, end: char });
        i = char;
        continue;
      }
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j])) j += 1;
      tokens.push({ type: "lifetime", start: i, end: j });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j])) j += 1;
      tokens.push({ type: "ident", start: i, end: j, value: text.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ type: "punct", start: i, end: i + 1, value: c });
    i += 1;
  }
  return tokens;
};

// The index of the token that closes the delimiter opened at `open`.
const closeOf = (tokens, open, left, right) => {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== "punct") continue;
    if (t.value === left) depth += 1;
    else if (t.value === right) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
};

// Every `mod name;` declaration in the text, with the attributes written directly above it.
const declarationsIn = (text) => {
  const tokens = tokenize(text);
  const out = [];
  let nesting = 0;
  let pending = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "punct" && t.value === "#") {
      const next = tokens[i + 1];
      if (next && next.type === "punct" && next.value === "!") {
        i = tokens[i + 2] && tokens[i + 2].value === "[" ? closeOf(tokens, i + 2, "[", "]") + 1 : i + 1;
        continue;
      }
      if (next && next.type === "punct" && next.value === "[") {
        const close = closeOf(tokens, i + 1, "[", "]");
        if (nesting === 0) pending.push(text.slice(tokens[i + 1].end, tokens[close].start));
        i = close + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (t.type === "punct" && (t.value === "{" || t.value === "(" || t.value === "[")) {
      nesting += 1;
      pending = [];
      i += 1;
      continue;
    }
    if (t.type === "punct" && (t.value === "}" || t.value === ")" || t.value === "]")) {
      if (nesting > 0) nesting -= 1;
      pending = [];
      i += 1;
      continue;
    }
    if (t.type === "punct" && t.value === ";") {
      pending = [];
      i += 1;
      continue;
    }
    if (nesting === 0 && t.type === "ident" && t.value === "pub") {
      let j = i + 1;
      if (tokens[j] && tokens[j].type === "punct" && tokens[j].value === "(") j = closeOf(tokens, j, "(", ")") + 1;
      if (tokens[j] && tokens[j].type === "ident" && tokens[j].value === "mod") {
        const name = tokens[j + 1];
        const semi = tokens[j + 2];
        if (name && name.type === "ident" && semi && semi.type === "punct" && semi.value === ";") {
          out.push({ name: name.value, attrs: pending });
          pending = [];
          i = j + 3;
          continue;
        }
      }
      pending = [];
      i += 1;
      continue;
    }
    if (nesting === 0 && t.type === "ident" && t.value === "mod") {
      const name = tokens[i + 1];
      const semi = tokens[i + 2];
      if (name && name.type === "ident" && semi && semi.type === "punct" && semi.value === ";") {
        out.push({ name: name.value, attrs: pending });
        pending = [];
        i += 3;
        continue;
      }
      pending = [];
      i += 1;
      continue;
    }
    pending = [];
    i += 1;
  }
  return out;
};

const TEST_ONLY = /^cfg\s*\(\s*test\s*\)$/;
const PATH_ATTR = /^path\s*=\s*"([^"]*)"$/;

const isTestOnly = (decl) => decl.attrs.some((attr) => TEST_ONLY.test(attr.trim()));

const pathAttr = (decl) => {
  for (const attr of decl.attrs) {
    const m = PATH_ATTR.exec(attr.trim());
    if (m) return m[1];
  }
  return null;
};

// The candidate files a declaration points at, in the order rustc would try them.
const targetsOf = (key, decl) => {
  const slash = key.lastIndexOf("/");
  const dir = slash === -1 ? "" : key.slice(0, slash);
  const base = key.slice(slash + 1);
  const attr = pathAttr(decl);
  if (attr !== null) return [path.posix.normalize(path.posix.join(dir, attr))];
  if (base === "lib.rs" || base === "main.rs" || base === "mod.rs") {
    return [path.posix.join(dir, `${decl.name}.rs`), path.posix.join(dir, decl.name, "mod.rs")];
  }
  const stem = base.endsWith(".rs") ? base.slice(0, -3) : base;
  return [path.posix.join(dir, stem, `${decl.name}.rs`), path.posix.join(dir, stem, decl.name, "mod.rs")];
};

export function testOnlyRustFiles(files) {
  const pulls = new Map();
  for (const [key, text] of Object.entries(files)) {
    if (typeof text !== "string") continue;
    for (const decl of declarationsIn(text)) {
      const target = targetsOf(key, decl).find((candidate) => Object.hasOwn(files, candidate));
      if (target === undefined) continue;
      pulls.set(target, (pulls.get(target) ?? true) && isTestOnly(decl));
    }
  }
  const only = new Set();
  for (const [target, testOnly] of pulls) if (testOnly) only.add(target);
  return only;
}
