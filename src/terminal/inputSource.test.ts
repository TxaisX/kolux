// TERM-123 (DT-C247): the pane tells the user's typing apart from the terminal's own replies at the source.
// Runs against the real xterm 6.0.0 core (no DOM: the terminal is never opened), so an xterm upgrade that
// drops or renames coreService.onUserInput fails here instead of silently counting every reply as typing.
// @vitest-environment node
import { expect, test } from "vitest";
import { Terminal } from "@xterm/xterm";
// @ts-expect-error vitest runs on Node; the app's browser tsconfig has no Node types.
import { readFileSync } from "node:fs";
import { AUTO, autoSender, trackInputSource } from "./inputSource";
import { hookColourMode, modeReport } from "./colourMode";
import { DA1_WINDOWS, XTVERSION_REPLY, hookQueries } from "./queries";

/** A terminal with the tracker on it and every onData payload recorded with its verdict. */
function tracked() {
  const term = new Terminal({ allowProposedApi: true });
  const src = trackInputSource(term);
  const seen: [string, boolean][] = [];
  term.onData((d) => seen.push([d, src.take()]));
  return { term, src, seen };
}

test("the real xterm core raises its user-input event, so the tracker is exact", () => {
  const { src } = tracked();
  expect(src.exact).toBe(true);
});

test("typed data (what a key, a paste or a mouse report go through) reads as typed; a reply does not", () => {
  const { term, seen } = tracked();
  term.input("x"); // Terminal.input defaults to user input, the path a key takes
  term.input("\x1b[200~pasted\x1b[201~", true);
  term.input("\x1b[O", false); // what the focus-out report goes through
  term.input("\x1b[12;1R", false); // what a cursor-position answer goes through
  term.input("y", true);
  expect(seen).toEqual([
    ["x", true],
    ["\x1b[200~pasted\x1b[201~", true],
    ["\x1b[O", false],
    ["\x1b[12;1R", false],
    ["y", true],
  ]);
});

test("the terminal's own answers to the program read as replies: cursor position, device attributes and mode queries (the colour answer needs an opened terminal and takes the same path)", async () => {
  const { term, seen } = tracked();
  // The program asks; the core answers through onData without the user-input flag. The parse step runs
  // on xterm's write buffer, so the answers land once the write's callback has run.
  await new Promise<void>((done) => term.write("\x1b[6n\x1b[c\x1b[>c\x1b[?1004$p", done));
  expect(seen).toEqual([
    ["\x1b[1;1R", false],
    ["\x1b[?1;2c", false],
    ["\x1b[>0;276;0c", false],
    ["\x1b[?1004;2$y", false],
  ]);
});

test("a key between two replies is the only one that reads as typed, and the mark is cleared by each take", () => {
  const { term, seen, src } = tracked();
  term.input("\x1b[I", false);
  term.input("k", true);
  term.input("\x1b[O", false);
  expect(seen).toEqual([
    ["\x1b[I", false],
    ["k", true],
    ["\x1b[O", false],
  ]);
  expect(src.take()).toBe(false); // nothing pending
  src.dispose();
  term.input("z", true);
  expect(seen[3]).toEqual(["z", false]); // after dispose nothing is marked (the pane is gone by then)
});

test("without the core event every payload reads as typed (the old behaviour: an agent stays awake rather than sleeping when typed into)", () => {
  const src = trackInputSource({} as unknown as Terminal);
  expect(src.exact).toBe(false);
  expect(src.take()).toBe(true);
  expect(src.take()).toBe(true);
  src.dispose();
});

test("the pane's own answers carry the auto flag the write command reads", () => {
  expect(AUTO).toEqual({ auto: true });
});

test("the pane's own answers (DA1, XTVERSION, the dark-or-light answer and the unprompted mode report) go out as automatic", async () => {
  const term = new Terminal({ allowProposedApi: true });
  const sent: [string, boolean][] = [];
  // the pane's write, as the pane calls it: (data, only, { auto })
  const write = (data: string, _only: undefined, opts: { auto?: boolean } = {}) => void sent.push([data, opts.auto === true]);
  const send = autoSender(write);
  let dark = true;
  const mode = hookColourMode(term, send, () => dark);
  const queries = hookQueries(term, send, { windows: true, holdVersion: () => false });
  await new Promise<void>((done) => term.write("\x1b[c\x1b[>q\x1b[?996n\x1b[?2031h", () => done()));
  dark = false;
  mode.changed();
  expect(sent).toEqual([
    [DA1_WINDOWS, true],
    [XTVERSION_REPLY, true],
    [modeReport(true), true],
    [modeReport(false), true],
  ]);
  mode.dispose();
  queries.dispose();
});

test("the pane wires its own answers through the automatic sender, not the bare write", () => {
  const src = readFileSync(new URL("./TerminalPane.tsx", import.meta.url), "utf8");
  expect(src).toMatch(/hookColourMode\(term, sendAuto,/);
  expect(src).toMatch(/hookQueries\(term, sendAuto,/);
  expect(src).not.toMatch(/hook(ColourMode|Queries)\(term, write,/);
  expect(src).toMatch(/held\.push\(data, auto\)/);
  expect(src).toMatch(/held\.drain\(\(d, a\) => write\(d, undefined, \{ auto: a \}\)\)/);
});
