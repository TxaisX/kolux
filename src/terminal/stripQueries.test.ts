// Kept-warm shell (review fix 6): the queries in a warm shell's output so far are taken out before a pane redraws it;
// everything else is kept byte for byte.
import { describe, expect, it } from "vitest";
import { stripQueries } from "./stripQueries";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const str = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const strip = (s: string) => str(stripQueries(bytes(s)));
const E = "\x1b";
const ST = `${E}\\`;

describe("stripQueries", () => {
  it("takes out every query xterm or the pane would answer, not only the first cursor question", () => {
    const queries = [
      `${E}[6n`, // cursor position (the console host's question)
      `${E}[?6n`, // DECXCPR
      `${E}[5n`, // status
      `${E}[?996n`, // dark or light (colourMode.ts answers it)
      `${E}[c`, // DA1
      `${E}[0c`,
      `${E}[>c`, // DA2
      `${E}[>0c`,
      `${E}[=c`, // DA3
      `${E}[>q`, // XTVERSION (queries.ts answers it)
      `${E}[>0q`,
      `${E}[?u`, // kitty keyboard flags (the pane answers it)
      `${E}[?2026$p`, // DECRQM, private
      `${E}[4$p`, // DECRQM, ANSI
      `${E}[?4m`, // XTQMODKEYS
      `${E}[14t`, // XTWINOPS size in pixels
      `${E}[18t`, // XTWINOPS size in characters
      `${E}[21t`, // XTWINOPS title
      `${E}[?1;1;0S`, // XTSMGRAPHICS read
      `${E}[1;1;1;1;1;1*y`, // DECRQCRA
      `${E}]11;?\x07`, // background colour, BEL
      `${E}]10;?${ST}`, // foreground colour, ST
      `${E}]4;1;?${ST}`, // palette entry
      `${E}]52;c;?\x07`, // clipboard read (osc52.ts answers it)
      `${E}]21;foreground=?${ST}`, // kitty colour stack
      `${E}P$q"p${ST}`, // DECRQSS
      `${E}P+q544e${ST}`, // XTGETTCAP
    ];
    for (const q of queries) expect(strip(`a${q}b`), JSON.stringify(q)).toBe("ab");
    expect(strip(`${E}[6n${E}[c${E}]11;?\x07PS C:\\work> ${E}[6n`)).toBe("PS C:\\work> ");
  });

  it("keeps modes, keyboard and cursor settings, titles, colours set, marks and plain text", () => {
    const kept = [
      `${E}[?9001h${E}[?1004h`, // ConPTY's own modes: win32 input and focus reports stay on, as in a fresh pane
      `${E}[?2004h${E}[?1049h${E}[?25l`,
      `${E}[>1u${E}[<u${E}[=1;1u`, // kitty keyboard push, pop, set
      `${E}[2 q`, // cursor style (DECSCUSR), not XTVERSION
      `${E}[>4;1m`, // XTMODKEYS set
      `${E}[22;0t${E}[23;0t${E}[8;24;80t`, // title stack, resize
      `${E}[31mred${E}[0m${E}[1;1H${E}[2J`,
      `${E}]0;what?\x07`, // a title that ends in a question mark
      `${E}]11;#101010${ST}`, // a colour set, not asked
      `${E}]52;c;aGk=\x07`, // a clipboard copy
      `${E}]133;A${ST}${E}]9999;{"a":1}\x07`, // prompt marks, in-band status
      `${E}P1;2|17/ab${ST}`, // a DCS that asks nothing
      `${E}7${E}8${E}(B`,
      "why? 6n c u ?",
    ];
    for (const k of kept) expect(strip(k), JSON.stringify(k)).toBe(k);
  });

  it("leaves a sequence cut off at the end as it is, for the live output to finish", () => {
    for (const cut of [`PS> ${E}`, `PS> ${E}[6`, `PS> ${E}]11;?`, `PS> ${E}P$q"p`]) expect(strip(cut)).toBe(cut);
  });

  it("keeps UTF-8 text and a long clipboard body intact", () => {
    const text = new TextEncoder().encode("prompt 漢字 ✓ ");
    const withQuery = new Uint8Array([...text, 0x1b, 0x5b, 0x36, 0x6e]);
    expect(new TextDecoder().decode(stripQueries(withQuery))).toBe("prompt 漢字 ✓ ");
    const long = `${E}]52;c;${"QUJD".repeat(100_000)}\x07`;
    expect(strip(long)).toBe(long);
  });
});
