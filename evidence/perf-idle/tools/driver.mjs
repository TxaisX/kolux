// Launch the lane's dev app (stress launcher), open 1 shell pane, optionally grow to N panes on request, stay up until ./stop exists.
import { existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const LANE = "G:/Dev/kolux-rs-lanes/perf-idle";
const lib = await import("file:///" + LANE + "/scripts/stress/lib.mjs");
const HERE = "<this tools folder>";
for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_")) delete process.env[k];
const opts = { root: LANE.replace(/\//g, "\\"), port: 1447, cdp: 9447, temp: "G:/Temp/stress" };
rmSync(join(HERE, "stop"), { force: true });
const app = lib.newApp(opts, "perfidle");
await app.launch({ prepare: lib.seedProfile(app, { terminalGpu: "auto" }) });
const repo = join(app.temp, "repo");
await lib.gitInit(app, repo, "pi");
await lib.addProjectAndOpen(app, repo);
writeFileSync(join(HERE, "app.json"), JSON.stringify({ pid: app.pid, temp: app.temp, devPid: app.dev?.pid }));
console.log("READY pid", app.pid);
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);
const shown = async () => Number(unwrap(await app.shown(lib.TERM)));
while (!existsSync(join(HERE, "stop"))) {
  const g = join(HERE, "grow");
  if (existsSync(g)) {
    const want = Number(readFileSync(g, "utf8")); rmSync(g);
    for (let n = await shown(); n < want; n++) {
      await app.focusPane(lib.TERM, 0, ".xterm-helper-textarea");
      await app.click('.pane.focused button[title^="Split right"]');
      await app.waitFor(`${n + 1} panes`, async () => (await shown()) === n + 1, 30000);
    }
    console.log("GROWN", await shown());
  }
  await app.sleep(1000);
}
console.log("closing", JSON.stringify(await app.closeApp()));
lib.removeTemp(app.temp);
process.exit(0);
