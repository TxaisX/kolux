// AUD-S2 / S2-F01: live-SAFE-024 focuses the shared task box by its aria-label before Start.
// The chooser labels that box "Task for all of them" (src/launch/ChooserPane.tsx), not
// "Task for every seat"; focusField throws, so the six-seat launch is never started.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("audit S2 > live-SAFE-024 label drift", () => {
  it("[S2-F01] the task box it focuses is one the chooser renders", () => {
    const script = read("scripts/prove/live-SAFE-024.mjs");
    const labels = script
      .split("focusField(")
      .slice(1)
      .map((rest) => /aria-label="([^"$]+)"/.exec(rest.slice(0, 160)))
      .filter(Boolean)
      .map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    const chooser = read("src/launch/ChooserPane.tsx");
    const missing = labels.filter((label) => !chooser.includes(`aria-label="${label}"`));
    expect(missing, `live-SAFE-024 focuses ${missing.join(", ")}; the chooser renders only the labels in src/launch/ChooserPane.tsx`).toEqual([]);
  });
});
