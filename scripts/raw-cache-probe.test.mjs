// The stale-transform detector for Vite's `?raw` cache (bug 20261112-1118, `_shared/bugs/o2-tests/`).
//
// A contract test that reads source through `import src from "./X.tsx?raw"` gets Vite's *cached* transform. If the
// cache is warm from an earlier run, a second run can see the file as it was, not as it is on disk, and then fails
// on correct code (lane o3-rune hit this in src/usage/usageStatusUx.test.ts). This test makes that failure mode
// visible in one line: the `?raw` import and a fresh read of the same file must agree.
//
// To reproduce the cache bug by hand, from the repo root:
//   1. node node_modules/vitest/vitest.mjs run scripts/raw-cache-probe.test.mjs     # warms the cache
//   2. edit scripts/raw-cache-probe.fixture.txt (change the version number)
//   3. node node_modules/vitest/vitest.mjs run scripts/raw-cache-probe.test.mjs     # stale cache: fails
//   4. node node_modules/vitest/vitest.mjs run --no-fsModuleCache scripts/raw-cache-probe.test.mjs   # passes
// Step 4 is the workaround every lane can use today: `--no-fsModuleCache` stops Vitest reusing the transform, so no
// cache clear is needed. The permanent fix stays "read source with node:fs, not ?raw" (see tests/raw-contract-imports.md).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import cached from "./raw-cache-probe.fixture.txt?raw";

const FIXTURE = new URL("./raw-cache-probe.fixture.txt", import.meta.url);
const onDisk = () => readFileSync(FIXTURE, "utf8");

describe("Vite ?raw transform cache", () => {
  test("the ?raw import matches the file on disk", () => {
    expect(cached).toBe(onDisk());
  });

  test("the fixture is a plain text file (the detector's own assumption)", () => {
    // A Windows autocrlf checkout writes this fixture with CRLF; both ends are the same plain text.
    expect(onDisk()).toMatch(/^raw-cache-probe-v\d+\r?\n$/);
  });
});
