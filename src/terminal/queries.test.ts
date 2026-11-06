// ORCH-057: capability queries answered on the app's behalf; dark-or-light from the palette brightness.
import { describe, expect, it } from "vitest";
import { hookColourMode, modeReport } from "./colourMode";
import { DA1_WINDOWS, hookQueries, isGrok, paletteIsDark, XTVERSION_REPLY } from "./queries";

type Params = (number | number[])[];
type Handler = { id: { prefix?: string; final: string }; cb: (p: Params) => boolean; gone: boolean };

/** A stand-in for xterm's parser: a CSI goes to the newest live handler first, then older ones, then xterm's
 *  own default (here: DA1 and DA2 answers as xterm.js gives them) when every handler returned false. */
function fakeTerm() {
  const handlers: Handler[] = [];
  const sent: string[] = [];
  const parser = {
    registerCsiHandler(id: Handler["id"], cb: Handler["cb"]) {
      const h = { id, cb, gone: false };
      handlers.push(h);
      return { dispose: () => void (h.gone = true) };
    },
  };
  const csi = (prefix: string | undefined, final: string, p: Params = []) => {
    for (const h of [...handlers].reverse()) if (!h.gone && h.id.final === final && h.id.prefix === prefix && h.cb(p)) return;
    if (final === "c" && prefix === undefined) sent.push("\x1b[?1;2c");
    if (final === "c" && prefix === ">") sent.push("\x1b[>0;276;0c");
  };
  return { term: { parser }, sent, send: (d: string) => void sent.push(d), csi };
}

describe("ORCH-057 capability queries", () => {
  it("DA1 gets the Windows console's answer on Windows and xterm's elsewhere", () => {
    const win = fakeTerm();
    hookQueries(win.term, win.send, { windows: true, holdVersion: () => false });
    win.csi(undefined, "c");
    win.csi(undefined, "c", [0]);
    expect(win.sent).toEqual([DA1_WINDOWS, DA1_WINDOWS]);
    expect(DA1_WINDOWS).toBe("\x1b[?1;0c");
    const mac = fakeTerm();
    hookQueries(mac.term, mac.send, { windows: false, holdVersion: () => false });
    mac.csi(undefined, "c");
    expect(mac.sent).toEqual(["\x1b[?1;2c"]);
  });

  it("the version query is answered as Kolux; a hidden Grok pane holds back only the version answers", () => {
    let hidden = false;
    const t = fakeTerm();
    const q = hookQueries(t.term, t.send, { windows: true, holdVersion: () => hidden && isGrok("C:\\tools\\grok.exe --model x") });
    t.csi(">", "q");
    t.csi(">", "c");
    expect(t.sent).toEqual([XTVERSION_REPLY, "\x1b[>0;276;0c"]);
    t.sent.length = 0;
    hidden = true;
    t.csi(">", "q");
    t.csi(">", "c");
    t.csi(undefined, "c");
    expect(t.sent).toEqual([DA1_WINDOWS]);
    q.dispose();
    t.sent.length = 0;
    t.csi(undefined, "c");
    expect(t.sent).toEqual(["\x1b[?1;2c"]);
  });

  it("only Grok counts as Grok", () => {
    expect(["grok", "grok.cmd", "/usr/local/bin/grok -p hi", "GROK.EXE"].map(isGrok)).toEqual([true, true, true, true]);
    expect(["groks", "claude", "", null, "C:\\grok\\codex.exe"].map(isGrok)).toEqual([false, false, false, false, false]);
  });
});

describe("ORCH-057 dark-or-light from the palette", () => {
  it("reads the palette background's brightness", () => {
    expect(paletteIsDark("#1e1e1e")).toBe(true);
    expect(paletteIsDark("#000")).toBe(true);
    expect(paletteIsDark("#ffffff")).toBe(false);
    expect(paletteIsDark("#fdf6e3")).toBe(false); // a light cream
    expect(paletteIsDark("rgb(0, 43, 54)")).toBe(true); // a dark teal
    expect(paletteIsDark("#777777")).toBe(false); // mid grey: black text contrasts more
    expect(paletteIsDark("#606060")).toBe(true);
    expect(paletteIsDark(undefined)).toBe(null);
    expect(paletteIsDark("transparent")).toBe(null);
  });

  it("a program asking while the app is light but the palette is dark is told dark", () => {
    const appDark = false;
    const theme = { background: "#101418" };
    const t = fakeTerm();
    hookColourMode(t.term, t.send, () => paletteIsDark(theme.background) ?? appDark);
    t.csi("?", "n", [996]);
    expect(t.sent).toEqual([modeReport(true)]);
    expect(modeReport(true)).toBe("\x1b[?997;1n");
  });
});
