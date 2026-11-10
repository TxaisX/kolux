// 10 s idle diagnosis: rAF callers, running animations, trace event counts.
import { open, sleep } from "./cdpx.mjs";
const secs = Number(process.argv[2] || 10);
const c = await open();
await c.evalJs(`(() => { if (window.__raf) return; const orig = window.requestAnimationFrame.bind(window); window.__raf = { n: 0, stacks: {} };
  window.requestAnimationFrame = (cb) => { window.__raf.n++; const s = (new Error().stack || "").split("\n").slice(2, 6).map(l => l.trim().replace(/https?:\/\/[^/]+/, "").replace(/\?[^:]*/, "")).join(" < "); window.__raf.stacks[s] = (window.__raf.stacks[s] || 0) + 1; return orig(cb); };
  const oi = window.setInterval.bind(window); window.__iv = {}; window.setInterval = (f, ms, ...a) => { const s = (new Error().stack || "").split("\n")[2]?.trim().replace(/https?:\/\/[^/]+/, ""); window.__iv[s + " @" + ms] = 1; return oi(f, ms, ...a); }; })()`);
await c.evalJs(`window.__raf.n = 0; window.__raf.stacks = {}; 0`);
const anims = await c.evalJs(`document.getAnimations().map(a => ({ name: a.animationName || a.constructor.name, state: a.playState, el: (a.effect && a.effect.target) ? (a.effect.target.tagName + "." + a.effect.target.className).slice(0, 80) : "?", vis: a.effect && a.effect.target ? a.effect.target.getClientRects().length > 0 : null }))`);
console.log("animations:", JSON.stringify(anims));
const events = [];
c.on("Tracing.dataCollected", (p) => events.push(...p.value));
const done = new Promise((r) => c.on("Tracing.tracingComplete", r));
await c.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline.frame", "disabled-by-default-devtools.timeline", "blink", "cc", "viz", "gpu"], recordMode: "recordAsMuchAsPossible" } });
await sleep(secs * 1000);
await c.send("Tracing.end");
await done;
const raf = await c.evalJs(`JSON.stringify(window.__raf)`);
const count = {};
for (const e of events) { if (e.ph === "M") continue; const k = e.name; count[k] = (count[k] || 0) + 1; }
const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 45);
console.log("trace events (count in", secs, "s):"); for (const [k, v] of top) console.log("  ", v, k);
// who fired timers / rAF
const timers = {}; for (const e of events) if (e.name === "TimerFire" || e.name === "FireAnimationFrame" || e.name === "TimerInstall") { const d = e.args?.data || {}; const k = e.name + " " + (d.stackTrace?.[0] ? `${d.stackTrace[0].functionName}@${d.stackTrace[0].url?.split("/").pop()}:${d.stackTrace[0].lineNumber}` : d.timerId ?? ""); timers[k] = (timers[k] || 0) + 1; }
console.log("timer/raf:", JSON.stringify(Object.entries(timers).sort((a, b) => b[1] - a[1]).slice(0, 15)));
const fns = {}; for (const e of events) if (e.name === "FunctionCall") { const d = e.args?.data || {}; const k = `${d.functionName}@${(d.url || "").split("/").pop()}:${d.lineNumber}`; fns[k] = (fns[k] || 0) + 1; }
console.log("FunctionCall:", JSON.stringify(Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 20)));
console.log("rAF wrapper:", raf);
c.close(); process.exit(0);
