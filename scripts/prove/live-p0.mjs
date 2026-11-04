// LIVE proof, wave 200 crew C39 (seat 191): the two P0 data-loss guards.
//  A. A workspace with a dirty editor tab. Deleting the workspace must ask first, naming the file,
//     before any folder, tab or draft goes; Keep must leave the row, the tab, the text and the draft.
//  B. A floating note with typed text. Quit and Force Reload must ask, naming the note; Keep working
//     must leave the panel open with the text, and the page must not reload.
//  C. The real ~/.kolux/keybindings.json must not be touched (its mtime and size are compared).
// Hidden dev app off-screen, scratch profile and scratch home, ports 1492/9312 so no other proof
// shares this app. Copy beside the other prove scripts in the checkout being proved, then:
//   node scripts/prove/live-p0.mjs
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Before live-common reads them: the two ports this seat owns, fixed so the run is reproducible.
process.env.PROVE_PORT = "1492";
process.env.PROVE_CDP = "9312";

const { reporter, startPlain, finish, sleep, git } = await import("./live-common.mjs");
const { checker } = await import("./live-views-dom.mjs");

const ID = "P0-guards";
const NOTE_TEXT = "floating-note-text-must-survive";
const TAB_TEXT = "dirty-tab-in-the-workspace-must-survive";
const B_NAME = "p0-guard";
const KEYBINDINGS = join(homedir(), ".kolux", "keybindings.json");

const rep = reporter();
const { log, lines } = rep;
const { check, allPassed } = checker(log);
const say = (s) => log(s);

const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const same = (a, b) => !!a && !!b && norm(a) === norm(b);
const stampOf = (p) => {
  try {
    const s = statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
};

// Every visible alertdialog: its accessible name, its words and its buttons. The app's Ask and the
// floating panel's Question both draw the back-out button first.
const asks = (app) =>
  app.evalJs(`[...document.querySelectorAll("[role=alertdialog]")].filter((e) => e.getClientRects().length).map((e) => ({
    label: e.getAttribute("aria-label") || "",
    text: (e.innerText || "").replace(/\\s+/g, " ").trim(),
    buttons: [...e.querySelectorAll("button")].map((b) => b.textContent.trim()),
  }))`);

const askFor = (app, what, ms = 12000) => app.waitFor(`an alertdialog ${what}`, async () => (await asks(app)).find(what) ?? null, ms, 400).catch(() => null);

// The back-out of the topmost visible ask: a button that starts with Keep/Cancel/No, else the first
// one. Answers with the word it clicked.
const clickBackOut = (app) =>
  app.evalJs(`(() => {
    const ds = [...document.querySelectorAll("[role=alertdialog]")].filter((e) => e.getClientRects().length);
    const d = ds[ds.length - 1];
    if (!d) return "no ask";
    const bs = [...d.querySelectorAll("button")];
    const back = bs.find((b) => /^(keep|cancel|no\\b)/i.test(b.textContent.trim())) || bs[0];
    if (!back) return "no button";
    const word = back.textContent.trim();
    back.click();
    return word;
  })()`);

const askGone = (app, ms = 6000) => app.waitFor("the ask to close", async () => (await asks(app)).length === 0, ms, 300).then(() => true, () => false);

const cmDoc = (app, selector) =>
  app.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(selector)}); const v = c && c.cmTile && c.cmTile.view; return v ? v.state.doc.toString() : null; })()`);

const rows = (app) => app.evalJs(`[...document.querySelectorAll("[data-worktree]")].map((e) => ({ label: e.dataset.worktree, path: e.dataset.path, sel: !!e.querySelector(".sess.sel") }))`);

const rowOf = (app, path) =>
  app.evalJs(`(() => { const e = [...document.querySelectorAll("[data-worktree]")].find((x) => x.dataset.path === ${JSON.stringify(path)}); if (!e) return false; (e.querySelector(".sess") || e).dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })()`);

const panelShown = (app) => app.evalJs(`[...document.querySelectorAll(".float-panel")].filter((e) => e.getClientRects().length).length`);
const setMarker = (app) => app.evalJs(`(() => { window.__p0Loaded = "1"; return true; })()`);
const marker = (app) => app.evalJs(`window.__p0Loaded || null`);

const keyBefore = stampOf(KEYBINDINGS);
say(`${ID} live ${new Date().toISOString()}; ports ${process.env.PROVE_PORT}/${process.env.PROVE_CDP}; real keybindings ${JSON.stringify(keyBefore)}`);
let ctx;
let failed = false;
try {
  ctx = await startPlain(ID, { report: rep, files: { "notes.txt": "original line\n" } });
  const { app } = ctx;
  await sleep(2500);

  const href = await app.evalJs("location.href");
  say(`page ${href}; scratch home ${app.paths.userHome}; profile ${app.paths.profile}; real home ${homedir()}`);
  check("the app runs on the reserved port 1492 in its own scratch home and profile", href.includes(`:${process.env.PROVE_PORT}`) && !same(app.paths.userHome, homedir()), href);

  // ---------- A. a workspace with a dirty editor tab, then Delete ----------
  const before = await rows(app);
  await app.click('aside.sidebar .proj button[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 8000);
  await app.focusField('input[aria-label="workspace name"]');
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", B_NAME);
  await sleep(500);
  await app.clickWhere("aside.sidebar button", "/^Create workspace$/");
  await app.waitFor("the new workspace row", async () => (await rows(app)).length > before.length, 90_000, 500);
  const after = await rows(app);
  const made = after.find((r) => !before.some((b) => same(b.path, r.path)));
  check("a second workspace is made and its folder is on disk", !!made && existsSync(made.path), JSON.stringify(after));
  if (!made) throw new Error("no new workspace row: the rest of the proof needs one");
  const B = made.path;
  say(`workspace ${B_NAME} at ${B}`);

  // The row must be the one in front, or the file below opens in another folder.
  await rowOf(app, B);
  await app.waitFor("the new row to be selected", async () => (await rows(app)).some((r) => same(r.path, B) && r.sel), 15000, 400);
  check("the new workspace is the one in front", (await rows(app)).some((r) => same(r.path, B) && r.sel), JSON.stringify(await rows(app)));

  // A dialog left over from the composer would hold the chord.
  for (let i = 0; i < 3; i++) {
    if (!(await app.exists("[role=dialog], [role=alertdialog]"))) break;
    await app.cdp("key", "Escape");
    await sleep(600);
  }

  await app.evalJs(`(() => { document.body.focus(); return true; })()`);
  await app.cdp("key", "p", "2");
  await app.waitFor("the file picker", () => app.exists('[role="dialog"][aria-label^="Open a"]'), 8000);
  await app.focusField('[role="dialog"][aria-label^="Open a"] input');
  await app.cdp("insert", "notes");
  await sleep(1200);
  await app.cdp("key", "Enter");
  const TAB_PANE = 'section.pane.editor[aria-label="notes.txt pane"]';
  await app.waitFor("an editor tab for notes.txt", () => app.exists(TAB_PANE), 20000, 400);
  await app.waitFor("the editor body", () => app.exists(`${TAB_PANE} .cm-content`), 10000, 300);
  await app.focusField(`${TAB_PANE} .cm-content`);
  await app.cdp("insert", TAB_TEXT);
  await sleep(1600); // the draft is written 600 ms after typing stops
  const typed = await cmDoc(app, `${TAB_PANE} .cm-content`);
  check("setup: the workspace's editor tab holds typed text", typeof typed === "string" && typed.includes(TAB_TEXT), JSON.stringify(String(typed).slice(0, 80)));

  const draftsOf = async (wt) => (await app.invoke("editor_drafts_get", { worktree: wt })) ?? [];
  const draftNow = (await draftsOf(B)).find((d) => /notes\.txt$/i.test(d.path));
  check("setup: the unsaved text is kept as a draft for this workspace", !!draftNow && draftNow.text.includes(TAB_TEXT), JSON.stringify((await draftsOf(B)).map((d) => d.path)));
  const status = (await git(B, ["status", "--porcelain"])).trim();
  say(`git status --porcelain in ${B_NAME}: ${JSON.stringify(status)} (the edited file is untouched on disk)`);
  check("setup: the disk copy is unchanged, so the question cannot name it as a Git change", !/notes\.txt/i.test(status), status || "clean");

  const clickedDelete = await app.evalJs(`(() => {
    const e = [...document.querySelectorAll("aside.sidebar [data-worktree]")].find((x) => x.dataset.path === ${JSON.stringify(B)});
    if (!e) return "no row";
    const b = [...e.querySelectorAll("button")].find((x) => /^Delete this workspace/.test(x.title));
    if (!b) return "no Delete this workspace button";
    b.click();
    return "clicked";
  })()`);
  say(`Delete this workspace clicked: ${clickedDelete}`);
  let guard = await askFor(app, (d) => /notes\.txt/i.test(`${d.label} ${d.text}`), 10000);
  if (!guard) {
    // A fix may keep the existing Delete question and ask again on its Delete button: press it once
    // (a scratch workspace, nothing of the user's) and look for the second question.
    const first = await askFor(app, () => true, 6000);
    say(`no question named the file yet; first question ${JSON.stringify(first)}`);
    if (first && /^Delete workspace$/i.test(first.label)) {
      const pressed = await app.evalJs(`(() => {
        const d = [...document.querySelectorAll("[role=alertdialog]")].filter((e) => e.getClientRects().length).pop();
        const b = d && [...d.querySelectorAll("button")].find((x) => /^Delete/.test(x.textContent.trim()));
        if (!b) return "no Delete button";
        b.click();
        return "pressed";
      })()`);
      say(`pressed Delete in the first question to reach the guard: ${pressed}`);
      guard = await askFor(app, (d) => /notes\.txt/i.test(`${d.label} ${d.text}`), 10000);
    }
  }
  check("Delete asks first and the question names the dirty file", !!guard, JSON.stringify(guard ?? (await asks(app))));
  check("nothing is deleted while the question waits: the row and its folder are there", (await rows(app)).some((r) => same(r.path, B)) && existsSync(B), `row ${(await rows(app)).some((r) => same(r.path, B))}, folder ${existsSync(B)}`);
  check("the app is still up while the delete question waits", await app.alive(app.pid), `pid ${app.pid}`);

  const keptDelete = await clickBackOut(app);
  await sleep(700);
  // A guard drawn above the existing Delete question may hand control back to it on Keep; back out
  // of whatever is still up, then judge.
  for (let i = 0; i < 2 && (await asks(app)).length > 0; i++) {
    say(`another question is still up after Keep: ${JSON.stringify((await asks(app)).pop())}`);
    await clickBackOut(app);
    await sleep(700);
  }
  const closedDelete = (await asks(app)).length === 0;
  check("Keep backs out of the delete question", closedDelete, `clicked ${keptDelete}; still up ${JSON.stringify(await asks(app))}`);
  check("after Keep the workspace row and its folder are still there", (await rows(app)).some((r) => same(r.path, B)) && existsSync(B), JSON.stringify((await rows(app)).map((r) => r.label)));
  const tabAfter = await cmDoc(app, `${TAB_PANE} .cm-content`);
  check("after Keep the editor tab still holds the typed text", typeof tabAfter === "string" && tabAfter.includes(TAB_TEXT), JSON.stringify(String(tabAfter).slice(0, 80)));
  const draftsAfter = (await draftsOf(B)).find((d) => /notes\.txt$/i.test(d.path));
  check("after Keep the draft is still kept (editor_drafts_drop did not run)", !!draftsAfter && draftsAfter.text.includes(TAB_TEXT), JSON.stringify((await draftsOf(B)).map((d) => d.path)));
  say(`screenshot: ${await ctx.shot(`${ID}-after-delete-keep`)}`);

  // ---------- B. a floating note with typed text, then Quit and Force Reload ----------
  await app.cdp("key", "a", "3"); // Ctrl+Alt+A: the floating panel
  let open = await app.waitFor("the floating panel", async () => (await panelShown(app)) > 0, 6000, 300).then(() => true, () => false);
  if (!open) {
    await app.evalJs(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })); return true; })()`);
    open = await app.waitFor("the floating panel", async () => (await panelShown(app)) > 0, 6000, 300).then(() => true, () => false);
  }
  check("Ctrl+Alt+A opens the floating workspace panel", open, `visible ${open}`);
  if (!open) throw new Error("the floating panel did not open");

  const added = await app.evalJs(`(() => { const b = [...document.querySelectorAll(".float-panel .none .acts button")].find((x) => x.textContent.trim() === "New note"); if (!b) return "no New note button"; b.click(); return "clicked"; })()`);
  await app.waitFor("the note tab", async () => (await app.evalJs(`document.querySelectorAll(".float-panel .tab").length`)) >= 1, 15000, 300);
  const noteTitle = await app.evalJs(`document.querySelector(".float-panel .tab .name") ? document.querySelector(".float-panel .tab .name").textContent.trim() : ""`);
  say(`New note ${added}; the tab is ${JSON.stringify(noteTitle)}`);
  await app.waitFor("the note editor", () => app.exists(".float-panel .cm-content, .float-panel .md-rich"), 15000, 300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll(".float-panel .view-switch button")].find((x) => x.textContent.trim() === "Source"); if (b) b.click(); return !!b; })()`);
  await sleep(700);
  await app.focusField(".float-panel .cm-content");
  await app.cdp("insert", NOTE_TEXT);
  await sleep(1200);
  const noteText = await cmDoc(app, ".float-panel .cm-content");
  const dirtyDot = await app.evalJs(`!!document.querySelector(".float-panel .tab .unsaved")`);
  check("setup: the floating note holds typed text and is marked unsaved", typeof noteText === "string" && noteText.includes(NOTE_TEXT) && dirtyDot === true, `text ${JSON.stringify(String(noteText).slice(0, 60))}, dot ${dirtyDot}`);
  const noteName = String(noteTitle).replace(/\.md$/i, "");
  check("setup: the note has a name the question can use", noteName.length > 0, JSON.stringify(noteTitle));

  await setMarker(app);
  await app.invoke("plugin:window|close", { label: "main" }).catch((e) => say(`close request answered: ${e}`));
  const quitAsk = await askFor(app, (d) => /quit/i.test(d.label) || (/unsaved/i.test(d.label) && !/reload/i.test(d.label)), 12000);
  check("Quit asks first", !!quitAsk, JSON.stringify(quitAsk ?? (await asks(app))));
  if (!quitAsk) {
    const gone = !(await app.alive(app.pid));
    check("the app did not quit behind the question", !gone, `alive ${!gone}`);
    throw new Error("no quit question: the window closed on its own");
  }
  check("the quit question names the floating note", quitAsk.text.toLowerCase().includes(noteName.toLowerCase()), quitAsk.text);
  check("the quit question offers Keep working and a way to quit without saving", quitAsk.buttons.some((b) => /^keep working$/i.test(b)) && quitAsk.buttons.some((b) => /quit/i.test(b)), JSON.stringify(quitAsk.buttons));
  check("the app is still running while the quit question waits", await app.alive(app.pid), `pid ${app.pid}`);
  say(`quit question: ${JSON.stringify(quitAsk)}`);
  say(`screenshot: ${await ctx.shot(`${ID}-quit-ask`)}`);

  const keptQuit = await clickBackOut(app);
  const closedQuit = await askGone(app);
  await sleep(800);
  const afterQuit = await cmDoc(app, ".float-panel .cm-content");
  check("Keep working backs out of the quit question", closedQuit, `clicked ${keptQuit}`);
  check("after Keep working the floating note still holds its text", typeof afterQuit === "string" && afterQuit.includes(NOTE_TEXT), JSON.stringify(String(afterQuit).slice(0, 60)));
  check("the page did not quit or reload between the question and the answer", (await app.alive(app.pid)) && (await marker(app)) === "1", `alive ${await app.alive(app.pid)}`);

  await app.cdp("key", "r", "10"); // Ctrl+Shift+R: Force Reload
  let reloadAsk = await askFor(app, (d) => /reload/i.test(d.label), 6000);
  if (!reloadAsk) {
    await app.evalJs(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); return true; })()`);
    reloadAsk = await askFor(app, (d) => /reload/i.test(d.label), 6000);
  }
  check("Force Reload asks first", !!reloadAsk, JSON.stringify(reloadAsk ?? (await asks(app))));
  if (reloadAsk) {
    check("the reload question names the floating note", reloadAsk.text.toLowerCase().includes(noteName.toLowerCase()), reloadAsk.text);
    say(`reload question: ${JSON.stringify(reloadAsk)}`);
    const keptReload = await clickBackOut(app);
    const closedReload = await askGone(app);
    await sleep(800);
    const afterReload = await cmDoc(app, ".float-panel .cm-content");
    check("Keep working backs out of the reload question", closedReload, `clicked ${keptReload}`);
    check("the page did not reload: the note still holds its text and the page kept its state", typeof afterReload === "string" && afterReload.includes(NOTE_TEXT) && (await marker(app)) === "1", JSON.stringify(String(afterReload).slice(0, 60)));
    check("the floating panel is still open with the note after both questions", (await panelShown(app)) === 1 && (await app.evalJs(`document.querySelectorAll(".float-panel .tab").length`)) >= 1, `panel ${await panelShown(app)}`);
    say(`screenshot: ${await ctx.shot(`${ID}-reload-keep`)}`);
  }

  // ---------- C. leave cleanly, and the real keybindings file ----------
  await app.invoke("plugin:window|close", { label: "main" }).catch(() => {});
  const quitAgain = await askFor(app, (d) => /quit/i.test(d.label) || (/unsaved/i.test(d.label) && !/reload/i.test(d.label)), 10000);
  say(`last quit question: ${JSON.stringify(quitAgain)}`);
  if (quitAgain) {
    const pressed = await app.evalJs(`(() => {
      const d = [...document.querySelectorAll("[role=alertdialog]")].filter((e) => e.getClientRects().length).pop();
      const bs = d ? [...d.querySelectorAll("button")] : [];
      const b = bs.find((x) => /quit/i.test(x.textContent.trim()) && !/keep/i.test(x.textContent.trim()));
      if (!b) return "no quit button: " + (bs.map((x) => x.textContent.trim()).join("/") || "no ask");
      b.click();
      return "pressed";
    })()`);
    say(`left the app: ${pressed}`);
    await app.waitFor("the app to exit", async () => !(await app.alive(app.pid)), 30000, 500).then(() => true, () => false);
  }
  const exited = !(await app.alive(app.pid));
  check("the app can still be quit deliberately (Quit without saving exits)", exited, `alive ${!exited}`);
} catch (e) {
  failed = true;
  log(`ERROR ${e.stack ?? e}`);
}
const keyEnd = stampOf(KEYBINDINGS);
check("the real ~/.kolux/keybindings.json is untouched (same mtime and size)", JSON.stringify(keyBefore) === JSON.stringify(keyEnd), `before ${JSON.stringify(keyBefore)}, after ${JSON.stringify(keyEnd)}`);
// An aborted run can leave the app up with a question open, which gracefulClose would wait out and
// then leave the ports held. End this run's own tree first; finish() then only clears the dev tree.
if (ctx && (await ctx.app.alive(ctx.app.pid).catch(() => false))) {
  say("teardown: the app is still up after the run; ending the tree this run started");
  await ctx.app.forceStop().catch(() => {});
}
const code = ctx ? await finish(ctx, ID, lines, !failed && allPassed()) : 1;
process.exit(code);
