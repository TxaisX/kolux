// LIVE proof, wave 201 (Next 2): a workspace picture and video reach the Artifacts viewer and show.
//  A. `artifacts/shot.png` written in the open workspace is imported by the 3 s scan and listed.
//  B. Picking it shows an <img> from the kolux-artifact scheme with real pixels.
//  C. `artifacts/clip.mp4` is imported too, and picking it shows a <video> that reports a duration,
//     a picture size and a seek that lands.
// Hidden dev app off-screen, scratch profile and scratch home, ports 1493/9313 so no other proof
// shares this app. Run from the checkout being proved:
//   node scripts/prove/live-artifacts.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

process.env.PROVE_PORT = "1493";
process.env.PROVE_CDP = "9313";

const { reporter, startPlain, finish, sleep } = await import("./live-common.mjs");
const { checker } = await import("./live-views-dom.mjs");

const ID = "artifacts-media";
const B_NAME = "artifacts-room";
const rep = reporter();
const { log, lines } = rep;
const { check, allPassed } = checker(log);
const say = (s) => log(s);

const rows = (app) => app.evalJs(`[...document.querySelectorAll("[data-worktree]")].map((e) => ({ label: e.dataset.worktree, path: e.dataset.path, sel: !!e.querySelector(".sess.sel") }))`);
const titles = (app) => app.evalJs(`[...document.querySelectorAll(".art-row .art-title .name")].map((e) => e.textContent.trim())`);

const pick = (app, title) =>
  app.evalJs(`(() => {
    const row = [...document.querySelectorAll(".art-row")].find((b) => b.querySelector(".art-title .name")?.textContent.trim() === ${JSON.stringify(title)});
    if (!row) return false;
    row.click();
    return true;
  })()`);

const media = (app) =>
  app.evalJs(`(() => {
    const i = document.querySelector("img.art-image");
    const v = document.querySelector("video.art-video");
    return {
      image: i ? { src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight, complete: i.complete } : null,
      video: v ? { src: v.currentSrc || v.src, duration: v.duration, w: v.videoWidth, h: v.videoHeight, ready: v.readyState, time: v.currentTime } : null,
    };
  })()`);

let ctx;
let failed = false;
let shotPng = "";
let clipMp4 = "";
try {
  ctx = await startPlain(ID, { report: rep, files: { "notes.txt": "original line\n" } });
  const { app } = ctx;
  await sleep(2500);

  const href = await app.evalJs("location.href");
  check("the app runs on the reserved port 1493 in its own scratch profile", href.includes(`:${process.env.PROVE_PORT}`), href);

  const all = await rows(app);
  let open = all.find((r) => r.sel) ?? all[0];
  if (!open) {
    // A project opens its first pane but no workspace row; make one the way a person does.
    await app.click('aside.sidebar .proj button[title^="New workspace"]');
    await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 8000);
    await app.focusField('input[aria-label="workspace name"]');
    await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
    await app.cdp("insert", B_NAME);
    await sleep(500);
    await app.clickWhere("aside.sidebar button", "/^Create workspace$/");
    await app.waitFor("the new workspace row", async () => (await rows(app)).length > 0, 90_000, 500);
    const made = await rows(app);
    open = made.find((r) => r.sel) ?? made[0];
  }
  check("the added project has an open workspace whose folder is on disk", !!open && existsSync(open.path), JSON.stringify(await rows(app)));
  if (!open) throw new Error("no workspace row: the proof needs an open workspace");

  // The scan imports only what an agent puts in the workspace's own `artifacts/` folder.
  const folder = join(open.path, "artifacts");
  mkdirSync(folder, { recursive: true });
  shotPng = join(folder, "shot.png");
  clipMp4 = join(folder, "clip.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=#c0392b:s=96x64", "-frames:v", "1", shotPng], { windowsHide: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clipMp4], { windowsHide: true });
  check("a PNG and an MP4 are written under the workspace artifacts folder", existsSync(shotPng) && existsSync(clipMp4), `${folder}`);

  await app.clickWhere("aside.sidebar button.row", "/^\\s*Artifacts\\s*$/");
  await app.waitFor("the Artifacts viewer", () => app.exists(".art-view"), 15000);
  check("Artifacts opens from the sidebar", await app.exists(".art-view"), await app.evalJs('document.querySelector(".art-view")?.getBoundingClientRect().width ?? 0'));

  // The page scans every 3 s while open; a fresh run may need two ticks to import both files.
  await app.waitFor("shot.png and clip.mp4 to be listed", async () => {
    const t = await titles(app);
    return t.includes("shot.png") && t.includes("clip.mp4");
  }, 20000, 500).catch(() => {});
  const listed = await titles(app);
  check("the picture and the video are imported and listed", listed.includes("shot.png") && listed.includes("clip.mp4"), JSON.stringify(listed));

  // ---------- B. the picture ----------
  check("the picture row can be picked", await pick(app, "shot.png"), "shot.png");
  await app.waitFor("the picture to load", async () => {
    const m = await media(app);
    return !!m.image && m.image.complete && m.image.w > 0;
  }, 10000, 300).catch(() => {});
  const pm = await media(app);
  check("the picture shows from the artifact scheme with real pixels", !!pm.image && pm.image.w > 0 && pm.image.h > 0, JSON.stringify(pm.image));
  check("the picture comes from the app's own scheme, not the network", !!pm.image && /^http:\/\/kolux-artifact\.localhost\//.test(pm.image.src), pm.image?.src ?? "none");

  // ---------- C. the video ----------
  check("the video row can be picked", await pick(app, "clip.mp4"), "clip.mp4");
  await app.waitFor("the video to report metadata", async () => {
    const m = await media(app);
    return !!m.video && m.video.ready >= 1 && m.video.duration > 0;
  }, 15000, 400).catch(() => {});
  const vm = await media(app);
  check("the video shows from the artifact scheme with a real duration and picture size", !!vm.video && vm.video.duration > 0 && vm.video.w > 0 && vm.video.h > 0, JSON.stringify(vm.video));

  const seeked = await app.evalJs(`new Promise((resolve) => {
    const v = document.querySelector("video.art-video");
    if (!v) return resolve({ ok: false, why: "no video element" });
    const done = () => resolve({ ok: v.currentTime >= 0.5, time: v.currentTime, duration: v.duration });
    v.addEventListener("seeked", done, { once: true });
    v.currentTime = Math.min(1, (v.duration || 2) / 2);
    setTimeout(() => resolve({ ok: v.currentTime >= 0.5, time: v.currentTime, duration: v.duration, timeout: true }), 8000);
  })`);
  check("the video seeks to the middle and reports the new time", !!seeked && seeked.ok === true, JSON.stringify(seeked));
  say(`media: ${JSON.stringify(pm)} ${JSON.stringify(vm)}`);
} catch (e) {
  failed = true;
  log(`ERROR ${e.stack ?? e}`);
}
if (ctx && (await ctx.app.alive(ctx.app.pid).catch(() => false))) {
  say("teardown: the app is still up after the run; ending the tree this run started");
  await ctx.app.forceStop().catch(() => {});
}
const code = ctx ? await finish(ctx, ID, lines, !failed && allPassed()) : 1;
process.exit(code);
