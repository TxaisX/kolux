// T-661 (DT-C97, audit backlog row 57) on the real BrowserPane. The right-click menu is drawn by the page,
// so a pick is the page's word plus a click it may have steered: leaving Kolux (open in the default browser)
// or dropping a certificate's trust must wait for Kolux's own ask, which names the host. Trust itself is
// never taken from a pick.
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find } from "../tasks/fakeDom";
import { engineLoad, installPaneDom, mountPane, rec, sent } from "./__cards__/paneHarness";
import { LEAVE_ARM_MS } from "./leave";

// The harness answers every command with nothing; here Kolux's own certificate state can say "trusted".
const certs = vi.hoisted(() => ({ trusted: true }));
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./__cards__/paneHarness");
  return {
    invoke: (cmd: string, args: Record<string, unknown> = {}) =>
      cmd === "browser_cert" && args.action === "state"
        ? (h.rec.calls.push({ cmd, args }), Promise.resolve({ trusted: certs.trusted, site: "localhost:8443" }))
        : h.coreMock.invoke(cmd, args),
  };
});
vi.mock("@tauri-apps/api/event", async () => (await import("./__cards__/paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./__cards__/paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./__cards__/paneHarness")).dialogMock);
// The keyboard is inside the page: the app's window holds it, its own view does not, so a pick runs.
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true) }) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  certs.trusted = true;
  doc = installPaneDom();
  (doc as unknown as { hasFocus: () => boolean }).hasFocus = () => false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function pause(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function pane() {
  const m = await mountPane(doc);
  unmount = m.unmount;
  return m.container as FakeNode;
}
async function raise(name: string, payload: Record<string, unknown>) {
  await act(async () => {
    rec.handlers.get(name)?.({ payload: { id: 7, ...payload } });
  });
  await pause(20);
}
const pick = (what: string, u: string) => raise("browser-menu", { kind: "pick", what, u });
const ask = (c: FakeNode) => find(c, (n) => n.attrs["data-leave"] !== undefined)[0];
const go = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.attrs["data-leave-go"] !== undefined)[0];
const cancel = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.attrs["data-leave-cancel"] !== undefined)[0];
const certActs = (action: string) => sent("browser_cert").filter((x) => x.args.action === action);

test("t661 a gesture-only open-default pick asks first, naming the host, and opens only on Open", async () => {
  const c = await pane();
  await pick("open-default", "https://kolux.app@other.example/x");
  expect(sent("open_external")).toEqual([]);
  expect(ask(c)?.attrs["data-leave"]).toBe("system");
  expect(ask(c)?.attrs.role).toBe("alertdialog");
  expect(ask(c)?.textContent).toContain("other.example");
  // a click already on its way when the ask appears lands on a button that is still off
  await click(c, go(c));
  expect(sent("open_external")).toEqual([]);
  await pause(LEAVE_ARM_MS + 50);
  await click(c, go(c));
  // the user name before the @ is dropped from what is shown and handed over
  expect(sent("open_external").map((x) => x.args.url)).toEqual(["https://other.example/x"]);
  expect(ask(c)).toBeUndefined();
});

test("t661 the Open button names the host, a replacing ask starts the wait again, and a new page drops the ask", async () => {
  const c = await pane();
  await pick("open-default", "https://first.example/");
  expect(go(c)?.textContent).toContain("first.example");
  await pause(LEAVE_ARM_MS - 150);
  // the page swaps the ask just before the first one would turn on: the new one waits its own time
  await pick("open-default", "https://second.example/");
  expect(go(c)?.textContent).toContain("second.example");
  await pause(200);
  await click(c, go(c));
  expect(sent("open_external")).toEqual([]);
  await pause(LEAVE_ARM_MS);
  // the page moves on before Open: the ask goes with it
  await engineLoad("started", "https://second.example/next");
  await pause(20);
  expect(ask(c)).toBeUndefined();
  expect(sent("open_external")).toEqual([]);
});

test("t661 Cancel opens nothing, and a sized window before the first load gets the same ask", async () => {
  const c = await pane();
  await pick("open-default", "https://other.example/");
  await pause(LEAVE_ARM_MS + 50);
  await click(c, cancel(c));
  expect(ask(c)).toBeUndefined();
  await raise("browser-leave", { url: "https://popup.example/sign-in", front: true });
  expect(sent("open_external")).toEqual([]);
  expect(ask(c)?.textContent).toContain("popup.example");
  await click(c, cancel(c));
  expect(sent("open_external")).toEqual([]);
  // nothing but a web address is offered
  await pick("open-default", "javascript:alert(1)");
  await raise("browser-leave", { url: "file:///C:/x", front: true });
  expect(ask(c)).toBeUndefined();
});

test("t661 stop-trusting waits for the ask, is asked only for a trusted site, and no pick ever trusts a certificate", async () => {
  const c = await pane();
  await engineLoad("started", "https://localhost:8443/");
  await pause(20);
  // only the site on show: a page cannot ask about another trusted site
  await pick("cert-revoke", "https://localhost:9443/");
  expect(ask(c)).toBeUndefined();
  certs.trusted = false;
  await pick("cert-revoke", "https://localhost:8443/");
  expect(ask(c)).toBeUndefined();
  certs.trusted = true;
  await pick("cert-revoke", "https://localhost:8443/");
  expect(certActs("revoke")).toEqual([]);
  expect(ask(c)?.attrs["data-leave"]).toBe("revoke");
  expect(ask(c)?.textContent).toContain("localhost:8443");
  await pause(LEAVE_ARM_MS + 50);
  await click(c, go(c));
  expect(certActs("revoke").map((x) => x.args.url)).toEqual(["https://localhost:8443/"]);
  // regression guard: the pane has no pick that trusts, so these must stay inert if one is ever added
  for (const what of ["trust", "cert-trust", "cert-revoke-and-trust"]) await pick(what, "https://localhost:8443/");
  expect(certActs("trust")).toEqual([]);
  expect(sent("open_external")).toEqual([]);
});
