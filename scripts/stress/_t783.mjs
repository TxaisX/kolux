import { newApp, seedProfile, dismissFirstRun } from "./lib.mjs";
import { run as sh } from "../evidence/app-launch.mjs";
const opts = { root: process.cwd(), port: 1423, cdp: 9263, temp: "G:/Temp/stress" };
const app = newApp(opts, "ready-tools-T-783");
try {
  await app.launch({ prepare: seedProfile(app, {}) });
  await app.sleep(3000);
  await dismissFirstRun(app);
  await app.evalJs(`window.dispatchEvent(new Event("kolux-about"))`);
  await app.sleep(1200);
  console.log("about open:", await app.exists('[role="dialog"][aria-label="About Kolux"]'));
  await app.clickWhere("button", "/Third-party notices/");
  await app.sleep(2500);
  const info = await app.evalJs(`(() => { const p = document.querySelector("pre.about-notices"); const a = document.querySelector('[role="alert"]'); return { pre: p ? p.textContent.length : null, head: p ? p.textContent.slice(0, 60) : null, hasTauri: p ? p.textContent.includes("\n  tauri ") : null, hasReact: p ? p.textContent.includes("\n  react ") : null, alert: a ? a.textContent : null }; })()`);
  console.log(JSON.stringify(info));
  const r = await sh("powershell", ["-NoProfile","-File","scripts/evidence/shot.ps1","-Out","evidence/T-783.png","-ProcessId",String(app.pid)]);
  console.log(r.stdout.trim());
} finally { await app.closeApp().catch(()=>{}); }
