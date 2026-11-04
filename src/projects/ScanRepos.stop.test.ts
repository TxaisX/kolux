// T-737 (DT-C173): Stop says stopped only once the back end has stopped the scan; a stop that fails says why
// and the scan keeps its Stop button.
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import { find, fire, installDom, mount, settle } from "../tasks/fakeDom";

// The first stop (the button) fails; the one the dialog sends as it closes succeeds.
let stops = 0;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "repo_scan_stop" && stops++ === 0 ? Promise.reject("the scan could not be stopped") : Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

test("T-737: a Stop that fails is reported and the scan still shows Stop", async () => {
  const { doc, win } = installDom();
  Object.assign(doc, { querySelector: () => null, querySelectorAll: () => [] });
  Object.assign(win, { setTimeout, clearTimeout });
  const problems: unknown[] = [];
  const { default: ScanRepos } = await import("./ScanRepos");
  const m = await mount(createElement(ScanRepos, { root: "C:/code", onClose: () => {}, onDone: () => {}, onProblem: (e: unknown) => problems.push(e) }), doc);
  const button = (attr: string) => find(m.container, (n) => attr in n.attrs)[0];
  await fire(m.container, "click", button("data-scan-start"));
  await settle();
  await fire(m.container, "click", button("data-scan-stop"));
  await settle();
  expect(problems, "the failed stop is reported").toEqual(["the scan could not be stopped"]);
  expect(button("data-scan-stop"), "the scan is not shown as stopped").toBeTruthy();
  await m.unmount();
});
