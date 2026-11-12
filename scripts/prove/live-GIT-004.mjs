// retired: it types into the Source Control panel's commit box, which moved to All Changes when T-644 removed that panel
// LIVE proof, GIT-004 boxes 2+3 (spec/11): a half-written commit message survives switching to another workspace and back;
// a pre-commit hook that exits 1 makes the notice say "blocked" and show what the hook printed.
// Also run inside live-GIT-007.mjs (same fixture, one launch).
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, addUnpublishedBranch, ensurePanel, commitBox, typeDraft, makeWorktree, selectedWorktree, pickMain, git, LIVE_BASE } from "./live-git-common.mjs";

export const git004Fixture = () => ({ files: { "README.md": "# fixture\n", "top.txt": "top\n" }, dirty: { "top.txt": "top changed\n" } });
export const HOOK_TEXT = "HOOK-SAYS-NO: lint failed in top.txt (line 1)";

export async function run004(ctx, { check, log }) {
  const { app, repo } = ctx;
  check("setup: Source Control is open", await ensurePanel(app), "panel visible");
  await sleep(1500);
  const wasSel = await selectedWorktree(app);
  // Box 2: a draft in workspace A, then workspace B, then A again.
  const draft = "half written message for A";
  await typeDraft(app, draft);
  const a0 = await commitBox(app);
  log(`A before switching (${wasSel}): ${JSON.stringify(a0)}`);
  check("setup: the draft is in workspace A's commit box", a0?.value === draft, JSON.stringify(a0));
  const made = await makeWorktree(app, "wt-b", log);
  await ensurePanel(app);
  await sleep(1500);
  const selB = await selectedWorktree(app);
  const b0 = await commitBox(app);
  log(`switched to ${selB}: ${JSON.stringify(b0)}`);
  check("setup: workspace B (wt-b) exists and is shown, with its own empty commit box", made && selB === "wt-b" && b0?.value === "", JSON.stringify({ made, selB, b0 }));
  await pickMain(app);
  await sleep(2500);
  await ensurePanel(app);
  const selA = await selectedWorktree(app);
  const a1 = await poll(async () => { const c = await commitBox(app); return c && c.value === draft ? c : null; }, 8000, 500);
  const a1r = a1 ?? (await commitBox(app));
  log(`back in ${selA}: ${JSON.stringify(a1r)}`);
  check("coming back to workspace A, the draft is still there", selA === "main" && a1r?.value === draft, JSON.stringify({ selA, a1r }));
  log(`screenshot: ${await ctx.shot("GIT-004-draft-back")}`);

  // Box 3: a pre-commit hook that exits 1 (in this scratch repo only).
  const hookDir = join(repo, ".git", "hooks");
  mkdirSync(hookDir, { recursive: true });
  const hook = join(hookDir, "pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho "${HOOK_TEXT}" >&2\nexit 1\n`);
  try { chmodSync(hook, 0o755); } catch {}
  writeFileSync(join(repo, "top.txt"), `top staged ${Date.now()}
`);
  await git(repo, ["add", "top.txt"]);
  const commitsBefore = (await git(repo, ["rev-list", "--count", "HEAD"])).trim();
  const staged = await poll(async () => {
    const b = await commitBox(app);
    return b && b.main === "Commit" && !b.mainDisabled ? b : null;
  }, 15000, 500);
  const pre = await commitBox(app);
  log(`staged top.txt; main button: ${JSON.stringify(pre)}`);
  check("setup: with a staged file and the draft, the main button reads Commit and is enabled", !!staged, JSON.stringify(pre));
  await app.evalJs(`document.querySelector(".sidebar.scm .scm-main button.btn.primary").click()`);
  const note = await poll(async () => { const n = await app.evalJs(`(()=>{const o=document.querySelector(".sidebar.scm .scm-out[role=alert]"); return o?{found:true,title:o.querySelector("summary")?.textContent??null, summary:o.querySelector("[data-failure-summary]")?.textContent??null, text:o.textContent.slice(0,300)}:{found:false};})()`); return n && n.found ? n : null; }, 20000, 500);
  log(`notice: ${JSON.stringify(note)}`);
  check("the notice says the commit was blocked by a hook", !!note && /blocked/i.test(note.title ?? ""), JSON.stringify(note));
  await app.evalJs(`(()=>{const d=document.querySelector(".sidebar.scm .scm-out details"); if(d) d.open=true; return !!d;})()`);
  await sleep(600);
  const shown = await app.evalJs(`(()=>{const pre=document.querySelector(".sidebar.scm .scm-out pre"); return pre?{text:pre.textContent, visible:pre.offsetParent!==null&&pre.getBoundingClientRect().height>0}:null;})()`);
  log(`details expanded: ${JSON.stringify(shown)}`);
  check("expanded, the notice shows what the hook printed", !!shown && shown.visible && shown.text.includes(HOOK_TEXT), JSON.stringify(shown));
  const commitsAfter = (await git(repo, ["rev-list", "--count", "HEAD"])).trim();
  const keep = await commitBox(app);
  log(`commits ${commitsBefore} -> ${commitsAfter}; draft kept: ${keep?.value}`);
  check("no commit was made and the message is still in the box", commitsAfter === commitsBefore && keep?.value === draft, JSON.stringify({ commitsBefore, commitsAfter, keep }));
  log(`screenshot: ${await ctx.shot("GIT-004-blocked")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("GIT-004", { report: rep, ...git004Fixture(), prepare: (repo) => addUnpublishedBranch(repo, `${LIVE_BASE}/work/GIT-004-origin.git`) });
    await sleep(3000);
    await run004(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "GIT-004", ev, ok) : 1);
}
