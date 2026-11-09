// Live check of the rest: state now, after a pointer move (pulses again), after 5 s (still pulsing), after 12 s (rested).
import { open, sleep } from "./cdpx.mjs";
const c = await open();
const st = () => c.evalJs(`JSON.stringify({ tiles: document.querySelector(".onb-tiles")?.className, running: document.getAnimations().filter(a => a.playState === "running").map(a => a.animationName).length })`);
console.log("idle:", await st());
await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200, y: 200 });
await sleep(300); console.log("after pointer move:", await st());
await sleep(5000); console.log("5 s later:", await st());
await sleep(7000); console.log("12 s later:", await st());
c.close(); process.exit(0);
