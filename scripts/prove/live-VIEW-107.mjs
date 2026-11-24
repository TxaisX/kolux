// retired: the code editor it drove was removed in fccac517, so there is no unsaved buffer left to prompt about.
// LIVE proof, VIEW-107 box 2 (spec/05): quit with an unsaved editor buffer -> a prompt, no silent loss. Hidden app: open a
// file of the throwaway repo in an editor tab, type into it (unsaved), ask the window to close (what the X button sends),
// read the prompt, keep working, and check the window stayed and the file on disk is untouched.
import { readFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, waitFor, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
const ORIGINAL = "original line\n";
try {
  ctx = await startPlain("VIEW-107", { report: rep, files: { "notes.txt": ORIGINAL } });
  const { app, repo } = ctx;
  await sleep(3000);
  await app.focusPane('section.pane[data-agent]', 0, ".xterm-helper-textarea");
  await app.cdp("key", "p", "2"); // Ctrl+P: Go to File
  await waitFor("the file picker", () => app.exists('[role="dialog"][aria-label^="Open a"]'), 8000);
  await app.focusField('[role="dialog"][aria-label^="Open a"] input');
  await app.cdp("insert", "notes");
  await sleep(1200);
  await app.cdp("key", "Enter");
  await waitFor("an editor tab with the file", () => app.exists(".cm-content"), 20000, 500);
  await sleep(1000);
  await app.focusField(".cm-content");
  await app.cdp("insert", "UNSAVED-EDIT ");
  await sleep(800);
  const buf = await app.evalJs(`document.querySelector(".cm-content").innerText`);
  log(`editor buffer now: ${JSON.stringify(buf.slice(0, 60))}`);
  check("setup: the editor shows the typed text and the file on disk is unchanged", /UNSAVED-EDIT/.test(buf) && readFileSync(`${repo}/notes.txt`, "utf8") === ORIGINAL, JSON.stringify(buf.slice(0, 40)));
  log(`screenshot: ${await ctx.shot("VIEW-107-edited")}`);

  // The window's own close request (the X button sends the same one).
  await app.invoke("plugin:window|close", { label: "main" }).catch((e) => log(`close request: ${e}`));
  await sleep(2500);
  const ask = await app.evalJs(`(() => { const t = document.body.innerText; const q = /Quit with unsaved changes\\?/.test(t); const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((x) => /Keep working|Quit without saving/.test(x)); const body = (t.match(/\\d+ files? ha(?:s|ve) unsaved changes[^\\n]*/) ?? [""])[0]; return { q, btns, body }; })()`);
  log(`after the close request: ${JSON.stringify(ask)}`);
  check("a prompt titled Quit with unsaved changes? appears, naming the file, with Keep working and Quit without saving", ask.q && ask.btns.length === 2 && /notes\.txt/.test(ask.body), JSON.stringify(ask));
  const still = await app.alive(app.pid);
  check("the window stays open (the app process is still running and answering)", still && (await app.exists(".cm-content")), `alive ${still}`);
  check("no silent loss: the file on disk still has its original text", readFileSync(`${repo}/notes.txt`, "utf8") === ORIGINAL, "unchanged");
  log(`screenshot: ${await ctx.shot("VIEW-107-prompt")}`);
  await app.clickWhere("button", "/^\\s*Keep working\\s*$/");
  await sleep(1200);
  const after = await app.evalJs(`({ prompt: /Quit with unsaved changes\\?/.test(document.body.innerText), buffer: document.querySelector(".cm-content")?.innerText.slice(0, 40) })`);
  log(`after Keep working: ${JSON.stringify(after)}`);
  check("Keep working closes the prompt and the buffer still has the edit", !after.prompt && /UNSAVED-EDIT/.test(after.buffer ?? ""), JSON.stringify(after));
  // Leave cleanly: ask again and take "Quit without saving" (also shows the prompt's confirm really quits).
  await app.invoke("plugin:window|close", { label: "main" }).catch(() => {});
  await waitFor("the prompt again", () => app.evalJs(`/Quit with unsaved changes\\?/.test(document.body.innerText)`), 8000, 400);
  await app.clickWhere("button", "/^\\s*Quit without saving\\s*$/");
  const gone = await waitFor("the app to exit after Quit without saving", async () => !(await app.alive(app.pid)), 30000, 500).then(() => true, () => false);
  check("Quit without saving does quit the app (only after the user chose it)", gone, `exited ${gone}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-107", ev, ok) : 1);
