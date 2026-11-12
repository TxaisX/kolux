// Shared fixture and page snippets for the spec/12 LIVE proofs (EDIT-*): a small repo, tab/screen pickers and CodeMirror handles.
export { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";
export { checker } from "./live-views-dom.mjs";

const pad = (i) => String(i).padStart(2, "0");
export const multiBase = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
export const multiEdited = multiBase.replace("row 20\n", "row 20 CHANGED\n").replace("row 45\n", "row 45 CHANGED\n");
export const longText = Array.from({ length: 400 }, (_, i) => `line ${i + 1} of the long file`).join("\n") + "\n";
// ~1 MB markdown (the card's size): over the 600 KB rich-view limit.
export const bigMd = "# Big note\n\n" + "A paragraph of plain words for the size test.\n\n".repeat(22000);

/** Committed files, and the 30 files changed after the commit (29 many/* plus multi.txt) for the All Changes card. */
export function editRepo() {
  const files = { "README.md": "# Readme\n\nHello **world**.\n", "alpha/one.txt": "alpha one\n", "alpha/two.txt": "alpha two\n", "beta/three.txt": "beta three\n", "beta/four.txt": "beta four\n", "top.txt": "top\n", "big.md": bigMd, "long.txt": longText, "multi.txt": multiBase };
  const dirty = { "multi.txt": multiEdited };
  for (let i = 1; i <= 29; i++) {
    files[`many/file${pad(i)}.txt`] = `original ${i}\n`;
    dirty[`many/file${pad(i)}.txt`] = `changed ${i}\n`;
  }
  return { files, dirty };
}

/** The visible editor-ish pane (editor, diff, all-changes all carry section.pane.editor) matching an optional class filter. */
export const vis = (extra = "") => `[...document.querySelectorAll("section.pane.editor${extra}")].find(p=>p.offsetParent!==null)`;
/** The visible plain text editor (not a diff or the all-changes pane). */
export const visText = `[...document.querySelectorAll("section.pane.editor")].find(p=>p.offsetParent!==null&&!p.classList.contains("diff")&&!p.classList.contains("all-changes")&&!p.classList.contains("preview"))`;
export const cmOf = (paneExpr, sel = ".cm-content") => `${paneExpr}.querySelector("${sel}").cmTile.view`;

export const clickTab = (app, name) =>
  app.evalJs(`(()=>{const t=[...document.querySelectorAll("div[role=tab]")].find(t=>t.textContent.trim().startsWith(${JSON.stringify(name)})); if(!t) return false; t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); t.click(); return true;})()`);
export const tabs = (app) => app.evalJs(`[...document.querySelectorAll("div[role=tab]")].map(t=>t.textContent.trim()+":"+t.ariaSelected)`);
export const clickRow = (app, name) => app.evalJs(`(()=>{const r=[...document.querySelectorAll(".ex-row")].find(r=>r.textContent.trim()===${JSON.stringify(name)}); if(!r) return false; r.click(); return true;})()`);
/** The visible All Changes pane: the one review of a worktree (EDIT-029). */
export const AC = `[...document.querySelectorAll("section.pane.editor.all-changes")].find(p=>p.offsetParent!==null)`;
/**
 * Opens the All Changes pane of the first project. The right-sidebar Source Control panel that used to hold it went
 * with T-644: the pane now opens from the project (or worktree) row's menu, "Review changes" (src/projects/menu.ts).
 * True when the pane is visible.
 */
export async function openAllChanges(app, ms = 30000) {
  if (await app.evalJs(`!!${AC}`)) return true;
  const opened = await app.evalJs(`(()=>{const row=[...document.querySelectorAll(".sb-main,[data-path]")].find(r=>r.offsetParent!==null); if(!row) return false; const b=row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+b.height/2,button:2})); return true;})()`);
  if (opened) {
    await app.sleep(700);
    await app.evalJs(`(()=>{const i=[...document.querySelectorAll('.sb-menu [role="menuitem"]')].find(b=>b.textContent.trim()==="Review changes"); if(!i||i.disabled) return false; i.click(); return true;})()`);
  }
  return !!(await poll(() => app.evalJs(`!!${AC}`), ms, 500));
}
/** The changed-file count the All Changes tag states ("30 files changed"), or null. */
export const acCount = async (app) => {
  const tag = await app.evalJs(`(()=>{const p=${AC}; return p?p.querySelector(".preview-tag")?.textContent??null:null;})()`);
  const m = /^(\d+)\s+files?/.exec(tag ?? "");
  return { tag, count: m ? Number(m[1]) : null };
};
export const clickScm = (app, path) => app.evalJs(`(()=>{const r=[...document.querySelectorAll(".scm-row")].find(r=>r.title===${JSON.stringify(path)}); if(!r) return false; r.click(); return true;})()`);
// `clickScm` / `openScm` drove the right-sidebar Source Control panel, which T-644 removed. Nothing that still runs calls
// them: only the retired proofs (live-GIT-001/003/004/007/037/040, live-EDIT-027) do, so they stay for those scripts' sake.
export const openScm = (app) => app.evalJs(`(()=>{const t=[...document.querySelectorAll("[role=tab]")].find(t=>t.textContent.trim()==="Source Control"); t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); t.click(); return true;})()`);
export const pickScreen2 = (app, label) => app.evalJs(`(()=>{const b=[...document.querySelectorAll(".switcher button")].find(b=>b.textContent.trim()===${JSON.stringify(label)}); b.click(); return true;})()`);
/** Focus the visible terminal's input and run one command line. */
export async function typeInTerminal(app, line) {
  await app.evalJs(`(()=>{const p=[...document.querySelectorAll("section.pane[data-agent]")].find(p=>p.offsetParent!==null); p.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); p.querySelector(".xterm-helper-textarea").focus(); return true;})()`);
  await app.cdp("insert", line, "enter");
}
/** Poll probe() until it returns something truthy; null on timeout (no throw), so a failed reading is reported as a failed check. */
export async function poll(probe, ms = 15000, every = 500) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await probe();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}
