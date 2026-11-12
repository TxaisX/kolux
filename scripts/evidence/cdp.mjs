// Evidence harness: start the dev app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222,
// then this script sends keys and reads the DOM over that port. Nothing goes through the shared
// keyboard, so it works while another window holds the foreground.
// Drives the dev app's own WebView2 through its remote-debugging port (never the shared keyboard).
// usage: node cdp.mjs list
//        node cdp.mjs <targetMatch> eval "<js>"
//        node cdp.mjs <targetMatch> type "<text>" [enter]   (focus must already be in a field)
//        node cdp.mjs <targetMatch> insert "<text>" [enter]   (one edit, emoji safe)
//        node cdp.mjs <targetMatch> key <Enter|Escape|...> [mods: Alt=1 Ctrl=2 Shift=8]
//        node cdp.mjs <targetMatch> focus "<css selector>"
//        node cdp.mjs <targetMatch> hover "<css selector>"   (moves the pointer to its centre)
//        node cdp.mjs <targetMatch> wheel "<css selector>" <deltaY>   (the mouse wheel over its middle)
//        node cdp.mjs <targetMatch> rightclick "<css selector>"   (right press at its centre; opens a context menu)
// targetMatch is a substring of the target's url or title; "main" = the localhost dev page.
const PORT = process.env.CDP_PORT || "9222";
const [match, cmd, ...rest] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
if (match === "list" || !match) {
  for (const t of targets) console.log(t.type, "|", t.title, "|", t.url);
  process.exit(0);
}
// The app's own page is the localhost dev page (vite) or the tauri.localhost page a release build serves. The port is
// whatever the harness passed: PROVE_PORT / VITE_PORT when set (o2-tests slots run on 1500-1590, prove on 1470), else
// any localhost port, so a hardcoded 14xx can never make "main" miss the page.
const MAIN_PORT = process.env.CDP_MAIN_PORT || process.env.PROVE_PORT || process.env.VITE_PORT || "";
const isMain = (url) =>
  (MAIN_PORT ? new RegExp(`localhost:${MAIN_PORT}(?:[/?#]|$)|tauri\\.localhost`).test(url) : /localhost:\d+|tauri\.localhost/.test(url));
const pick = (m) => targets.find((t) => t.type === "page" && (m === "main" ? isMain(t.url) : (t.url + " " + t.title).includes(m)));
const target = pick(match);
if (!target) { console.error("no target matching", match); for (const t of targets) console.error(" ", t.type, t.title, t.url); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = { Enter: { code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" }, Escape: { code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 }, Tab: { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 }, Backspace: { code: "Backspace", key: "Backspace", windowsVirtualKeyCode: 8 }, Delete: { code: "Delete", key: "Delete", windowsVirtualKeyCode: 46 }, ArrowUp: { code: "ArrowUp", key: "ArrowUp", windowsVirtualKeyCode: 38 }, ArrowDown: { code: "ArrowDown", key: "ArrowDown", windowsVirtualKeyCode: 40 }, ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", windowsVirtualKeyCode: 37 }, ArrowRight: { code: "ArrowRight", key: "ArrowRight", windowsVirtualKeyCode: 39 }, BracketLeft: { code: "BracketLeft", key: "[", windowsVirtualKeyCode: 219 }, BracketRight: { code: "BracketRight", key: "]", windowsVirtualKeyCode: 221 } };
const key = async (name, mods = 0) => {
  const k = KEYS[name] || { code: (/^[0-9]$/.test(name) ? "Digit" : "Key") + name.toUpperCase(), key: name, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) };
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: mods, ...k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: mods, ...k });
};

if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: rest[0], returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r));
} else if (cmd === "focus") {
  const r = await send("Runtime.evaluate", { expression: `(()=>{const e=document.querySelector(${JSON.stringify(rest[0])}); if(!e) return "missing"; e.focus(); if(e.select) e.select(); return document.activeElement===e?"focused":"not-focused";})()`, returnByValue: true });
  console.log(r.result?.result?.value);
} else if (cmd === "type") {
  for (const ch of rest[0]) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(25);
  }
  if (rest[1] === "enter") await key("Enter");
  console.log("typed", rest[0].length, "chars", rest[1] === "enter" ? "+ Enter" : "");
} else if (cmd === "insert") {
  // Pastes text as one edit (emoji included); the field must already have the cursor.
  await send("Input.insertText", { text: rest[0] });
  if (rest[1] === "enter") await key("Enter");
  console.log("inserted", rest[0]);
} else if (cmd === "key") {
  // mods: Alt=1, Ctrl=2, Meta=4, Shift=8
  await key(rest[0], Number(rest[1] || 0));
  console.log("key", rest[0], rest[1] || "");
} else if (cmd === "hover") {
  const r = await send("Runtime.evaluate", { expression: `(()=>{const e=document.querySelector(${JSON.stringify(rest[0])}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];})()`, returnByValue: true });
  const at = r.result?.result?.value;
  if (!at) { console.error("missing", rest[0]); process.exit(1); }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
  console.log("hover", at.join(","));
} else if (cmd === "wheel") {
  const r = await send("Runtime.evaluate", { expression: `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(rest[0])})].find(x=>x.offsetParent!==null); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];})()`, returnByValue: true });
  const at = r.result?.result?.value;
  if (!at) { console.error("missing", rest[0]); process.exit(2); }
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at[0], y: at[1], deltaX: 0, deltaY: Number(rest[1] || 0) });
  console.log("wheel", rest[1], "at", at.map(Math.round).join(","));
} else if (cmd === "rightclick") {
  // A right press, not element.click(): the app's row menus listen on contextmenu, which a real press fires.
  const r = await send("Runtime.evaluate", { expression: `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(rest[0])})].find(x=>x.offsetParent!==null); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];})()`, returnByValue: true });
  const at = r.result?.result?.value;
  if (!at) { console.error("missing", rest[0]); process.exit(2); }
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "right", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "right", clickCount: 1 });
  console.log("rightclick", at.join(","));
} else {
  console.error("unknown cmd", cmd); process.exit(2);
}
ws.close();
