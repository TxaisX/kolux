// The window-close listener (APP-006 / APP-050): exactly one `onCloseRequested(` exists app-wide, and its first
// act is to flush the screen writer BEFORE any `await`, so a change made right before quitting is on disk.
// A second listener, or a flush moved after an await, would silently lose that last change; this guards both.
import { expect, test } from "vitest";

type Fs = {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, enc: string): string;
};
// The project carries no Node types, so the node:fs module is fetched the way topBarLayout.test.ts does.
const fs = (globalThis as unknown as { process: { getBuiltinModule(name: string): Fs } }).process.getBuiltinModule("node:fs");
const srcDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Every non-test .ts/.tsx file under src, as [relative path, text]. */
function sources(dir = srcDir, rel = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...sources(`${dir}/${e.name}`, `${rel}${e.name}/`));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push([`${rel}${e.name}`, fs.readFileSync(`${dir}/${e.name}`, "utf8")]);
  }
  return out;
}

test("exactly one onCloseRequested( listener exists in the app, in useWindowSave.ts", () => {
  const hits = sources().flatMap(([file, text]) => (text.match(/onCloseRequested\(/g) ?? []).map(() => file));
  expect(hits).toEqual(["shell/useWindowSave.ts"]);
});

test("the close listener flushes the screen writer before its first await", () => {
  const text = sources().find(([f]) => f === "shell/useWindowSave.ts")![1];
  const start = text.indexOf("onCloseRequested(");
  expect(start).toBeGreaterThan(-1);
  const body = text.slice(start);
  const flush = body.indexOf("screenWriter.flush()");
  // The body is code only up to the listener's end; comments before the first await are skipped by looking at `await ` calls.
  const firstAwait = body.search(/\bawait\b/);
  expect(flush).toBeGreaterThan(-1);
  expect(firstAwait).toBeGreaterThan(-1);
  expect(flush).toBeLessThan(firstAwait);
});
