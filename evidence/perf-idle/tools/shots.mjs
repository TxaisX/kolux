// Screenshot BEFORE (main's always-pulsing dots, emulated by forcing the old animation, captured at a cycle boundary
// where the dot is at full strength) and AFTER (the resting state), then diff the two in the page's own canvas.
import { open, sleep } from "./cdpx.mjs"; import { writeFileSync } from "node:fs";
const [outDir, tag] = process.argv.slice(2);
const c = await open();
const css = (t) => c.evalJs(`(() => { let s = document.getElementById("__ab"); if (!s) { s = document.createElement("style"); s.id = "__ab"; document.head.appendChild(s); } s.textContent = ${JSON.stringify(t)}; return 1; })()`);
const shot = async () => (await c.send("Page.captureScreenshot", { format: "png" })).result.data;
await css(""); await sleep(1500);
const after = await shot();
// Old behaviour, paused exactly at the start of a cycle (opacity 1) and at the faded middle, for the record.
await css(".onb-dot{animation:onb-pulse 1.4s ease-in-out infinite!important}"); await sleep(500);
await c.evalJs(`document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); 1`); await sleep(300);
const beforeFull = await shot();
await c.evalJs(`document.getAnimations().forEach(a => { a.currentTime = 700; }); 1`); await sleep(300);
const beforeMid = await shot();
await css("");
writeFileSync(`${outDir}/idle-${tag}-before-cycle-start.png`, Buffer.from(beforeFull, "base64"));
writeFileSync(`${outDir}/idle-${tag}-before-mid-pulse.png`, Buffer.from(beforeMid, "base64"));
writeFileSync(`${outDir}/idle-${tag}-after-resting.png`, Buffer.from(after, "base64"));
const diff = await c.evalJs(`(async () => { const load = (b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + b; });
  const px = async (b) => { const i = await load(b); const cv = document.createElement("canvas"); cv.width = i.width; cv.height = i.height; const x = cv.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
  const a = await px(${JSON.stringify(beforeFull)}), b = await px(${JSON.stringify(after)}), m = await px(${JSON.stringify(beforeMid)});
  let d1 = 0, d2 = 0; for (let k = 0; k < a.length; k += 4) { if (a[k] !== b[k] || a[k+1] !== b[k+1] || a[k+2] !== b[k+2]) d1++; if (m[k] !== b[k] || m[k+1] !== b[k+1] || m[k+2] !== b[k+2]) d2++; }
  return JSON.stringify({ pixels: a.length / 4, beforeCycleStart_vs_after: d1, beforeMidPulse_vs_after: d2 }); })()`);
console.log(diff);
c.close(); process.exit(0);
