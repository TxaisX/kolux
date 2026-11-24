// AUD-S4 F02: s6-torture-payloads.mjs is run inside a pane as `node s6-torture-payloads.mjs <payload> <result.json>`.
// Its argument check prints the usage line and exits 2, but it runs after `name.split(":")`, so a call with no
// arguments crashes with a TypeError and exit 1 before a user can be told how to call it.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./s6-torture-payloads.mjs", import.meta.url));

it("[S4-F02] with no arguments prints the usage line and exits 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { windowsHide: true, encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(2);
  expect(String(r.stderr)).toMatch(/usage: node s6-torture-payloads\.mjs/);
});
