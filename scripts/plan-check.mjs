// Proves PLAN.md covers the spec: every P0/P1/P2 card, every H card DECISIONS.md marks build,
// and every X card appears exactly once; no D card and no skipped H card is planned.
// Then prints the STATE.md head counters (T-540), computed, never typed:
//   cutline left N/M      ids on the `Cutline:` line of PRIORITIES.md not yet ticked in this PLAN.md
//   merge gate K waiting  task ids ticked on some local lane/* branch but not ticked in this PLAN.md
//   P0 cards passing n/T  P0 cards whose every Acceptance box is [x] (or struck, see below)
//   done X/Y tasks        ticked task lines in this PLAN.md
// A box or a whole card is struck when a DECISIONS.md line says `strikes CARD-nnn` (whole card) or
// `strikes CARD-nnn box 2` (its 2nd Acceptance box) AND the same line carries
// `confirmed by Txais YYYY-MM-DD`. A row still marked "confirm" (pending) strikes nothing.
// Run: node scripts/plan-check.mjs                (exit 1 on any coverage failure)
//      node scripts/plan-check.mjs --write-state  (also rewrites the STATE.md `Done:` head line)
// PLAN.md is read together with PLAN-done.md (ticked tasks moved out on 2026-10-19), and DECISIONS.md
// with DECISIONS-history.md when it exists, so every count covers both halves.
// Test: pnpm exec vitest run scripts/plan-check.test.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CARD_HEAD = /^### ([A-Z]+-\d{3}) · /;
const BOX = /^\s*- \[([ xX])\]/;

/** Cards of one spec file into a map: id -> { tier, boxes: [ticked, ...] } in Acceptance order. */
export function parseCards(text, into = new Map()) {
  let card = null;
  let inAcc = false;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(CARD_HEAD);
    if (h) { card = { tier: null, boxes: [] }; into.set(h[1], card); inAcc = false; continue; }
    if (!card) continue;
    if (/^#/.test(line)) { card = null; inAcc = false; continue; }
    const t = card.tier === null && line.match(/^Tier: (\w+)/);
    if (t) { card.tier = t[1]; continue; }
    if (/^Acceptance:/.test(line)) { inAcc = true; continue; }
    if (inAcc && /^\S/.test(line)) { inAcc = false; continue; }
    const b = inAcc && line.match(BOX);
    if (b) card.boxes.push(b[1] !== ' ');
  }
  return into;
}

export function readCards(root = ROOT) {
  const cards = new Map();
  for (const f of readdirSync(join(root, 'spec')).filter(n => n.endsWith('.md')).sort()) {
    parseCards(readFileSync(join(root, 'spec', f), 'utf8'), cards);
  }
  return cards;
}

/** Strikes on Txais-confirmed DECISIONS lines: card id -> 'card' | Set of 1-based box numbers. */
export function parseStrikes(decisionsText) {
  const strikes = new Map();
  for (const line of decisionsText.split(/\r?\n/)) {
    if (!/confirmed by Txais \d{4}-\d{2}-\d{2}/.test(line)) continue;
    for (const m of line.matchAll(/strikes ([A-Z]+-\d{3})(?: box (\d+))?/g)) {
      const [, id, box] = m;
      if (!box) { strikes.set(id, 'card'); continue; }
      const cur = strikes.get(id);
      if (cur === 'card') continue;
      const set = cur || new Set();
      set.add(Number(box));
      strikes.set(id, set);
    }
  }
  return strikes;
}

/** P0 cards that pass: every Acceptance box ticked or struck; a card with no boxes never passes. */
export function p0Passing(cards, strikes = new Map()) {
  const passing = [];
  let total = 0;
  for (const [id, c] of cards) {
    if (c.tier !== 'P0') continue;
    total++;
    const s = strikes.get(id);
    if (s === 'card') { passing.push(id); continue; }
    if (c.boxes.length && c.boxes.every((ok, i) => ok || (s && s.has(i + 1)))) passing.push(id);
  }
  return { passing, total };
}

/** Task lines of a PLAN.md: task id -> ticked. */
export function planTasks(planText) {
  const tasks = new Map();
  for (const m of planText.matchAll(/^- \[([ x])\] (T-\d{3}\S*)/gm)) tasks.set(m[2], m[1] === 'x');
  return tasks;
}

/** The ids on the single `Cutline:` line of PRIORITIES.md (a note in brackets after them is ignored), or null. */
export function parseCutline(prioritiesText) {
  const lines = prioritiesText.split(/\r?\n/).filter(l => /^Cutline:/.test(l));
  if (lines.length > 1) throw new Error('PRIORITIES.md has more than one Cutline: line');
  if (!lines.length) return null;
  return [...lines[0].replace(/\(.*$/, '').matchAll(/\bT-\d{3}(?:-[a-z0-9]+)*/g)].map(m => m[0]);
}

/** Cutline ids not ticked here (an id with no PLAN.md line yet counts as left and is reported). */
export function cutlineLeft(cutline, tasks) {
  return {
    left: cutline.filter(id => tasks.get(id) !== true),
    missing: cutline.filter(id => !tasks.has(id)),
  };
}

/** Ids ticked on any lane but not ticked here: id -> [lane, ...]. lanes: lane -> (id -> ticked). */
export function mergeGate(headTasks, lanes) {
  const waiting = new Map();
  for (const [lane, tasks] of lanes) {
    for (const [id, ticked] of tasks) {
      if (!ticked || headTasks.get(id) === true) continue;
      if (!waiting.has(id)) waiting.set(id, []);
      waiting.get(id).push(lane);
    }
  }
  return waiting;
}

/** PLAN.md of every local lane/* branch (git show lane/x:PLAN.md). No git or no lanes: empty map. */
export function readLanes(root = ROOT) {
  const lanes = new Map();
  const git = (args) => execFileSync('git', args,
    { windowsHide: true, cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  let refs = [];
  try {
    refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/lane/']).split(/\r?\n/).filter(Boolean);
  } catch { return lanes; }
  for (const ref of refs) {
    let done = '';
    try { done = git(['show', `${ref}:PLAN-done.md`]); } catch { /* a lane from before the split */ }
    try { lanes.set(ref.replace(/^lane\//, ''), planTasks(git(['show', `${ref}:PLAN.md`]) + '\n' + done)); }
    catch { /* a lane without PLAN.md has nothing to merge */ }
  }
  return lanes;
}

export function doneLine(c) {
  return `Done: ${c.done} / ${c.tasks} tasks  ·  P0 cards passing: ${c.p0} / ${c.p0Total} cards  ·  ` +
    `cutline ${c.cutLeft} / ${c.cutTotal} left  ·  merge gate ${c.waiting} waiting  (node scripts/plan-check.mjs --write-state)`;
}

/** Rewrites only the `Done:` head line of STATE.md. */
export function rewriteStateHead(stateText, counts) {
  const lines = stateText.split('\n');
  const i = lines.findIndex(l => /^Done: /.test(l));
  if (i < 0) throw new Error('STATE.md has no "Done:" head line');
  lines[i] = doneLine(counts) + (lines[i].endsWith('\r') ? '\r' : '');
  return lines.join('\n');
}

/** The original plan-check: every card that must be planned is planned exactly once. */
export function coverageErrors(cards, decisionsText, planText) {
  const hBuild = new Set();
  for (const line of decisionsText.split(/\r?\n/)) {
    const m = line.match(/^\| ([A-Z]+-\d{3}) \| \d\d \| .*? \| (build|skip) \|/);
    if (m && m[2] === 'build') hBuild.add(m[1]);
  }
  const seen = new Map();
  const prefixes = new Set([...cards.keys()].map(id => id.split('-')[0]));
  for (const m of planText.matchAll(/\b([A-Z]+)-(\d{3})\b/g)) {
    if (!prefixes.has(m[1])) continue; // task ids (T-nnn) and decision ids are not cards
    const id = `${m[1]}-${m[2]}`;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  const errors = [];
  const expected = new Set();
  for (const [id, { tier }] of cards) {
    if (tier === 'P0' || tier === 'P1' || tier === 'P2' || tier === 'X' || (tier === 'H' && hBuild.has(id))) expected.add(id);
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`missing: ${id} (${cards.get(id).tier})`);
  for (const [id, n] of seen) {
    const tier = cards.get(id)?.tier;
    if (!tier) { errors.push(`unknown card id in PLAN.md: ${id}`); continue; }
    if (tier === 'D') errors.push(`dropped card planned: ${id}`);
    if (tier === 'H' && !hBuild.has(id)) errors.push(`skipped H card planned: ${id}`);
    if (n !== 1) errors.push(`${id} appears ${n} times (must be exactly once)`);
  }
  return { errors, expected: expected.size, planned: seen.size };
}

/** A file plus the file its old entries were moved to, when that one exists. */
function withMoved(root, file, moved) {
  const text = readFileSync(join(root, file), 'utf8');
  return existsSync(join(root, moved)) ? text + '\n' + readFileSync(join(root, moved), 'utf8') : text;
}

/** Everything plan-check counts, from the files under root and the lane refs. */
export function headCounts(root = ROOT, lanes = readLanes(root)) {
  const cards = readCards(root);
  const decisions = withMoved(root, 'DECISIONS.md', 'DECISIONS-history.md');
  const plan = withMoved(root, 'PLAN.md', 'PLAN-done.md');
  const tasks = planTasks(plan);
  const cutline = parseCutline(readFileSync(join(root, 'PRIORITIES.md'), 'utf8')) || [];
  const { left, missing } = cutlineLeft(cutline, tasks);
  const { passing, total } = p0Passing(cards, parseStrikes(decisions));
  const waiting = mergeGate(tasks, lanes);
  return {
    cards, decisions, plan, cutline, left, missing, passing, waiting, lanes,
    counts: {
      done: [...tasks.values()].filter(Boolean).length, tasks: tasks.size,
      p0: passing.length, p0Total: total,
      cutLeft: left.length, cutTotal: cutline.length, waiting: waiting.size,
    },
  };
}

function main() {
  const r = headCounts();
  const { errors, expected, planned } = coverageErrors(r.cards, r.decisions, r.plan);
  // T-540-b: a Cutline id with no PLAN.md line is an error, not a note.
  for (const id of r.missing) errors.push(`cutline id without a PLAN.md line: ${id}`);
  const c = r.counts;
  console.log(`cards in spec: ${r.cards.size} · expected in plan: ${expected} · planned ids: ${planned} · tasks: ${c.tasks}`);
  console.log(`head: cutline left ${c.cutLeft}/${c.cutTotal} · merge gate ${c.waiting} waiting · P0 cards passing ${c.p0}/${c.p0Total} · done ${c.done}/${c.tasks} tasks`);
  if (!r.cutline.length) console.log('cutline: no "Cutline:" line in PRIORITIES.md');
  else console.log(`cutline left: ${r.left.join(', ') || 'none'}` + (r.missing.length ? `  (no PLAN.md line yet: ${r.missing.join(', ')})` : ''));
  const perLane = new Map();
  for (const ls of r.waiting.values()) for (const l of ls) perLane.set(l, (perLane.get(l) || 0) + 1);
  console.log(`merge gate: ${r.lanes.size} lane branch(es) read` +
    (perLane.size ? ': ' + [...perLane].map(([l, n]) => `${l} ${n}`).join(', ') : ''));
  console.log(`P0 cards passing: ${r.passing.join(', ') || 'none'}`);
  if (process.argv.includes('--write-state')) {
    const statePath = join(ROOT, 'STATE.md');
    writeFileSync(statePath, rewriteStateHead(readFileSync(statePath, 'utf8'), c));
    console.log(`STATE.md head rewritten: ${doneLine(c)}`);
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('plan-check: OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
