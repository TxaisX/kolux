// ORCH-057: terminal capability queries a program sends are answered on the app's behalf.
// - Primary device attributes (DA1, CSI c / CSI 0 c): on Windows the console's own answer, CSI ? 1 ; 0 c
//   ("VT101 with no options", as Microsoft's public "Console Virtual Terminal Sequences" page documents),
//   so a program behind ConPTY sees the terminal it expects; elsewhere xterm's default answer goes out.
// - Terminal version (XTVERSION, CSI > q / CSI > 0 q, per the public xterm control sequences): answered
//   with DCS > | Kolux ST. Secondary device attributes (DA2, CSI > c) keep xterm's default answer.
// - A hidden Grok terminal holds back only the version answers (XTVERSION and DA2); every other query
//   answer still goes out.
// - Dark-or-light: the palette's own background brightness decides, not the app's light or dark mode
//   (paletteIsDark feeds colourMode.ts).

type Params = (number | number[])[];
type Parser = { registerCsiHandler(id: { prefix?: string; final: string }, cb: (p: Params) => boolean): { dispose(): void } };

export const DA1_WINDOWS = "\x1b[?1;0c";
export const XTVERSION_REPLY = "\x1bP>|Kolux\x1b\\";

const noArgOrZero = (p: Params) => p.length === 0 || (p.length === 1 && (p[0] === 0 || (Array.isArray(p[0]) && p[0].length === 0)));

/** A program whose command names Grok (a path or a bare name, with or without .exe or .cmd). */
export function isGrok(program: string | null | undefined): boolean {
  const first = (program ?? "").trim().split(/\s+/)[0] ?? "";
  const base = first.split(/[\\/]/).pop() ?? "";
  return /^grok(\.(exe|cmd|bat|ps1))?$/i.test(base);
}

export function hookQueries(term: { parser: Parser }, send: (data: string) => void, opts: { windows: boolean; holdVersion: () => boolean }) {
  const hooks = [
    term.parser.registerCsiHandler({ final: "c" }, (p) => {
      if (!opts.windows || !noArgOrZero(p)) return false;
      send(DA1_WINDOWS);
      return true;
    }),
    // returning true without sending holds the answer back; false lets xterm's own DA2 answer go out
    term.parser.registerCsiHandler({ prefix: ">", final: "c" }, (p) => noArgOrZero(p) && opts.holdVersion()),
    term.parser.registerCsiHandler({ prefix: ">", final: "q" }, (p) => {
      if (!noArgOrZero(p)) return false;
      if (!opts.holdVersion()) send(XTVERSION_REPLY);
      return true;
    }),
  ];
  return { dispose: () => hooks.forEach((h) => h.dispose()) };
}

/** The palette background's relative luminance (WCAG 2, sRGB); null when the colour cannot be read. */
export function luminance(colour: string | undefined): number | null {
  if (!colour) return null;
  const c = colour.trim();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1].slice(0, 6);
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(c);
    if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  }
  if (!rgb || rgb.some((v) => v > 255)) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark when white text on the background would contrast more than black text (WCAG contrast ratio);
 *  null when the background cannot be read (the caller falls back to the app's mode). */
export function paletteIsDark(background: string | undefined): boolean | null {
  const l = luminance(background);
  if (l === null) return null;
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.05;
}
