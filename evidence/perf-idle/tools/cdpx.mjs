// Minimal CDP client for the lane's dev page on port 9447: import { open } and use send/on.
export async function open(port = 9447, match = /localhost:14\d\d|tauri\.localhost/) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = targets.find((x) => x.type === "page" && match.test(x.url));
  if (!t) throw new Error("no page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map(); const handlers = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else if (m.method) (handlers.get(m.method) || []).forEach((h) => h(m.params)); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, h) => handlers.set(method, [...(handlers.get(method) || []), h]);
  const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r; };
  return { send, on, evalJs, close: () => ws.close() };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
