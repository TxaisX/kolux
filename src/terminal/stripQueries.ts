// Kept-warm shell (review fix 6): output a shell printed before any pane drew it can hold terminal queries (a
// cursor-position or device-attributes request, a colour or clipboard query, a mode or setting request). Nobody
// answered them then, and the program has stopped waiting. A pane that redraws that output would answer each one
// now, and the answer would reach the shell at its prompt as typed text. So the queries are taken out before the
// redraw; everything else (text, colours, modes the shell turned on, titles, marks) is kept byte for byte.
// Recognised by the public xterm control sequences: CSI requests and reports, OSC queries (a `?` field), DCS
// DECRQSS and XTGETTCAP. A sequence cut off at the end is left as it is; the rest of it arrives as live output.

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;

/** OSC numbers whose `?` field asks for a value back: palette, special colours, the dynamic colours (10 to 19),
 *  kitty's colour stack, the pointer shape and the clipboard. */
const OSC_QUERIES = new Set([4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 52]);

/** XTWINOPS requests that ask for a report (window state, position, sizes, titles). */
const WINDOW_REPORTS = new Set([11, 13, 14, 15, 16, 18, 19, 20, 21]);

// One character per byte: only the ASCII of a sequence's parameters is read (a long clipboard body never spreads into call arguments).
const latin1 = new TextDecoder("latin1");
const text = (bytes: Uint8Array, from: number, to: number) => latin1.decode(bytes.subarray(from, to));

/** Does this CSI ask the terminal for an answer? `params` with its private prefix, `inter` the intermediates. */
function csiAsks(params: string, inter: string, final: string): boolean {
  const prefix = /^[<=>?]/.test(params) ? params[0] : "";
  const nums = (prefix ? params.slice(1) : params).split(";").map((p) => (p === "" ? 0 : Number(p)));
  if (inter === "") {
    if (final === "n") return true; // DSR: status, cursor position, ?6n, ?996n (dark or light)
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

/** Does this OSC body (between `ESC ]` and its terminator) ask for a value back? */
function oscAsks(body: string): boolean {
  const fields = body.split(";");
  if (!OSC_QUERIES.has(Number(fields[0]))) return false;
  return fields.slice(1).some((f) => f === "?" || f.endsWith("=?"));
}

/** `bytes` without the terminal queries in it. */
export function stripQueries(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  let i = 0;
  const keep = (from: number, to: number) => {
    out.set(bytes.subarray(from, to), n);
    n += to - from;
  };
  while (i < bytes.length) {
    if (bytes[i] !== ESC || i + 1 >= bytes.length) {
      out[n++] = bytes[i++];
      continue;
    }
    const kind = bytes[i + 1];
    let end = -1;
    let asks = false;
    if (kind === 0x5b) {
      // CSI: parameter bytes, then intermediates, then one final byte.
      let j = i + 2;
      while (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x3f) j++;
      const paramsEnd = j;
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] <= 0x2f) j++;
      if (j < bytes.length && bytes[j] >= 0x40 && bytes[j] <= 0x7e) {
        end = j + 1;
        asks = csiAsks(text(bytes, i + 2, paramsEnd), text(bytes, paramsEnd, j), String.fromCharCode(bytes[j]));
      }
    } else if (kind === 0x5d || kind === 0x50) {
      // OSC (ended by BEL or ST) and DCS (ended by ST).
      let j = i + 2;
      while (j < bytes.length && !(bytes[j] === ESC && bytes[j + 1] === BACKSLASH) && !(kind === 0x5d && bytes[j] === BEL)) j++;
      if (j < bytes.length && (bytes[j] === BEL || j + 1 < bytes.length)) {
        const body = text(bytes, i + 2, j);
        end = bytes[j] === BEL ? j + 1 : j + 2;
        asks = kind === 0x5d ? oscAsks(body) : /^[0-9;]*[$+]q/.test(body); // DECRQSS, XTGETTCAP
      }
    }
    if (end < 0) {
      // Not a sequence this reads, or one cut off at the end: kept as it is.
      out[n++] = bytes[i++];
      continue;
    }
    if (!asks) keep(i, end);
    i = end;
  }
  return out.slice(0, n);
}
