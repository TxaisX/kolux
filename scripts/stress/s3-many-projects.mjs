// S3 many projects: 150 projects, each a real git repo with one extra worktree (300 worktrees), seeded into the scratch
// profile before the app starts. Bars: the sidebar shows every project and worktree within 2 s of the page loading,
// scrolling the list and filtering it stay under 100 ms per frame, the app does not crash.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fmt, installProbe, pageErrors, seedProfile, snapshot, stats } from "./lib.mjs";

export const title = "Many projects (150 projects, 300 worktrees)";
const PROJECTS = 150;
const SIDEBAR_BAR_MS = 2000;
const FRAME_BAR_MS = 100;
const pad = (n) => String(n).padStart(3, "0");

// Repos and worktrees are made 8 at a time; the project list goes straight into the profile's state.db (kv "projects").
export const seed = (app, settings) => async () => {
  seedProfile(app, settings)();
  const root = join(app.temp, "repos");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const git = (cwd, a) => app.run("git", ["-c", "user.name=stress", "-c", "user.email=stress@example.invalid", ...a], { cwd });
  const make = async (i) => {
    const dir = join(root, `proj-${pad(i)}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), `p${i}\n`);
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-q", "-m", "stress"]);
    await git(dir, ["worktree", "add", "-q", "-b", `feat-${pad(i)}`, join(root, `proj-${pad(i)}-wt`)]);
  };
  const t0 = Date.now();
  let next = 1;
  await Promise.all(Array.from({ length: 8 }, async () => { for (;;) { const i = next++; if (i > PROJECTS) return; await make(i); } }));
  console.log(`  seeded ${PROJECTS} repos with a worktree each in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const projects = Array.from({ length: PROJECTS }, (_, k) => ({ id: `p-${pad(k + 1)}`, name: `proj-${pad(k + 1)}`, path: join(root, `proj-${pad(k + 1)}`).replace(/\\/g, "/") }));
  const json = join(app.temp, "projects.json");
  writeFileSync(json, JSON.stringify(projects));
  const code = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.execute('create table if not exists kv (key text primary key, value text not null)')\nc.execute('insert or replace into kv values (?,?)',('projects',open(sys.argv[2],encoding='utf-8').read()))\nc.commit()\nprint(c.execute('select count(*) from kv').fetchone()[0])`;
  await app.run("python", ["-I", "-c", code, join(app.paths.profile, "state.db"), json]);
};

const COUNTS = `({ proj: document.querySelectorAll("aside.sidebar .proj").length, sess: document.querySelectorAll("aside.sidebar .sess").length, main: document.querySelectorAll("aside.sidebar button.branch").length, now: Math.round(performance.now()) })`;

// In the page: per-step cost of scrolling .sb-list top to bottom in `steps` steps (scroll + forced layout, and the rAF gap when
// frames are delivered at all), and the same for hiding / showing projects through the filter checkboxes.
const SCROLL_JS = (steps) => `(async () => {
  const list = document.querySelector(".sb-list");
  if (!list) return { error: "no .sb-list" };
  const max = list.scrollHeight - list.clientHeight;
  const raf = () => new Promise((r) => { const to = setTimeout(() => r(-1), 1000); requestAnimationFrame(() => { clearTimeout(to); r(performance.now()); }); });
  const sync = [], gaps = [];
  list.scrollTop = 0;
  let last = await raf();
  for (let i = 1; i <= ${steps}; i++) {
    const t0 = performance.now();
    list.scrollTop = (max * i) / ${steps};
    void list.offsetHeight;
    sync.push(performance.now() - t0);
    const t = await raf();
    if (t >= 0 && last >= 0) gaps.push(t - last);
    last = t;
  }
  return { max, scrollHeight: list.scrollHeight, sync: sync.map((x) => Math.round(x * 10) / 10), gaps: gaps.map((x) => Math.round(x * 10) / 10), rafWorks: gaps.length > 0 };
})()`;

// In the page: open the "Group and sort the list" panel, then for each project name tick its "show <name>" box (the filter
// narrows the list) and clear the filters again; per change: ms until the .proj count moved, and the longest rAF gap meanwhile.
const FILTER_JS = (names) => `(async () => {
  const count = () => document.querySelectorAll("aside.sidebar .proj").length;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = document.querySelector('aside.sidebar button[title="Group and sort the list"]');
  if (!open) return { error: "no filter button" };
  // S-02: the panel can take seconds to draw with 150 projects, and a toggle test on aria-pressed no longer matches the button: look for the panel itself.
  if (!document.querySelector("[data-filter-projects]")) open.click();
  for (let i = 0; i < 300 && !document.querySelector("[data-filter-projects] input[type=checkbox]"); i++) await sleep(50);
  const settle = async (action, want) => {
    const before = count();
    let worst = 0, last = performance.now(), frames = 0, stop = false;
    const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; frames++; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    action();
    let ms = -1;
    while (performance.now() - t0 < 5000) {
      if (want(count(), before)) { ms = performance.now() - t0; break; }
      await sleep(5);
    }
    await sleep(150);
    stop = true;
    return { before, after: count(), ms: Math.round(ms * 10) / 10, worstGap: Math.round(worst * 10) / 10, frames };
  };
  const out = [];
  for (const name of ${JSON.stringify(names)}) {
    const box = document.querySelector('input[aria-label="show ' + name + '"]');
    if (!box) { out.push({ name, error: "no checkbox" }); continue; }
    const narrow = await settle(() => box.click(), (n, b) => n !== b);
    const clear = document.querySelector('button[aria-label="clear filters"]');
    const wide = clear && !clear.disabled ? await settle(() => clear.click(), (n, b) => n > b) : { error: "clear filters is disabled" };
    out.push({ name, narrow, wide });
  }
  return { rows: out, boxes: document.querySelectorAll("[data-filter-projects] input[type=checkbox]").length };
})()`;

export async function run({ launch, checks }) {
  const app = await launch("s3");
  await installProbe(app);
  const first = await app.waitFor("the full sidebar", async () => {
    const c = await app.evalJs(COUNTS);
    return c.proj >= PROJECTS ? c : null;
  }, 120000, 500).catch((e) => ({ error: e.message }));
  const c1 = await app.evalJs(COUNTS);
  checks.note(`first load: ${JSON.stringify(first)}; counts now ${JSON.stringify(c1)}`);
  // Reload the page and poll at once: performance.now() is the time since that navigation began.
  await app.evalJs("(() => { setTimeout(() => location.reload(), 50); return 1; })()");
  await app.sleep(300);
  const t0 = Date.now();
  let got = null;
  let polls = 0;
  while (Date.now() - t0 < 120000 && !got) {
    polls++;
    try {
      const c = await app.evalJs(COUNTS);
      if (c.proj >= PROJECTS) got = c;
    } catch {
      /* the page is still loading */
    }
  }
  const full = got ? await app.evalJs(COUNTS) : await app.evalJs(COUNTS).catch(() => ({}));
  checks.add(`sidebar shows all ${PROJECTS} projects after a page load`, `${PROJECTS} .proj rows within ${SIDEBAR_BAR_MS} ms of navigation start`, got ? `${got.now} ms since navigation start (${got.proj} projects, ${got.sess} worktree rows at that moment; polled ${polls}x, cadence ~150 ms)` : `NEVER (counts ${JSON.stringify(full)})`, !!got && got.now <= SIDEBAR_BAR_MS);
  // The panel scans projects one after another and shows no worktree row until the last is done.
  // Cycle 2: workspace_unseen is gone; the one workspace_scan call per project the sidebar makes (T-442-c), started in the page and polled; the panel re-scans every 5 s and drops a scan another one overtook.
  await app.evalJs(`(() => { window.__scan = null; const ids = ${JSON.stringify(Array.from({ length: PROJECTS }, (_, k) => `p-${pad(k + 1)}`))}; const t0 = performance.now(); (async () => { for (const id of ids) { await window.__TAURI_INTERNALS__.invoke("workspace_scan", { projectId: id }); } window.__scan = Math.round(performance.now() - t0); })(); return 1; })()`);
  const peek = async () => { const r = await app.evalJs("window.__scan"); return r && typeof r === "object" && r.result ? r.result.value : r; };
  await app.waitFor("the scan", async () => (await peek()) || null, 240000, 1000).catch(() => null);
  const scanMs = await peek();
  checks.add("one full worktree scan of 150 projects (one workspace_scan each, one after another)", "finishes inside the panel's 5000 ms refresh interval, else its result is dropped when the next scan starts", typeof scanMs === "number" ? `${scanMs} ms (${(scanMs / PROJECTS).toFixed(0)} ms per project)` : `not finished in 240 s (page said ${JSON.stringify(scanMs)})`, typeof scanMs === "number" && scanMs < 5000);
  const settled = await app.waitFor("the worktree rows", async () => {
    const c = await app.evalJs(COUNTS);
    return c.main >= PROJECTS && c.sess >= PROJECTS ? c : null;
  }, 120000, 1000).catch(() => null);
  const counts = await app.evalJs(COUNTS);
  const sample = await app.invoke("workspace_list", { projectId: "p-001" }).catch((e) => `ERR ${e.message}`);
  checks.note(`workspace_list p-001 returned: ${JSON.stringify(sample).slice(0, 500)}`);
  checks.add("every worktree is listed (a main-checkout row and one extra worktree row per project)", `${PROJECTS} button.branch rows + ${PROJECTS} .sess rows`, `${counts.main} main rows + ${counts.sess} worktree rows, ${counts.proj} projects${settled ? `; reached ${settled.now} ms after navigation start` : " (not reached within 120 s)"}`, counts.main >= PROJECTS && counts.sess >= PROJECTS);
  const scroll = await app.evalJs(SCROLL_JS(60));
  if (scroll.error) checks.add("sidebar list scrolls", "scrolls", scroll.error, false);
  else {
    const s = stats(scroll.sync);
    const g = stats(scroll.gaps);
    checks.add("scrolling the sidebar: scroll + layout cost per step (60 steps top to bottom)", `p95 < ${FRAME_BAR_MS} ms, max < ${FRAME_BAR_MS * 2} ms`, `p50 ${fmt(s.p50, 1)}, p95 ${fmt(s.p95, 1)}, max ${fmt(s.max, 1)} ms; scrollHeight ${scroll.scrollHeight}`, s.p95 < FRAME_BAR_MS && s.max < FRAME_BAR_MS * 2);
    checks.add("scrolling the sidebar: frame gap (requestAnimationFrame to the next)", `p95 < ${FRAME_BAR_MS} ms`, scroll.rafWorks ? `p50 ${fmt(g.p50, 1)}, p95 ${fmt(g.p95, 1)}, max ${fmt(g.max, 1)} ms over ${g.n} frames` : "no frames delivered (window occluded off-screen); the per-step cost above is the reading", !scroll.rafWorks || g.p95 < FRAME_BAR_MS);
  }
  const filt = await app.evalJs(FILTER_JS(["proj-001", "proj-075", "proj-150"])).catch((e) => ({ error: e.message }));
  if (filt.error) checks.add("project filter", "opens and narrows the list", filt.error, false);
  else {
    checks.note(`filter panel lists ${filt.boxes} project checkboxes; rows ${JSON.stringify(filt.rows).slice(0, 700)}`);
    const steps = filt.rows.flatMap((r) => (r.error ? [] : [r.narrow, r.wide])).filter((x) => x && !x.error);
    const apply = steps.map((x) => x.ms).filter((x) => x >= 0);
    const gaps = steps.map((x) => x.worstGap);
    const fa = stats(apply), fg = stats(gaps);
    checks.add("filtering: every change moved the list (3 narrow + 3 clear)", "6 of 6 changed the .proj count", `${apply.length} of ${filt.rows.length * 2}${steps.some((x) => x.ms < 0) ? " (some did not move within 5 s)" : ""}; counts ${steps.map((x) => `${x.before}->${x.after}`).join(" ")}`, apply.length === filt.rows.length * 2);
    checks.add("filtering: time until the list changes", `max < 500 ms (my bar; the plan names only per-frame cost)`, apply.length ? `p50 ${fmt(fa.p50, 1)}, max ${fmt(fa.max, 1)} ms over ${fa.n} changes` : "no change observed", apply.length > 0 && fa.max < 500);
    checks.add("filtering: longest frame gap while the list changes", `max < ${FRAME_BAR_MS} ms`, gaps.length ? `p50 ${fmt(fg.p50, 1)}, max ${fmt(fg.max, 1)} ms over ${fg.n} changes` : "none", gaps.length > 0 && fg.max < FRAME_BAR_MS);
  }
  const mem = await snapshot(app);
  checks.note(`app + web view processes: ${mem.filter((p) => /^kolux(-rs)?(\.exe)?$|msedgewebview2/i.test(p.name)).map((p) => `${p.name} ${Math.round(p.ws / 1048576)} MB`).join(", ")}`);
  const errs = await pageErrors(app).catch(() => []);
  checks.add("page errors during the run (this page load)", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);
  checks.add("app is still running at the end", "alive", app.pid && (await app.alive(app.pid)) ? "alive" : "GONE", !!(app.pid && (await app.alive(app.pid))));
}
