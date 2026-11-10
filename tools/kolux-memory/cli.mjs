#!/usr/bin/env node
// CLI for the local Kolux memory database. See README.md.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, defaults, exportMarkdown, findSession, listItems, openDb, recordItem, resumeMarkdown, search, status, timeline } from "./lib.mjs";

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2);
    if (k === "github") o.github = true;
    else if (k === "no-github") o.github = false;
    else if (k === "no-git") o.git = false;
    else if (k === "help") o.help = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      o[k] = v;
    }
  }
  return o;
}

const HELP = `Kolux memory: a local record of what every agent worked on

  node tools/kolux-memory/cli.mjs build [--db path] [--repo path] [--vault path]
                                       [--sessions path] [--github] [--no-git]
  node tools/kolux-memory/cli.mjs status [--db path]
  node tools/kolux-memory/cli.mjs search "words" [--db path] [--limit n]
  node tools/kolux-memory/cli.mjs timeline [--days n] [--kind commit|session|pr|release] [--db path]
  node tools/kolux-memory/cli.mjs session <id or title> [--db path]
  node tools/kolux-memory/cli.mjs agent <role or model> [--db path]
  node tools/kolux-memory/cli.mjs card <CARD-ID> [--db path]
  node tools/kolux-memory/cli.mjs record --title "what was done" [--agent name]
                                       [--status done] [--detail text] [--evidence path]
  node tools/kolux-memory/cli.mjs items [--agent name] [--limit n] [--db path]
  node tools/kolux-memory/cli.mjs resume [--md path] [--db path]
  node tools/kolux-memory/cli.mjs export [--md path] [--db path]

The database is built on this machine from local sources only. It is never
committed and it is different on every machine. Default database:
  %APPDATA%\\com.txaisxiong.kolux\\memory\\kolux-memory.db`;

function dbPath(o) {
  return resolve(o.db || defaults().db);
}

function printStatus(s) {
  const mb = (s.bytes / 1048576).toFixed(1);
  console.log(`memory database: ${s.db}  (${mb} MB, built ${s.built || "never"})`);
  console.log(`  sessions ${s.sessions}  messages ${s.messages}  tools ${s.tools}  agents ${s.agents}`);
  console.log(`  P0 cards ${s.p0_pass}/${s.p0_total} passing, ${s.p0_open} open`);
  console.log(`  evidence ${s.evidence} (${s.evidence_fail} FAIL)  documents ${s.documents}  handoffs ${s.handoffs}`);
  console.log(`  commits ${s.commits}  PRs ${s.prs}  releases ${s.releases}`);
  console.log(`  recorded work items ${s.work_items || 0}`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || "help";
  const o = parseArgs(argv.slice(1));
  if (o.help || cmd === "help") { console.log(HELP); return 0; }

  if (cmd === "build") {
    const opts = { ...defaults(), ...o, db: dbPath(o) };
    const res = build(opts);
    console.log(`built ${res.db}`);
    console.log(JSON.stringify(res.counts));
    return 0;
  }

  if (cmd === "record") {
    const r = recordItem({ db: dbPath(o), ledger: o.ledger, agent: o.agent, title: o.title, status: o.status, detail: o.detail, evidence: o.evidence, at: o.at });
    console.log(`recorded "${r.item.title}" for ${r.item.agent || "agent"} (${r.item.status})`);
    console.log(`ledger: ${r.ledger}${r.stored ? " (also in the database)" : " (next build will add it to the database)"}`);
    return 0;
  }

  const path = dbPath(o);
  const db = openDb(path);

  if (cmd === "status") { printStatus(status(db, path)); return 0; }

  if (cmd === "items") {
    const rows = listItems(db, o.agent || "", Number(o.limit) || 30);
    console.log(`${rows.length} recorded item(s)${o.agent ? ` for ${o.agent}` : ""}`);
    for (const w of rows) console.log(`  ${w.at}  ${(w.agent || "agent").padEnd(14)} ${String(w.status).padEnd(6)} ${w.title}`);
    return 0;
  }

  if (cmd === "search") {
    const q = o._.join(" ").trim();
    if (!q) throw new Error("search needs words");
    const rows = search(db, q, Number(o.limit) || 20);
    console.log(`${rows.length} hit(s) for "${q}"`);
    for (const r of rows) console.log(`  [${r.kind}] ${r.ref}\n    ${r.title}\n    ${r.hit}`);
    return 0;
  }

  if (cmd === "timeline") {
    const rows = timeline(db, Number(o.days) || 2, o.kind || "", Number(o.limit) || 40);
    for (const e of rows) console.log(`${e.at}  ${e.kind.padEnd(8)} ${e.ref}  ${e.summary}`);
    return 0;
  }

  if (cmd === "session") {
    const q = o._[0];
    if (!q) throw new Error("session needs an id or title");
    const hit = findSession(db, q);
    if (!hit) { console.log("no session matched"); return 1; }
    const s = hit.session;
    console.log(`${s.title}`);
    console.log(`  id ${s.id}  agent ${s.agent}  model ${s.model}  messages ${s.message_count}`);
    console.log(`  started ${s.created_at}  updated ${s.updated_at}`);
    if (hit.tools.length) console.log(`  tools: ${hit.tools.map((t) => `${t.tool}(${t.status})=${t.n}`).join(", ")}`);
    console.log("");
    for (const m of hit.messages.slice(-20)) {
      const text = String(m.text || "").replace(/\s+/g, " ").slice(0, 500);
      console.log(`  ${m.role.padEnd(9)} ${text}`);
    }
    return 0;
  }

  if (cmd === "agent") {
    const name = o._[0];
    if (!name) throw new Error("agent needs a role or model name");
    const rows = db.prepare("select id, title, agent, model, created_at, message_count from sessions where agent=? or model like ? order by updated_at desc limit 30").all(name, `%${name}%`);
    console.log(`${rows.length} session(s) for ${name}`);
    for (const r of rows) console.log(`  ${r.created_at}  ${r.agent} · ${r.model}  ${r.message_count} msg  ${r.title}`);
    return 0;
  }

  if (cmd === "card") {
    const id = (o._[0] || "").toUpperCase();
    if (!id) throw new Error("card needs an id, e.g. BROW-008");
    const c = db.prepare("select * from cards where id=?").get(id);
    if (!c) { console.log(`no card ${id}`); return 1; }
    console.log(`${c.id}  ${c.tier}  ${c.status.toUpperCase()}  ${c.done}/${c.boxes} boxes`);
    console.log(`  ${c.title}`);
    console.log(`  ${c.area}`);
    const ev = db.prepare("select path, status, modified_at, first_line from evidence where card=? or path like ? order by modified_at desc").all(id, `%${id}%`);
    if (ev.length) {
      console.log("  evidence:");
      for (const e of ev) console.log(`    ${e.status || "-"}  ${e.modified_at}  ${e.path}  ${e.first_line}`);
    }
    const commits = db.prepare("select sha, date, subject from commits where subject like ? or body like ? order by date desc limit 8").all(`%${id}%`, `%${id}%`);
    if (commits.length) {
      console.log("  commits:");
      for (const x of commits) console.log(`    ${x.date}  ${x.sha.slice(0, 8)}  ${x.subject}`);
    }
    return 0;
  }

  if (cmd === "resume") {
    const md = resumeMarkdown(db, path);
    if (o.md) { writeFileSync(resolve(o.md), md); console.log(`wrote ${resolve(o.md)}`); }
    else process.stdout.write(md);
    return 0;
  }

  if (cmd === "export") {
    const md = exportMarkdown(db, path);
    if (o.md) { writeFileSync(resolve(o.md), md); console.log(`wrote ${resolve(o.md)}`); }
    else process.stdout.write(md);
    return 0;
  }

  console.log(`unknown command: ${cmd}\n`);
  console.log(HELP);
  return 2;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`kolux-memory: ${e.message || e}`);
  process.exitCode = 1;
}
