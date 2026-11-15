// Wave 2 item 5 (D-05, D-06): an empty screen has one main button, which opens the Start form; a second action
// is a quiet link. "No agents yet." used to have no button at all on a first run (saved = installed agents).
import { expect, test } from "vitest";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(n: string): { readFileSync(p: string, e: string): string } } }).process.getBuiltinModule("node:fs");
const src = (f: string) => nodeFs.readFileSync(`src/shell/${f}`, "utf8").replace(/\r\n/g, "\n");
const block = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

test("D-05: the empty grid has one main button (Start agents) and the terminal is a quiet link", () => {
  const empty = block(src("./window/Grid.tsx"), "No terminal open here.", "</div>\n        </div>");
  expect(empty.match(/btn primary/g) ?? []).toHaveLength(1);
  expect(empty).toMatch(/btn primary" onClick=\{addChooser\}>\s*Start agents/);
  expect(empty).toContain('className="btn link"');
});

test("D-06: the Agents screen always offers a way to start, also with no agent installed", () => {
  const empty = block(src("./window/Content.tsx"), "<h2>Agents</h2>", "{board &&");
  expect(empty).toContain("No agents yet. Start one to begin.");
  expect(empty).not.toContain("saved.length > 0 &&");
  expect(empty).toMatch(/btn primary" onClick=\{addChooser\}/);
});
