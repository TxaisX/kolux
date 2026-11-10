// DT-C229: parking leans on two private xterm 6.0.0 steps (renderer.ts resumeHook and renderNowHook).
// This test runs the real shipped code of both, so an xterm upgrade that renames or changes them
// fails here instead of leaving a blank pane on reveal. There is no DOM in the test run, so the
// steps are lifted out of the shipped module and run against a stand-in service.
// @vitest-environment node
import { expect, test } from "vitest";
import { Terminal } from "@xterm/xterm";
import { quietSelection, renderNowHook, resumeHook } from "./renderer";

type Fs = { readFileSync(p: string, enc: string): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(n: string): Fs } }).process.getBuiltinModule("node:fs");
const read = (rel: string) => fs.readFileSync(`node_modules/@xterm/xterm/${rel}`, "utf8");
const shipped = read("lib/xterm.mjs");

/** The real method `name` from the shipped module, the first whose body contains `marker`. */
function method(name: string, marker: string): (...args: unknown[]) => unknown {
  const head = new RegExp(`[;},]${name}\\(([^)]*)\\)\\{`, "g");
  for (let m = head.exec(shipped); m; m = head.exec(shipped)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < shipped.length; end++) {
      if (shipped[end] === "{") depth++;
      else if (shipped[end] === "}" && --depth === 0) break;
    }
    const body = shipped.slice(open + 1, end);
    if (body.includes(marker)) return new Function(...m[1].split(",").filter(Boolean), body) as (...args: unknown[]) => unknown;
  }
  throw new Error(`xterm no longer ships ${name} with ${marker}`);
}

test("xterm is pinned at 6.0.0, the version these private steps were checked against", () => {
  expect(JSON.parse(read("package.json")).version).toBe("6.0.0");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  expect(pkg.dependencies["@xterm/xterm"]).toBe("6.0.0");
  expect(shipped).toContain("this._renderService=this._register(this._instantiationService.createInstance(");
  expect(shipped).toContain("this._renderDebouncer=new ");
});

test("the real resume handler clears the pause, measures an unmeasured cell size and asks for a full repaint", () => {
  const term = new Terminal({ rows: 24, cols: 80 });
  const core = (term as unknown as { _core: Record<string, unknown> })._core;
  expect(core).toBeTruthy();
  expect(resumeHook(term)).toBeNull(); // not opened yet: no render service, so the pane would never park
  let measured = 0;
  const asked: number[][] = [];
  const service = {
    _isPaused: true,
    _needsFullRefresh: true,
    _rowCount: 24,
    _charSizeService: { hasValidSize: false, measure: () => void measured++ },
    _pausedResizeTask: { flush() {} },
    refreshRows: (start: number, end: number) => void asked.push([start, end]),
    _handleIntersectionChange: method("_handleIntersectionChange", "_isPaused"),
  };
  core._renderService = service;
  const resume = resumeHook(term);
  expect(resume).not.toBeNull();
  resume?.();
  expect([service._isPaused, service._needsFullRefresh, measured, asked]).toEqual([false, false, 1, [[0, 23]]]);
  term.dispose();
});

test("the real debouncer step draws the rows a refresh asked for now, once its frame request is cancelled", () => {
  const term = new Terminal({ rows: 24, cols: 80 });
  const core = (term as unknown as { _core: Record<string, unknown> })._core;
  const rendered: number[][] = [];
  const cancelled: number[] = [];
  const debouncer: Record<string, unknown> = {
    _refreshCallbacks: [],
    _renderCallback: (start: number, end: number) => void rendered.push([start, end]),
    _coreBrowserService: { window: { requestAnimationFrame: () => 9 } },
    refresh: method("refresh", "requestAnimationFrame"),
    _innerRefresh: method("_innerRefresh", "_animationFrame=void 0"),
    _runRefreshCallbacks: method("_runRefreshCallbacks", "_refreshCallbacks"),
  };
  core._renderService = { _renderDebouncer: debouncer };
  (debouncer.refresh as (s: number, e: number, n: number) => void).call(debouncer, 0, 23, 24);
  expect([debouncer._animationFrame, rendered]).toEqual([9, []]); // term.refresh alone only books a frame
  const now = renderNowHook(term, (id) => void cancelled.push(id));
  expect(now).not.toBeNull();
  now?.();
  expect([cancelled, rendered, debouncer._animationFrame]).toEqual([[9], [[0, 23]], undefined]);
  term.dispose();
});

test("DT-C245 the real selection service: a scroll asks it to redraw, and the quiet wrapper lets that through only with a selection", () => {
  // The scroll handler that calls refresh on every scrolled line, and the getter the wrapper reads.
  expect(shipped).toContain("this._selectionService.refresh(),this._viewport?.queueSync()");
  expect(shipped).toContain("get hasSelection(){let e=this._model.finalSelectionStart,i=this._model.finalSelectionEnd;");
  const term = new Terminal({ rows: 24, cols: 80 });
  const core = (term as unknown as { _core: Record<string, unknown> })._core;
  expect(quietSelection(term)).toBeNull(); // not opened yet: no selection service, nothing is changed
  const frames: Array<() => void> = [];
  const service: Record<string, unknown> = {
    _model: { finalSelectionStart: undefined as [number, number] | undefined, finalSelectionEnd: undefined as [number, number] | undefined },
    _coreBrowserService: { window: { requestAnimationFrame: (f: () => void) => frames.push(f) } },
    // xterm's own refresh books one frame until the frame runs (its body reads a module flag, so a stand-in).
    refresh(this: Record<string, unknown>) {
      if (!this._refreshAnimationFrame) this._refreshAnimationFrame = (this._coreBrowserService as { window: { requestAnimationFrame(f: () => void): number } }).window.requestAnimationFrame(() => {});
    },
  };
  expect(shipped).toContain("refresh(e){this._refreshAnimationFrame||(this._refreshAnimationFrame=this._coreBrowserService.window.requestAnimationFrame(");
  Object.defineProperty(service, "hasSelection", {
    get() {
      const m = this._model;
      return !!m.finalSelectionStart && !!m.finalSelectionEnd && (m.finalSelectionStart[0] !== m.finalSelectionEnd[0] || m.finalSelectionStart[1] !== m.finalSelectionEnd[1]);
    },
  });
  core._selectionService = service;
  expect(quietSelection(term)).not.toBeNull();
  const refresh = service.refresh as () => void;
  refresh.call(service);
  expect(frames.length).toBe(0); // nothing selected: no frame booked
  const model = service._model as { finalSelectionStart?: [number, number]; finalSelectionEnd?: [number, number] };
  model.finalSelectionStart = [0, 0];
  model.finalSelectionEnd = [5, 0];
  refresh.call(service);
  expect(frames.length).toBe(1);
  service._refreshAnimationFrame = undefined;
  model.finalSelectionStart = model.finalSelectionEnd = undefined;
  refresh.call(service); // the highlight is wiped once
  expect(frames.length).toBe(2);
  service._refreshAnimationFrame = undefined;
  refresh.call(service);
  expect(frames.length).toBe(2);
  term.dispose();
});
