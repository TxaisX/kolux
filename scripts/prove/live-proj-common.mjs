// Shared fixtures and page readings for the spec/01 + spec/02 LIVE proofs (PROJ-*, SESS-*): a stand-in Claude on PATH, a repo with a
// local bare "remote", the New workspace composer, and readings of panes, tabs and sidebar rows. Nothing here reaches a real host.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { git, LIVE_BASE, LIVE_LOGS } from "./live-common.mjs";

export * from "./live-git-common.mjs";
export { git, LIVE_BASE, LIVE_LOGS };

export const CLAUDE_PANE = 'section.pane[data-agent*="claude"]';
export const STANDIN_BANNER = "Kolux stand-in for Claude Code (live-v1): banner only";

/** Body lines for startPlain opts.standin: the stand-in claude.cmd (set as the claude command, so no real claude on any PATH is ever started) echoes its argv and its folder. */
export const STANDIN_BODY = ["echo ARGV: %*", "echo CWD: %CD%"];

/** A bare repo next to the work repo, wired as origin, with main (and optionally more branches) pushed. */
export async function addBareOrigin(repo, originDir, extraBranches = []) {
  rmSync(originDir, { recursive: true, force: true });
  mkdirSync(originDir, { recursive: true });
  await git(originDir, ["init", "-q", "--bare", "-b", "main"]);
  await git(repo, ["config", "user.name", "prove"]);
  await git(repo, ["config", "user.email", "prove@example.invalid"]);
  await git(repo, ["remote", "add", "origin", originDir]);
  await git(repo, ["push", "-q", "-u", "origin", "main"]);
  for (const b of extraBranches) {
    await git(repo, ["checkout", "-q", "-b", b]);
    writeFileSync(join(repo, `${b}.txt`), `branch ${b}\n`);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-q", "-m", `work on ${b}`]);
    await git(repo, ["push", "-q", "-u", "origin", b]);
    await git(repo, ["checkout", "-q", "main"]);
  }
}

/** Every pane section (shown or not): agent id, aria-label, shown flag. */
export const panes = (app) =>
  app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].map(e => ({ agent: e.getAttribute("data-agent"), label: e.getAttribute("aria-label"), shown: e.offsetParent !== null }))`);
export const shownPanes = async (app) => (await panes(app)).filter((p) => p.shown);
export const tabLabels = (app) => app.evalJs(`[...document.querySelectorAll("div[role=tab]")].map(t => t.textContent.trim())`);

export const setSelect = (app, sel, value) =>
  app.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value === ${JSON.stringify(value)}; })()`);

/** Opens the New workspace composer on the first project and types the name. fields: {name, agent, note, skipSetup, base, advanced}. Does not submit. */
export async function fillComposer(app, f) {
  await app.click('.proj button.ib[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 8000);
  await app.focusField('input[aria-label="workspace name"]');
  await app.sleep(1500);
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", f.name);
  if (f.agent !== undefined) await setSelect(app, 'select[aria-label="agent"]', f.agent);
  if (f.note) {
    await app.focusField('textarea[aria-label="note"]');
    await app.cdp("insert", f.note);
  }
  if (f.skipSetup || f.base) {
    await app.clickWhere(".composer button.link", "/Advanced/");
    await app.waitFor("the advanced block", () => app.exists("[data-advanced]"), 5000);
    if (f.skipSetup) await setSelect(app, 'select[aria-label="setup policy"]', "skip");
    if (f.base) {
      await app.focusField('input[aria-label="start from"]');
      await app.cdp("insert", f.base);
    }
  }
  const read = () => app.evalJs(`({ preview: document.querySelector(".sb-form .preview")?.textContent || "", field: document.querySelector('input[aria-label="workspace name"]')?.value ?? null })`);
  await app.waitFor(`the preview names ${f.name}`, async () => new RegExp(`^branch .*${f.name}`).test((await read()).preview), 8000);
}
export const submitComposer = (app) => app.clickWhere(".composer .btn-row button", "/^\\s*Create workspace\\s*$/");

/** Sidebar rows: label, folder path, selected flag. */
export const workspaceRows = (app) =>
  app.evalJs(`[...document.querySelectorAll("[data-worktree]")].map(e => ({ label: e.dataset.worktree, path: e.dataset.path, sel: !!e.querySelector(".sess.sel") }))`);

/** The sidebar's last status note (class "note"): kind and text. */
export const sidebarNote = (app) =>
  app.evalJs(`(() => { const n = [...document.querySelectorAll(".sidebar .note")].filter(e => !e.closest("[role=alertdialog]")).pop(); return n ? { cls: n.className, text: n.textContent.trim() } : null; })()`);

export const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Worktrees made outside Kolux are hidden by default (source "other"); show them, as the Settings choice "Elsewhere on disk" does. */
export const showElsewhere = (app) => app.invoke("visibility_set", { projectId: null, source: "other", show: true });
