// Kolux memory: a local, rebuildable record of what every agent worked on.
//
// This is not a shared database. Each machine builds its own file from sources that
// already exist there: the local agent session store, the Kolux repository, its
// evidence, the spec cards and the vault. The database is written outside the repo
// by default and is never committed.
//
//   node tools/kolux-memory/cli.mjs build
//   node tools/kolux-memory/cli.mjs status
//   node tools/kolux-memory/cli.mjs resume
//   node tools/kolux-memory/cli.mjs search "first load"
//
// Everything here is read-only against the sources. No source file is modified.
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const SCHEMA = 2;

export function defaults() {
  const home = homedir();
  const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
  return {
    sessions: process.env.KOLUX_MEMORY_SESSIONS || join(home, ".local", "share", "opencode", "opencode.db"),
    repo: process.env.KOLUX_MEMORY_REPO || REPO,
    vault: process.env.KOLUX_MEMORY_VAULT || join(REPO, "..", "Projects", "Txais Brain"),
    db: process.env.KOLUX_MEMORY_DB || join(appData, "com.txaisxiong.kolux-rs", "memory", "kolux-memory.db"),
    ledger: process.env.KOLUX_MEMORY_LEDGER || "",
    github: false,
    git: true,
  };
}

const iso = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
};

const isoDate = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const textOf = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

// Keep credentials out of the memory file. The patterns are deliberately narrow:
// a false positive costs a phrase, a miss costs a leaked key.
const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  /(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{16,})["']?/gi,
];

export function redact(text) {
  let s = textOf(text);
  for (const re of SECRETS) s = s.replace(re, (m, a, b) => {
    if (a && typeof a === "string" && /^(api|secret|password|passwd|token|bearer)$/i.test(a)) return `${a}: [redacted]`;
    return "[redacted]";
  });
  return s;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + " …" : s);

const debug = (msg) => { if (process.env.KOLUX_MEMORY_DEBUG) console.error(`[memory] ${msg}`); };

/** Clip before redacting: a 5 MB tool dump must not run nine regexes over all of it. */
const keep = (text, n) => redact(textOf(text).slice(0, 20000)).slice(0, n);

function walk(dir, filter = () => true, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".obsidian") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, filter, out);
    else if (ent.isFile() && filter(p)) out.push(p);
  }
  return out;
}

function titleOf(md, fallback) {
  const fm = md.match(/^---\s*[\s\S]*?\btitle:\s*(.+)$/m);
  if (fm) return fm[1].trim().replace(/^["']|["']$/g, "");
  const h = md.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : fallback;
}

function summaryOf(md) {
  return md
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function gitRoot(repo) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readGit(repo) {
  if (!gitRoot(repo)) return { commits: [], worktrees: [] };
  const fmt = "%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b";
  let raw = "";
  try {
    raw = execFileSync("git", ["-C", repo, "log", "--all", "--date=iso-strict", `--pretty=format:${fmt}`, "--numstat"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    return { commits: [], worktrees: [] };
  }
  const commits = [];
  for (const rec of raw.split("\x1e").slice(1)) {
    const nl = rec.indexOf("\n");
    const head = nl >= 0 ? rec.slice(0, nl) : rec;
    const rest = nl >= 0 ? rec.slice(nl + 1) : "";
    const [sha, author, email, date, subject, ...tail] = head.split("\x1f");
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) continue;
    let files = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of rest.split("\n")) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
      if (!m) continue;
      files++;
      if (m[1] !== "-") insertions += Number(m[1]);
      if (m[2] !== "-") deletions += Number(m[2]);
    }
    commits.push({ sha, author: author || "", email: email || "", date: isoDate(date), subject: subject || "", body: tail.join("\x1f") || "", files, insertions, deletions });
  }
  let worktrees = [];
  try {
    const wt = execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    let cur = {};
    for (const line of wt.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) { if (cur.path) worktrees.push(cur); cur = { path: line.slice(9) }; }
      else if (line.startsWith("HEAD ")) cur.head = line.slice(5, 13);
      else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace("refs/heads/", "");
    }
    if (cur.path) worktrees.push(cur);
  } catch { /* no worktree list */ }
  return { commits, worktrees };
}

function ghJson(args) {
  try {
    return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

function repoSlug(repo) {
  try {
    const url = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : "TxaisX/kolux";
  } catch {
    return "TxaisX/kolux";
  }
}

function readGithub(repo) {
  const slug = repoSlug(repo);
  const prs = ghJson(["pr", "list", "--repo", slug, "--state", "all", "--limit", "500", "--json", "number,title,state,mergedAt,headRefName,baseRefName,author,url"]);
  const releases = ghJson(["release", "list", "--repo", slug, "--limit", "100", "--json", "tagName,name,publishedAt,isDraft,isPrerelease"]);
  return {
    prs: Array.isArray(prs) ? prs.map((p) => ({
      number: p.number, title: p.title || "", state: p.state || "", merged_at: isoDate(p.mergedAt), head: p.headRefName || "", base: p.baseRefName || "", author: p.author?.login || "", url: p.url || "",
    })) : null,
    releases: Array.isArray(releases) ? releases.map((r) => ({
      tag: r.tagName, name: r.name || r.tagName, published_at: isoDate(r.publishedAt), draft: r.isDraft ? 1 : 0, prerelease: r.isPrerelease ? 1 : 0,
    })) : null,
  };
}

function parseCards(repo) {
  const dir = join(repo, "spec");
  if (!existsSync(dir)) return [];
  const decisions = ["DECISIONS.md", "DECISIONS-history.md"]
    .map((f) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), "utf8") : ""))
    .join("\n");
  const strikes = new Map();
  for (const line of decisions.split(/\r?\n/)) {
    if (!/confirmed by Txais \d{4}-\d{2}-\d{2}/.test(line)) continue;
    for (const m of line.matchAll(/strikes ([A-Z]+-\d{3})(?: box (\d+))?/g)) {
      const [, id, box] = m;
      if (!box) strikes.set(id, "card");
      else if (strikes.get(id) !== "card") {
        const set = strikes.get(id) instanceof Set ? strikes.get(id) : new Set();
        set.add(Number(box));
        strikes.set(id, set);
      }
    }
  }
  const cards = [];
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const lines = readFileSync(join(dir, file), "utf8").split(/\r?\n/);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const strike = strikes.get(cur.id);
      const boxes = cur.boxes.map((ticked, i) => ({ ticked, struck: strike === "card" || (strike instanceof Set && strike.has(i + 1)) }));
      const done = boxes.length > 0 && boxes.every((b) => b.ticked || b.struck);
      cards.push({
        id: cur.id, area: file, tier: cur.tier || "", title: cur.title, boxes: boxes.length,
        done: boxes.filter((b) => b.ticked || b.struck).length, status: done ? "pass" : "open",
      });
      cur = null;
    };
    for (const line of lines) {
      const h = line.match(/^###\s+([A-Z]+-\d{3})\s*(?:·|Â·|\u00b7)?\s*(.*)$/);
      if (h) { flush(); cur = { id: h[1], title: h[2].trim(), tier: "", boxes: [] }; continue; }
      if (!cur) continue;
      if (/^##\s/.test(line)) { flush(); continue; }
      const t = line.match(/^Tier:\s*(\w+)/);
      if (t && !cur.tier) { cur.tier = t[1]; continue; }
      if (/^Acceptance:/.test(line)) { cur.inAcc = true; continue; }
      if (cur.inAcc && /^\S/.test(line)) { cur.inAcc = false; }
      if (cur.inAcc) {
        const b = line.match(/^\s*- \[([ xX])\]/);
        if (b) cur.boxes.push(b[1] !== " ");
      }
    }
    flush();
  }
  return cards;
}

function collectDocs(repo, vault) {
  const out = [];
  const add = (p, kind) => {
    if (!existsSync(p)) return;
    const md = readFileSync(p, "utf8");
    out.push({ path: p, kind, title: titleOf(md, basename(p, ".md")), summary: summaryOf(md), modified_at: statSync(p).mtime.toISOString() });
  };
  for (const p of walk(join(vault, "06 - Projects", "Kolux"), (f) => f.endsWith(".md"))) add(p, "project");
  for (const p of walk(join(vault, "03 - Wiki", "Syntheses"), (f) => f.endsWith(".md") && /kolux|claude/i.test(basename(f)))) add(p, "synthesis");
  for (const p of walk(join(repo, "docs"), (f) => f.endsWith(".md"))) add(p, "docs");
  for (const f of ["STATE.md", "LOOP.md", "PLAN.md", "DECISIONS.md", "COMPAT.md", "PROVENANCE.md", "SPEC.md", "PRIORITIES.md", "design/DESIGN.md"]) {
    add(join(repo, f), "state");
  }
  for (const p of walk(join(vault, ".kolux", "handoffs"), (f) => f.endsWith(".md"))) add(p, "handoff");
  const seen = new Set();
  return out.filter((d) => (seen.has(d.path) ? false : (seen.add(d.path), true)));
}

function openRead(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  return db;
}

/** Read the local work-item ledger; one JSON object per line. */
export function readLedger(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const x = JSON.parse(line);
      if (!x || !x.title) continue;
      out.push({
        at: x.at || new Date().toISOString(),
        agent: x.agent || "",
        title: String(x.title),
        status: x.status || "done",
        detail: x.detail || "",
        evidence: x.evidence || "",
      });
    } catch { /* a torn line is skipped, not fatal */ }
  }
  return out;
}

function workTable(db) {
  db.exec("create table if not exists work_items(id integer primary key, at text, agent text, title text, status text, detail text, evidence text, source text)");
}

/** Append one completed work item to the ledger and, when the DB exists, to it. */
export function recordItem(opts = {}) {
  const dbPath = resolve(opts.db || defaults().db);
  const ledger = resolve(opts.ledger || join(dirname(dbPath), "work-items.jsonl"));
  const title = String(opts.title || "").trim();
  if (!title) throw new Error("record needs --title");
  const item = {
    at: opts.at || new Date().toISOString(),
    agent: String(opts.agent || "").trim(),
    title,
    status: String(opts.status || "done").trim(),
    detail: String(opts.detail || "").trim(),
    evidence: String(opts.evidence || "").trim(),
  };
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, JSON.stringify(item) + "\n");
  let id = null;
  let stored = false;
  if (existsSync(dbPath)) {
    let db;
    try {
      db = new DatabaseSync(dbPath);
      workTable(db);
      const r = db.prepare("insert into work_items(at,agent,title,status,detail,evidence,source) values (?,?,?,?,?,?,?)").run(item.at, item.agent, item.title, item.status, item.detail, item.evidence, "ledger");
      id = Number(r.lastInsertRowid);
      db.prepare("insert into search(kind,ref,title,body) values ('work',?,?,?)").run(String(id), item.title, item.detail);
      stored = true;
    } catch {
      // The ledger is the durable copy; the next build replays it.
    } finally {
      try { db?.close(); } catch { /* already closed */ }
    }
  }
  return { item, ledger, id, stored };
}

/** Work items in the database, newest first. */
export function listItems(db, agent = "", limit = 30) {
  try {
    return db.prepare("select * from work_items where (?='' or agent=?) order by at desc limit ?").all(agent, agent, limit);
  } catch {
    return [];
  }
}

export function build(opts = {}) {
  const o = { ...defaults(), ...opts };
  const dbPath = resolve(o.db);
  const tmpPath = dbPath + ".building";
  mkdirSync(dirname(dbPath), { recursive: true });
  rmSync(tmpPath, { force: true });
  const db = new DatabaseSync(tmpPath);
  db.exec(`
    pragma journal_mode = memory;
    pragma synchronous = off;
    pragma cache_size = -64000;
    create table meta(key text primary key, value text);
    create table sessions(id text primary key, parent_id text, title text, directory text, agent text, model text, provider text, created_at text, updated_at text, cost real, tokens_input integer, tokens_output integer, message_count integer, user_messages integer);
    create table messages(id integer primary key, session_id text, seq integer, role text, created_at text, text text);
    create table tools(id integer primary key, session_id text, seq integer, tool text, status text, input text, output text);
    create table commits(sha text primary key, author text, email text, date text, subject text, body text, files integer, insertions integer, deletions integer);
    create table prs(number integer primary key, title text, state text, merged_at text, head text, base text, author text, url text);
    create table releases(tag text primary key, name text, published_at text, draft integer, prerelease integer);
    create table cards(id text primary key, area text, tier text, title text, boxes integer, done integer, status text);
    create table evidence(path text primary key, card text, task text, bytes integer, modified_at text, status text, first_line text);
    create table documents(path text primary key, kind text, title text, summary text, modified_at text);
    create table handoffs(path text primary key, seat text, modified_at text, body text);
    create table agents(kind text, name text, sessions integer, messages integer, last_seen text, detail text, primary key(kind, name));
    create table events(id integer primary key, at text, kind text, ref text, summary text);
    create table worktrees(path text primary key, branch text, head text);
    create table work_items(id integer primary key, at text, agent text, title text, status text, detail text, evidence text, source text);
    create virtual table search using fts5(kind, ref, title, body, tokenize='unicode61');
  `);
  // One transaction for the whole build. Without it each of the thousands of
  // messages, tools and FTS rows is its own disk commit, which took minutes.
  db.exec("BEGIN");

  const insertMeta = db.prepare("insert into meta(key,value) values (?,?)");
  const insertSession = db.prepare("insert into sessions values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertMessage = db.prepare("insert into messages(session_id,seq,role,created_at,text) values (?,?,?,?,?)");
  const insertTool = db.prepare("insert into tools(session_id,seq,tool,status,input,output) values (?,?,?,?,?,?)");
  const insertCommit = db.prepare("insert into commits values (?,?,?,?,?,?,?,?,?)");
  const insertPr = db.prepare("insert into prs values (?,?,?,?,?,?,?,?)");
  const insertRelease = db.prepare("insert into releases values (?,?,?,?,?)");
  const insertCard = db.prepare("insert into cards values (?,?,?,?,?,?,?)");
  const insertEvidence = db.prepare("insert into evidence values (?,?,?,?,?,?,?)");
  const insertDoc = db.prepare("insert into documents values (?,?,?,?,?)");
  const insertHandoff = db.prepare("insert into handoffs values (?,?,?,?)");
  const insertEvent = db.prepare("insert into events(at,kind,ref,summary) values (?,?,?,?)");
  const insertWorktree = db.prepare("insert or replace into worktrees values (?,?,?)");
  const insertWork = db.prepare("insert into work_items(at,agent,title,status,detail,evidence,source) values (?,?,?,?,?,?,?)");
  const insertSearch = db.prepare("insert into search(kind,ref,title,body) values (?,?,?,?)");

  const counts = { sessions: 0, messages: 0, tools: 0, commits: 0, prs: 0, releases: 0, cards: 0, evidence: 0, documents: 0, handoffs: 0, work_items: 0 };

  // ---- agent sessions -------------------------------------------------------
  let sessions = [];
  if (o.sessions && existsSync(o.sessions)) {
    debug(`reading sessions from ${o.sessions}`);
    let sdb;
    try {
      sdb = openRead(o.sessions);
      sessions = sdb.prepare("select id,parent_id,title,directory,agent,model,time_created,time_updated,cost,tokens_input,tokens_output from session_v2").all();
    } catch (e) {
      insertMeta.run("sessions_error", String(e.message || e));
      sessions = [];
    }
    debug(`${sessions.length} sessions`);
    if (sdb) {
      const per = new Map();
      for (const s of sessions) {
        let model = {};
        try { model = JSON.parse(s.model || "{}"); } catch { model = { id: String(s.model || "") }; }
        const row = {
          id: s.id, parent_id: s.parent_id || null, title: s.title || "", directory: s.directory || "",
          agent: s.agent || "", model: model.id || "", provider: model.providerID || "",
          created_at: iso(s.time_created), updated_at: iso(s.time_updated), cost: Number(s.cost) || 0,
          tokens_input: Number(s.tokens_input) || 0, tokens_output: Number(s.tokens_output) || 0, message_count: 0, user_messages: 0,
        };
        insertSession.run(row.id, row.parent_id, row.title, row.directory, row.agent, row.model, row.provider, row.created_at, row.updated_at, row.cost, row.tokens_input, row.tokens_output, 0, 0);
        per.set(row.id, row);
        insertEvent.run(row.created_at, "session", row.id, `${row.agent || "agent"} · ${row.model || "model"} · ${row.title}`.slice(0, 300));
        counts.sessions++;
      }
      const msgs = sdb.prepare("select session_id,seq,type,time_created,data from session_message order by session_id,seq").all();
      for (const m of msgs) {
        const s = per.get(m.session_id);
        if (!s) continue;
        let d;
        try { d = JSON.parse(m.data || "{}"); } catch { continue; }
        const at = iso(d?.time?.created ?? m.time_created);
        if (m.type === "user") {
          const text = keep(d.text, 20000);
          if (!text.trim()) continue;
          insertMessage.run(m.session_id, m.seq, "user", at, text);
          insertSearch.run("message", `${m.session_id}#${m.seq}`, s.title, clip(text, 8000));
          s.message_count++;
          s.user_messages++;
          counts.messages++;
          continue;
        }
        if (m.type !== "assistant") continue;
        const blocks = Array.isArray(d.content) ? d.content : [];
        const texts = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) texts.push(b.text);
          else if (b.type === "tool") {
            const state = b.state || {};
            const out = Array.isArray(state.content)
              ? state.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n")
              : textOf(state.output);
            const input = keep(state.input, 4000);
            const output = keep(out, 2000);
            insertTool.run(m.session_id, m.seq, b.name || "", state.status || "", input, output);
            insertSearch.run("tool", `${m.session_id}#${m.seq}`, b.name || "", clip(`${input}\n${output}`, 4000));
            counts.tools++;
          }
        }
        const text = keep(texts.join("\n\n"), 20000);
        if (!text.trim()) continue;
        insertMessage.run(m.session_id, m.seq, "assistant", at, text);
        insertSearch.run("message", `${m.session_id}#${m.seq}`, s.title, clip(text, 8000));
        s.message_count++;
        counts.messages++;
      }
      for (const s of per.values()) {
        db.prepare("update sessions set message_count=?, user_messages=? where id=?").run(s.message_count, s.user_messages, s.id);
      }
      sdb.close();
      insertMeta.run("sessions_db", o.sessions);
    }
  } else {
    insertMeta.run("sessions_db", "missing");
  }

  // ---- git ------------------------------------------------------------------
  let commits = [];
  let worktrees = [];
  if (o.git !== false) {
    ({ commits, worktrees } = readGit(o.repo));
    for (const c of commits) {
      insertCommit.run(c.sha, c.author, c.email, c.date, c.subject, keep(c.body, 4000), c.files, c.insertions, c.deletions);
      insertSearch.run("commit", c.sha, c.subject, clip(c.body, 8000));
      insertEvent.run(c.date, "commit", c.sha.slice(0, 8), c.subject.slice(0, 300));
      counts.commits++;
    }
    for (const w of worktrees) insertWorktree.run(w.path, w.branch || "", w.head || "");
    debug(`${commits.length} commits, ${worktrees.length} worktrees`);
  }

  // ---- github ---------------------------------------------------------------
  if (o.github) {
    const gh = readGithub(o.repo);
    if (gh.prs) {
      for (const p of gh.prs) {
        insertPr.run(p.number, p.title, p.state, p.merged_at, p.head, p.base, p.author, p.url);
        if (p.merged_at) insertEvent.run(p.merged_at, "pr", `#${p.number}`, p.title.slice(0, 300));
        counts.prs++;
      }
    }
    if (gh.releases) {
      for (const r of gh.releases) {
        insertRelease.run(r.tag, r.name, r.published_at, r.draft, r.prerelease);
        insertEvent.run(r.published_at, "release", r.tag, r.name.slice(0, 300));
        counts.releases++;
      }
    }
  }

  // ---- cards ----------------------------------------------------------------
  const cards = parseCards(o.repo);
  for (const c of cards) {
    insertCard.run(c.id, c.area, c.tier, c.title, c.boxes, c.done, c.status);
    counts.cards++;
  }
  debug(`${cards.length} cards`);

  // ---- evidence -------------------------------------------------------------
  const evidenceDir = join(o.repo, "evidence");
  for (const p of walk(evidenceDir)) {
    const rel = relative(o.repo, p).replaceAll("\\", "/");
    const name = basename(p);
    let head = "";
    try {
      if (statSync(p).size < 4 * 1024 * 1024) head = readFileSync(p).subarray(0, 8192).toString("utf8");
    } catch { /* binary */ }
    const line = (head.split(/\r?\n/).find((l) => l.trim()) || "").trim().slice(0, 300);
    // The card can be in the name or anywhere in the opening lines; live proofs
    // often put it on line 2.
    const card = (name.match(/^([A-Z]{2,6}-\d{3})/) || head.match(/\b([A-Z]{2,6}-\d{3})\b/) || [])[1] || "";
    const task = (name.match(/\b(T-\d{3}[a-z]?)\b/) || head.match(/\b(T-\d{3}[a-z]?)\b/) || [])[1] || "";
    let status = "";
    // Only the evidence convention's own line counts. A lowercase "test result:"
    // from a quoted cargo run is not a card result.
    const m = head.match(/^(?:RESULT|Result):\s*(PASS|FAIL)\b/m);
    if (m) status = m[1].toLowerCase();
    insertEvidence.run(rel, card, task, statSync(p).size, statSync(p).mtime.toISOString(), status, clip(line, 300));
    insertSearch.run("evidence", rel, name, head.slice(0, 4000));
    insertEvent.run(statSync(p).mtime.toISOString(), "evidence", rel, `${status ? status.toUpperCase() + " · " : ""}${line}`.slice(0, 300));
    counts.evidence++;
  }
  debug(`${counts.evidence} evidence files`);

  // ---- documents and handoffs ----------------------------------------------
  const docs = collectDocs(o.repo, o.vault);
  debug(`${docs.length} documents`);
  for (const d of docs) {
    const rel = d.path.startsWith(resolve(o.vault)) ? d.path.slice(resolve(o.vault).length + 1) : d.path;
    insertDoc.run(rel.replaceAll("\\", "/"), d.kind, d.title, d.summary, d.modified_at);
    insertSearch.run("doc", rel.replaceAll("\\", "/"), d.title, d.summary);
    insertEvent.run(d.modified_at, "doc", rel.replaceAll("\\", "/"), d.title.slice(0, 300));
    counts.documents++;
    if (d.kind === "handoff") {
      const md = readFileSync(d.path, "utf8");
      insertHandoff.run(rel.replaceAll("\\", "/"), basename(d.path, ".md"), d.modified_at, clip(md, 6000));
      counts.handoffs++;
    }
  }

  // ---- agents ---------------------------------------------------------------
  const roles = db.prepare("select agent as name, count(*) as sessions, sum(message_count) as messages, max(updated_at) as last_seen, group_concat(distinct model) as detail from sessions where agent<>'' group by agent").all();
  for (const r of roles) db.prepare("insert into agents values ('role',?,?,?,?,?)").run(r.name, r.sessions, r.messages || 0, r.last_seen, r.detail || "");
  const models = db.prepare("select model as name, count(*) as sessions, sum(message_count) as messages, max(updated_at) as last_seen, group_concat(distinct agent) as detail from sessions where model<>'' group by model").all();
  for (const r of models) db.prepare("insert into agents values ('model',?,?,?,?,?)").run(r.name, r.sessions, r.messages || 0, r.last_seen, r.detail || "");

  // ---- recorded work (the local ledger) ------------------------------------
  // The ledger is the one part a rebuild cannot derive from history: a session
  // writes a completed item there, and every later build replays it.
  const ledgerPath = o.ledger || join(dirname(dbPath), "work-items.jsonl");
  if (existsSync(ledgerPath)) {
    const items = readLedger(ledgerPath);
    for (const w of items) {
      const r = insertWork.run(w.at, w.agent, w.title, w.status, w.detail, w.evidence, "ledger");
      insertSearch.run("work", String(r.lastInsertRowid), w.title, w.detail);
      insertEvent.run(w.at, "work", w.agent || "agent", w.title.slice(0, 300));
      counts.work_items++;
    }
    insertMeta.run("ledger", ledgerPath);
    debug(`${items.length} recorded work items`);
  }

  insertMeta.run("schema", String(SCHEMA));
  insertMeta.run("built_at", new Date().toISOString());
  insertMeta.run("repo", resolve(o.repo));
  insertMeta.run("vault", resolve(o.vault));
  insertMeta.run("github", o.github ? "on" : "off");
  const c = counts;
  insertMeta.run("counts", JSON.stringify(c));

  db.exec("COMMIT");
  db.exec("pragma optimize");
  db.close();
  rmSync(dbPath, { force: true });
  renameSync(tmpPath, dbPath);
  debug(`wrote ${dbPath}`);
  return { db: dbPath, counts };
}

export function openDb(path) {
  if (!existsSync(path)) throw new Error(`memory database not found: ${path}\nrun: node tools/kolux-memory/cli.mjs build`);
  return new DatabaseSync(path, { readOnly: true });
}

export function status(db, path) {
  const one = (sql) => db.prepare(sql).get();
  const sessions = one("select count(*) n, sum(message_count) m from sessions");
  const tools = one("select count(*) n from tools");
  const p0 = one("select count(*) n, sum(status='pass') p from cards where tier='P0'");
  const openP0 = one("select count(*) n from cards where tier='P0' and status='open'");
  const evidence = one("select count(*) n, sum(status='fail') f from evidence");
  const docs = one("select count(*) n from documents");
  const handoffs = one("select count(*) n from handoffs");
  const commits = one("select count(*) n from commits");
  const prs = one("select count(*) n from prs");
  const releases = one("select count(*) n from releases");
  const agents = one("select count(*) n from agents");
  let work = 0;
  try { work = one("select count(*) n from work_items").n; } catch { /* older database */ }
  const built = db.prepare("select value from meta where key='built_at'").get()?.value || "";
  return {
    db: path, bytes: existsSync(path) ? statSync(path).size : 0, built,
    sessions: sessions.n, messages: sessions.m || 0, tools: tools.n,
    p0_pass: p0.p || 0, p0_total: p0.n, p0_open: openP0.n,
    evidence: evidence.n, evidence_fail: evidence.f || 0,
    documents: docs.n, handoffs: handoffs.n, commits: commits.n, prs: prs.n, releases: releases.n, agents: agents.n, work_items: work,
  };
}

export function search(db, query, limit = 20) {
  const terms = String(query || "").replace(/"/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const q = terms.map((t) => `"${t}"`).join(" AND ");
  try {
    return db.prepare("select kind, ref, title, snippet(search, 3, '[', ']', '…', 18) as hit from search where search match ? order by rank limit ?").all(q, limit);
  } catch {
    return db.prepare("select kind, ref, title, substr(body,1,180) as hit from search where body like ? limit ?").all(`%${terms[0]}%`, limit);
  }
}

export function timeline(db, days = 2, kind = "", limit = 40) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  if (kind) return db.prepare("select at, kind, ref, summary from events where at>=? and kind=? order by at desc limit ?").all(since, kind, limit);
  return db.prepare("select at, kind, ref, summary from events where at>=? order by at desc limit ?").all(since, limit);
}

export function findSession(db, q) {
  const s = db.prepare("select * from sessions where id=? or id like ? or title like ? order by updated_at desc limit 1").get(q, `${q}%`, `%${q}%`);
  if (!s) return null;
  const messages = db.prepare("select seq, role, created_at, text from messages where session_id=? order by seq").all(s.id);
  const tools = db.prepare("select tool, status, count(*) n from tools where session_id=? group by tool, status order by n desc").all(s.id);
  return { session: s, messages, tools };
}

export function resumeMarkdown(db, path) {
  const st = status(db, path);
  const open = db.prepare("select id, tier, title, done, boxes, area from cards where tier='P0' and status='open' order by id").all();
  const fails = db.prepare("select e.path, e.card, e.modified_at, e.first_line from evidence e join cards c on c.id=e.card where e.status='fail' and c.tier='P0' and c.status='open' order by e.modified_at desc limit 8").all();
  let work = [];
  try { work = db.prepare("select at, agent, title, status from work_items order by at desc limit 10").all(); } catch { /* older database */ }
  const events = db.prepare("select at, kind, ref, summary from events where at>=? and kind in ('session','commit','pr','release') order by at desc limit 18").all(new Date(Date.now() - 3 * 86400000).toISOString());
  const agents = db.prepare("select kind, name, sessions, messages, last_seen from agents order by kind, sessions desc limit 12").all();
  const lines = [];
  lines.push("# Kolux memory: resume", "");
  lines.push(`Built ${st.built} · database ${path} · ${(st.bytes / 1048576).toFixed(1)} MB`, "");
  lines.push("## Where the work stands", "");
  lines.push(`- Sessions: **${st.sessions}** (${st.messages} messages, ${st.tools} tool calls)`);
  lines.push(`- P0 cards: **${st.p0_pass}/${st.p0_total}** passing, **${st.p0_open}** open`);
  lines.push(`- Evidence: ${st.evidence} files, ${st.evidence_fail} marked FAIL`);
  lines.push(`- Commits: ${st.commits} · PRs: ${st.prs} · Releases: ${st.releases}`);
  const release = db.prepare("select tag, published_at from releases order by published_at desc limit 1").get();
  lines.push(`- Latest release: ${release ? `${release.tag} (${release.published_at})` : "none recorded"}`);
  lines.push("");
  lines.push("## Open P0 cards", "");
  if (!open.length) lines.push("None.");
  else {
    lines.push("| Card | Boxes | Title |");
    lines.push("|---|---|---|");
    for (const c of open) lines.push(`| ${c.id} | ${c.done}/${c.boxes} | ${String(c.title).slice(0, 110)} |`);
  }
  lines.push("");
  lines.push("## Failures on open cards", "");
  if (!fails.length) lines.push("None recorded for an open P0 card.");
  else for (const f of fails) lines.push(`- ${f.card || "?"} · ${f.path} · ${f.modified_at} · ${f.first_line}`);
  lines.push("");
  lines.push("## Recorded work", "");
  if (!work.length) lines.push("None recorded yet. `record` appends one to the local ledger.");
  else for (const w of work) lines.push(`- ${w.at} - ${w.agent || "agent"} - ${w.status} - ${w.title}`);
  lines.push("");
  lines.push("## Last 3 days", "");
  if (!events.length) lines.push("No events.");
  for (const e of events) lines.push(`- ${e.at} · ${e.kind} · ${e.ref} · ${e.summary}`);
  lines.push("");
  lines.push("## Agents", "");
  lines.push("| Kind | Name | Sessions | Messages | Last seen |");
  lines.push("|---|---|---|---|---|");
  for (const a of agents) lines.push(`| ${a.kind} | ${a.name} | ${a.sessions} | ${a.messages} | ${a.last_seen || ""} |`);
  lines.push("");
  lines.push("## Next", "");
  if (fails.length) lines.push("1. Start with the failing evidence above; each is a card that was attempted and did not pass.");
  if (open.length) lines.push(`${fails.length ? 2 : 1}. Close the open P0 cards listed above; run one proof at a time and record the result in evidence/.`);
  lines.push(`${fails.length || open.length ? 3 : 1}. Rebuild this memory after the work so the next session inherits the result: \`node tools/kolux-memory/cli.mjs build\`.`);
  return lines.join("\n") + "\n";
}

export function exportMarkdown(db, path) {
  const st = status(db, path);
  const sessions = db.prepare("select title, agent, model, created_at, message_count, cost from sessions order by updated_at desc limit 40").all();
  const prs = db.prepare("select number, title, state, merged_at from prs order by number desc limit 30").all();
  const releases = db.prepare("select tag, published_at from releases order by published_at desc limit 15").all();
  const docs = db.prepare("select kind, path, title, modified_at from documents order by modified_at desc limit 40").all();
  const L = [];
  L.push("# Kolux memory", "");
  L.push(`Built ${st.built} · ${st.sessions} sessions · ${st.commits} commits · ${st.p0_pass}/${st.p0_total} P0 cards`, "");
  L.push("## Sessions", "", "| Title | Agent | Model | Started | Messages |", "|---|---|---|---|---|");
  for (const s of sessions) L.push(`| ${String(s.title).replaceAll("|", "/").slice(0, 80)} | ${s.agent} | ${s.model} | ${s.created_at} | ${s.message_count} |`);
  L.push("", "## Pull requests", "", "| # | Title | State | Merged |", "|---|---|---|---|");
  for (const p of prs) L.push(`| ${p.number} | ${String(p.title).replaceAll("|", "/").slice(0, 90)} | ${p.state} | ${p.merged_at || ""} |`);
  L.push("", "## Releases", "");
  for (const r of releases) L.push(`- ${r.tag} · ${r.published_at}`);
  L.push("", "## Documents", "", "| Kind | Path | Title | Modified |", "|---|---|---|---|");
  for (const d of docs) L.push(`| ${d.kind} | ${String(d.path).replaceAll("|", "/").slice(0, 90)} | ${String(d.title).replaceAll("|", "/").slice(0, 80)} | ${d.modified_at} |`);
  return L.join("\n") + "\n";
}
