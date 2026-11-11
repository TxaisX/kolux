// TERM-020 acceptance: a plain shell pane reads as a terminal with a neutral status; the status dot carries an accessible label.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import VendorMark from "../../chrome/VendorMark";
import { VOCAB, headerOf, type Kind, type StatusKey } from "../status";

test("box 1: a plain shell shows the generic terminal glyph and a neutral Ready status", () => {
  const shell = headerOf("shell", "running", undefined, false, null, 0);
  expect(shell).toMatchObject({ word: "Ready", tone: "", glyph: "idle", state: "idle", needsYou: false });
  // a hook reading never speaks for a plain shell
  expect(headerOf("shell", "running", undefined, true, null, 0, "permission")).toMatchObject({ word: "Ready", tone: "", needsYou: false });
  expect(headerOf("shell", "ended", 0, false, 0, 0)).toMatchObject({ tone: "", needsYou: false });
  // the mark: the shell's neutral prompt glyph, not an agent's brand mark
  const shellMark = renderToStaticMarkup(createElement(VendorMark, { agent: "shell" }));
  const claudeMark = renderToStaticMarkup(createElement(VendorMark, { agent: "claude" }));
  expect(shellMark).toContain("<svg");
  expect(shellMark).not.toBe(claudeMark);
  // MIRROR TerminalPane.tsx:1462: agentLabel = name ?? (shown === "shell" ? "Plain shell" : programWord(shown))
});

test("box 2: the status dot's label names its state: 'status: <word>', one word per state", () => {
  // MIRROR TerminalPane.tsx:1510: aria-label={`status: ${word}`} on the dot, role="img"
  const label = (h: ReturnType<typeof headerOf>) => `status: ${h.word}`;
  const cases: ReturnType<typeof headerOf>[] = [
    headerOf("shell", "running", undefined, false, null, 0),
    headerOf("claude", "running", undefined, false, null, 0, "working"),
    headerOf("claude", "running", undefined, false, null, 0, "permission"),
    headerOf("claude", "ended", 0, false, 0, 0),
    headerOf("claude", "failed", undefined, false, null, 0),
    headerOf("claude", "running", undefined, false, null, 0, "blocked"),
    headerOf("claude", "ended", 2, false, 0, 0),
    headerOf("claude", "starting" as Kind, undefined, false, null, 0),
  ];
  const labels = cases.map(label);
  expect(labels).toEqual(["status: Ready", "status: Working", "status: Needs you", "status: Stopped", "status: Failed", "status: Blocked", "status: Ended (2)", "status: Starting"]);
  expect(new Set(labels).size).toBe(labels.length); // no two of these states share a label
  // every state the vocabulary knows has a word, so the label is never "status: "
  for (const k of Object.keys(VOCAB) as StatusKey[]) expect(VOCAB[k].word.length).toBeGreaterThan(0);
});
