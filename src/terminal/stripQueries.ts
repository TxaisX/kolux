// Kept-warm shell (review fix 6): output a shell printed before any pane drew it can hold terminal queries (a
// cursor-position or device-attributes request, a colour or clipboard query, a mode or setting request). Nobody
// answered them then, and the program has stopped waiting. A pane that redraws that output would answer each one
// now, and the answer would reach the shell at its prompt as typed text. So the queries are taken out before the
// redraw; everything else (text, colours, modes the shell turned on, titles, marks) is kept byte for byte, and an
// OSC that sets one colour and asks another keeps the setting. Recognised by the public xterm control sequences:
// CSI requests and reports, OSC queries (a `?` field), DCS DECRQSS and XTGETTCAP. An OSC or DCS ends at BEL (OSC
// only), at ST, or at an ESC alone, which xterm.js also takes as its end. A sequence cut off at the end is left as
// it is; the rest of it arrives as live output.

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;

/** OSC numbers whose `?` field asks for a value back: palette, special colours, the dynamic colours (10 to 19),
 *  kitty's colour stack, the pointer shape and the clipboard. */
const OSC_QUERIES = new Set([4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 52]);

/** XTWINOPS requests that ask for a report (window state, position, sizes, titles). */
const WINDOW_REPORTS = new Set([11, 13, 14, 15, 16, 18, 19, 20, 21]);

/** One character per byte (only the ASCII of a sequence's parameters is read), in slices so a long clipboard body
 *  never spreads into one call's arguments. */
function text(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let k = from; k < to; k += 8192) s += String.fromCharCode(...bytes.subarray(k, Math.min(to, k + 8192)));
  return s;
}

const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Does this CSI ask the terminal for an answer? `params` with its private prefix, `inter` the intermediates. */
function csiAsks(params: string, inter: string, final: string): boolean {
  const prefix = /^[<=>?]/.test(params) ? params[0] : "";
  const nums = (prefix ? params.slice(1) : params).split(";").map((p) => (p === "" ? 0 : Number(p)));
  if (inter === "") {
    if (final === "n") return prefix === "" || prefix === "?"; // DSR: status, cursor position, ?6n, ?996n; not CSI > n (a key setting)
    if (final === "c") return prefix === "" || prefix === ">" || prefix === "="; // DA1, DA2, DA3
    if (final === "q") return prefix === ">"; // XTVERSION
    if (final === "u") return prefix === "?"; // kitty keyboard flags
    if (final === "m") return prefix === "?"; // XTQMODKEYS
    if (final === "S") return prefix === "?" && (nums[1] === 1 || nums[1] === 4); // XTSMGRAPHICS read
    if (final === "t") return prefix === "" && WINDOW_REPORTS.has(nums[0]);
    return false;
  }
  if (inter === "$") return final === "p" || final === "w" || final === "u"; // DECRQM, DECRQPSR, DECRQTSR
  if (inter === "*") return final === "y"; // DECRQCRA
  return false;
}

const asks = (field: string) => field === "?" || field.endsWith("=?");

/** An OSC body without its questions: null when it asks nothing (kept as it is), else the bodies to keep (none when
 *  all of it asks). OSC 4 and 5 take index;spec pairs; OSC 10 to 19 run on to the next colour with each field, so a
 *  set after a question is renumbered; kitty's OSC 21 takes key=value fields. */
function oscWithoutQuestions(body: string): string[] | null {
  const fields = body.split(";");
  const ps = Number(fields[0]);
  const rest = fields.slice(1);
  if (fields[0] === "" || !OSC_QUERIES.has(ps) || !rest.some(asks)) return null;
  if (ps === 4 || ps === 5) {
    const kept: string[] = [];
    for (let k = 0; k + 1 < rest.length; k += 2) if (!asks(rest[k + 1])) kept.push(rest[k], rest[k + 1]);
    return kept.length ? [`${ps};${kept.join(";")}`] : [];
  }
  if (ps >= 10 && ps <= 19) {
    const out: string[] = [];
    let group: string[] = [];
    let first = ps;
    rest.forEach((f, k) => {
      if (asks(f)) {
        if (group.length) out.push(`${first};${group.join(";")}`);
        group = [];
        return;
      }
      if (!group.length) first = ps + k;
      group.push(f);
    });
    if (group.length) out.push(`${first};${group.join(";")}`);
    return out;
  }
  if (ps === 21) {
    const kept = rest.filter((f) => !asks(f));
    return kept.length ? [`21;${kept.join(";")}`] : [];
  }
  return []; // OSC 22 and 52: the whole sequence asks
}

/** `bytes` without the terminal queries in it. */
export function stripQueries(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let from = 0; // the start of the bytes not yet passed on
  let i = 0;
  const drop = (start: number, end: number, instead?: Uint8Array) => {
    parts.push(bytes.subarray(from, start));
    if (instead) parts.push(instead);
    from = end;
  };
  while (i < bytes.length) {
    if (bytes[i] !== ESC || i + 1 >= bytes.length) {
      i++;
      continue;
    }
    const kind = bytes[i + 1];
    if (kind === 0x5b) {
      // CSI: parameter bytes, then intermediates, then one final byte.
      let j = i + 2;
      while (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x3f) j++;
      const paramsEnd = j;
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] <= 0x2f) j++;
      if (j < bytes.length && bytes[j] >= 0x40 && bytes[j] <= 0x7e) {
        if (csiAsks(text(bytes, i + 2, paramsEnd), text(bytes, paramsEnd, j), String.fromCharCode(bytes[j]))) drop(i, j + 1);
        i = j + 1;
        continue;
      }
    } else if (kind === 0x5d || kind === 0x50) {
      // OSC (ended by BEL, ST or an ESC alone) and DCS (ended by ST or an ESC alone).
      let j = i + 2;
      while (j < bytes.length && bytes[j] !== ESC && !(kind === 0x5d && bytes[j] === BEL)) j++;
      if (j < bytes.length) {
        // An ESC alone ends the sequence without being part of it: it starts what follows.
        const end = bytes[j] === BEL ? j + 1 : bytes[j + 1] === BACKSLASH ? j + 2 : j;
        const body = text(bytes, i + 2, j);
        if (kind === 0x50) {
          if (/^[0-9;]*[$+]q/.test(body)) drop(i, end); // DECRQSS, XTGETTCAP
        } else {
          const kept = oscWithoutQuestions(body);
          if (kept !== null) {
            const term = bytes[j] === BEL ? "\x07" : "\x1b\\";
            const last = end === j ? "" : term; // an ESC alone still ends the last one
            drop(i, end, bytesOf(kept.map((b, k) => `\x1b]${b}${k === kept.length - 1 ? last : term}`).join("")));
          }
        }
        i = Math.max(end, i + 2);
        continue;
      }
    }
    // Not a sequence this reads, or one cut off at the end: passed on as it is.
    i++;
  }
  if (from === 0) return bytes;
  parts.push(bytes.subarray(from));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let n = 0;
  for (const p of parts) {
    out.set(p, n);
    n += p.length;
  }
  return out;
}
