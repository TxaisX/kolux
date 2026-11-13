// LIVE proof, CLI-007 boxes 1 and 2 (spec/20): the app's own CLI is at the front of every pane's program search path.
// The dev build's CLI is kolux-dev (spec CLI-007 Compat: "kolux, and kolux-dev for development builds"); an unqualified `kolux` is never run.
// Box 2's "older kolux registered system-wide" is simulated by an older kolux-dev.cmd on the app process's own scratch PATH, never the real registry.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, LIVE_BASE, norm } from "./live-proj-common.mjs";
import { runCli, SHELL } from "./live-cli-common.mjs";

const OLDER = `${LIVE_BASE}/older-CLI-007`;

/** Runs a PowerShell line in the first shown shell pane; its output goes to a file read back as text. */
async function pane(ctx, tag, ps) {
  const out = `${ctx.TEMP}/cli/${tag}.txt`;
  mkdirSync(`${ctx.TEMP}/cli`, { recursive: true });
  rmSync(out, { force: true });
  await ctx.typeInto(0, `& { ${ps} } 2>&1 | Out-File -Encoding utf8 '${out}'; Write-Output ('D'+'ONE-${tag}')`, SHELL);
  await poll(async () => new RegExp(`^DONE-${tag}$`, "m").test((await ctx.text(0, SHELL)) ?? ""), 30000, 400);
  return existsSync(out) ? readFileSync(out, "utf8").replace(/^﻿/, "").trim() : "";
}

export async function run007(ctx, { check, log }) {
  const { app } = ctx;
  const appDir = norm(ctx.appDir);
  // The pane's search order: only the two entries this run knows about are named; the rest of the real PATH is not printed.
  const pathText = await pane(ctx, "path", "$env:Path");
  const entries = pathText.split(";").map((e) => norm(e)).filter(Boolean);
  const iApp = entries.indexOf(appDir);
  const iOld = entries.indexOf(norm(OLDER));
  log(`pane PATH: ${entries.length} entries; the app's own folder at index ${iApp}; the older scratch kolux at index ${iOld}`);
  const where = (await pane(ctx, "where", "Get-Command kolux-dev -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }")).split(/\r?\n/).map((l) => norm(l.trim())).filter(Boolean);
  log(`kolux-dev resolves, in order: ${where.map((w) => (w.startsWith(appDir) ? "<app folder>/" + w.slice(appDir.length + 1) : w.startsWith(norm(OLDER)) ? "<older scratch>/" + w.split("/").pop() : "<other>")).join(" ; ")}`);

  // ---- box 1: no older copy involved, plain status ----
  const st = await runCli(ctx, "status");
  log(`kolux-dev status -> exit=${st.exit} ${JSON.stringify(st.json ?? st.raw.slice(0, 160))}`.slice(0, 400));
  check("b1: the app's CLI is first on the pane's search path", iApp >= 0 && where[0]?.startsWith(appDir), `index=${iApp} first=${where[0]?.startsWith(appDir) ? "<app folder>" : "other"}`);
  check("b1: `kolux-dev status` works in a fresh pane with nothing registered for the system", st.exit === 0, `exit=${st.exit}`);
  log(`screenshot b1: ${await ctx.shot("CLI-007-b1")}`);

  // ---- box 2: an older kolux-dev earlier-registered elsewhere on the search path ----
  const ver = (await pane(ctx, "ver", "kolux-dev --version")).split(/\r?\n/).pop().trim();
  const older = (await pane(ctx, "older", `& '${OLDER.replace(/\//g, "\\")}\\kolux-dev.cmd' --version`)).split(/\r?\n/).pop().trim();
  const want = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")).version;
  log(`kolux-dev --version in the pane: ${ver}; the older scratch copy prints: ${older}; the app's own version: ${want}`);
  // The pane's PATH is rebuilt from the real machine and user registry (TERM-120), so the scratch PATH does not reach it: the older copy is absent
  // (index -1) and the matching version above would hold with or without the fix. That is not a reading of the box: DRIFT, not a check.
  log(`b2 NOT PROVEN (DRIFT): the older scratch copy is ${iOld < 0 ? "not on the pane's search path at all" : "on it"}; a real system-wide registration is needed`);
  log(`screenshot b2: ${await ctx.shot("CLI-007-b2")}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    rmSync(OLDER, { recursive: true, force: true });
    mkdirSync(OLDER, { recursive: true });
    writeFileSync(`${OLDER}/.kolux-scratch`, "");
    writeFileSync(`${OLDER}/kolux-dev.cmd`, "@echo off\r\necho 0.0.1-older\r\n");
    ctx = await startPlain("CLI-007", { report: rep, standin: STANDIN_BODY, pathDirs: [OLDER] });
    ctx.appDir = `${new URL("../../src-tauri/target/debug", import.meta.url).pathname.slice(1)}`;
    await sleep(3000);
    await run007(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "CLI-007", ev, ok) : 1);
}
