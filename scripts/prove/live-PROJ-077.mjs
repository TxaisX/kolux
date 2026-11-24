// retired: the composer's "setup policy" select and the .trust-prompt question it drove were removed; the setup choice now lives in Settings > Repository setup ("Which setup script runs")
// LIVE proof, PROJ-077 box 2 (spec/01): create with setup skipped -> no setup script runs for it.
// The repo commits a kolux.yaml whose setup script drops setup-ran.txt in the new folder. A first create with the setup policy "Skip setup" must leave no
// file, ask no trust question and open no Setup terminal. A control create with the policy left on Run then asks, and on "Run hooks" does write the file.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, fillComposer, submitComposer, workspaceRows, setSelect } from "./live-proj-common.mjs";

const MARK = "setup-ran.txt";
const YAML = `scripts:\n  setup: echo ran> ${MARK}\n`;
const PROMPT = ".trust-prompt";

export async function run077(ctx, { check, log }) {
  const { app } = ctx;
  await fillComposer(app, { name: "skip-test", skipSetup: true });
  const policy = await app.evalJs(`document.querySelector('select[aria-label="setup policy"]').value`);
  log(`setup policy selected: ${policy}`);
  check("the setup policy reads Skip setup", policy === "skip", policy);
  await submitComposer(app);
  const row = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "skip-test") ?? null, 40000, 500);
  check("the workspace was created", !!row, JSON.stringify(row));
  if (!row) return;
  let asked = false;
  for (let i = 0; i < 16; i++) {
    if (await app.exists(PROMPT)) asked = true;
    await sleep(500);
  }
  const labels = await app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter(e => e.offsetParent !== null).map(e => e.getAttribute("aria-label"))`);
  const kolux = existsSync(join(row.path, "kolux.yaml"));
  log(`skip run: kolux.yaml in the folder=${kolux}; trust prompt shown=${asked}; ${MARK} exists=${existsSync(join(row.path, MARK))}; shown panes ${JSON.stringify(labels)}`);
  check("the repository's setup script is there to run (kolux.yaml is in the new folder)", kolux, row.path);
  check("no trust question about a setup script was asked", !asked, `asked=${asked}`);
  check("no setup script ran (no setup-ran.txt in the new folder after 8 s)", !existsSync(join(row.path, MARK)), row.path);
  check("no Setup terminal opened", !labels.some((l) => /setup/i.test(l)), JSON.stringify(labels));
  log(`screenshot: ${await ctx.shot("PROJ-077")}`);
  // Control: the same repository with setup left on Run does ask and does run it.
  await fillComposer(app, { name: "run-test" });
  if (!(await app.exists("[data-advanced]"))) await app.clickWhere(".composer button.link", "/Advanced/");
  await app.waitFor("the advanced block", () => app.exists("[data-advanced]"), 5000);
  await setSelect(app, 'select[aria-label="setup policy"]', "run");
  const policy2 = await app.evalJs(`document.querySelector('select[aria-label="setup policy"]').value`);
  await submitComposer(app);
  const row2 = await poll(async () => (await workspaceRows(app)).find((r) => r.label === "run-test") ?? null, 40000, 500);
  const prompt = await poll(async () => ((await app.exists(PROMPT)) ? await app.evalJs(`document.querySelector("${PROMPT}").innerText.slice(0, 300)`) : null), 20000, 400);
  log(`control: policy ${policy2}; trust prompt: ${JSON.stringify(prompt)}`);
  check("control: with setup on Run the trust question is asked", !!row2 && !!prompt, JSON.stringify(prompt));
  if (prompt) await app.clickWhere(`${PROMPT} button`, "/^\\s*Run hooks\\s*$/");
  const ran = row2 ? await poll(async () => (existsSync(join(row2.path, MARK)) ? true : null), 30000, 500) : null;
  log(`control: ${MARK} exists=${!!ran}`);
  check("control: after Run hooks the same script does write setup-ran.txt (so the skip run's empty folder is meaningful)", !!ran, row2?.path ?? "");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("PROJ-077", { report: rep, files: { "notes.txt": "live-v5\n", "kolux.yaml": YAML } });
    await sleep(3000);
    await run077(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "PROJ-077", ev, ok) : 1);
}
