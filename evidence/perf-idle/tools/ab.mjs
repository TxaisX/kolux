// Alternating A/B: node ab.mjs <rounds> <secs> <name=css>... ; "base" = no injected css. Prints per-sample and mean.
import { open, sleep } from "./cdpx.mjs"; import { execFileSync } from "node:child_process"; import { readFileSync } from "node:fs";
const [rounds, secs, ...vars] = process.argv.slice(2);
const pid = JSON.parse(readFileSync(new URL("./app.json", import.meta.url))).pid;
const variants = vars.map((v) => { const i = v.indexOf("="); return [v.slice(0, i), v.slice(i + 1)]; });
const c = await open();
const apply = (css) => c.evalJs(`(() => { let s = document.getElementById("__ab"); if (!s) { s = document.createElement("style"); s.id = "__ab"; document.head.appendChild(s); } s.textContent = ${JSON.stringify(css)}; return 1; })()`);
const res = {};
for (let r = 0; r < Number(rounds); r++) for (const [name, css] of variants) {
  await apply(css); await sleep(3000);
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", new URL("./gpusample.ps1", import.meta.url).pathname.slice(1), "-AppPid", String(pid), "-Seconds", secs]).toString().trim();
  const m = Object.fromEntries(out.split(" ").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
  (res[name] ??= []).push(m); console.log(`round ${r + 1} ${name.padEnd(10)} ${out}`);
}
await apply("");
for (const [name, rows] of Object.entries(res)) { const avg = (k) => (rows.reduce((a, x) => a + x[k], 0) / rows.length).toFixed(2); console.log(`MEAN ${name.padEnd(10)} gpuCpu=${avg("gpuCpu")} rendererCpu=${avg("rendererCpu")} gpuEng=${avg("gpuEng")} (n=${rows.length})`); }
c.close(); process.exit(0);
