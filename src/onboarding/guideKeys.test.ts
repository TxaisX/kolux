// C16-R2-01: the Setup Guide's CLI step mounts an inline terminal, and xterm's helper textarea cancels Tab and
// Escape in its own capture-phase keydown listener (writing HT / ESC[Z / ESC into the shell). The guide's bubble
// onKeyDown therefore never ran for those two keys: the modal had no forward keyboard exit and its "(Esc)" close
// was dead. `terminalKeys` answers them on the capture phase, before the event reaches the textarea, and stops it
// there. There is no DOM renderer in this repo, so the handler is driven with a stand-in event.
import { afterEach, expect, test, vi } from "vitest";
import { terminalKeys } from "./Guides";
import guidesSrc from "./Guides.tsx?raw";

type Focusable = { focus: ReturnType<typeof vi.fn> };

function fakeEvent(key: string, opts: { shift?: boolean; inTerminal?: boolean; prevented?: boolean } = {}) {
  const items: Focusable[] = [{ focus: vi.fn() }, { focus: vi.fn() }, { focus: vi.fn() }];
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const e = {
    key,
    shiftKey: !!opts.shift,
    defaultPrevented: !!opts.prevented,
    target: { closest: (sel: string) => (opts.inTerminal === false ? null : sel === ".xterm" ? {} : null) },
    currentTarget: { querySelectorAll: () => items },
    preventDefault,
    stopPropagation,
  };
  return { e, items, preventDefault, stopPropagation };
}

afterEach(() => vi.unstubAllGlobals());

test("C16-R2-01: Escape in the inline terminal closes the guide and never reaches the shell", () => {
  const { e, preventDefault, stopPropagation } = fakeEvent("Escape");
  const onClose = vi.fn();
  expect(terminalKeys(e as never, onClose)).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  // stopped before xterm's capture listener, so no ESC is written to the shell
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
});

test("C16-R2-01: Tab in the inline terminal moves the focus to the next control and types nothing", () => {
  const { e, items, preventDefault, stopPropagation } = fakeEvent("Tab");
  vi.stubGlobal("document", { activeElement: items[1] });
  const onClose = vi.fn();
  expect(terminalKeys(e as never, onClose)).toBe(true);
  expect(items[2].focus).toHaveBeenCalledTimes(1);
  expect(items[1].focus).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
});

test("C16-R2-01: Shift+Tab in the inline terminal goes back and types no ESC[Z", () => {
  const { e, items, preventDefault, stopPropagation } = fakeEvent("Tab", { shift: true });
  vi.stubGlobal("document", { activeElement: items[1] });
  expect(terminalKeys(e as never, vi.fn())).toBe(true);
  expect(items[0].focus).toHaveBeenCalledTimes(1);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
});

test("C16-R2-01: Tab and Escape outside the terminal are left to the guide's own trap", () => {
  for (const key of ["Tab", "Escape"]) {
    const { e, preventDefault, stopPropagation } = fakeEvent(key, { inTerminal: false });
    const onClose = vi.fn();
    expect(terminalKeys(e as never, onClose)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
  }
});

test("C16-R2-01: the guide answers those keys on the capture phase, before the terminal can", () => {
  // The bubble onKeyDown is what xterm's capture listener made unreachable; the capture one runs first.
  expect(guidesSrc).toContain('onKeyDownCapture={(e) => terminalKeys(e, onClose)}');
  expect(guidesSrc).toContain('onKeyDown={(e) => (trapTab(e), e.key === "Escape" && onClose())}');
});

test("C16-R2-01: a key another handler already took, and every other key, is left alone", () => {
  const taken = fakeEvent("Escape", { prevented: true });
  expect(terminalKeys(taken.e as never, vi.fn())).toBe(false);
  expect(taken.stopPropagation).not.toHaveBeenCalled();
  const other = fakeEvent("Enter");
  expect(terminalKeys(other.e as never, vi.fn())).toBe(false);
  expect(other.stopPropagation).not.toHaveBeenCalled();
});
