// Runs INSIDE a terminal pane (node <this> <payload> <result.json>): writes one torture payload to the terminal, then
// ends any half-open sequence, asks the terminal where the cursor is and writes the answer to the result file.
// Payload names: zwj rtl combining longline csi win utf8 osc modes fuzz.
import { writeFileSync } from "node:fs";

const [name, outFile] = process.argv.slice(2);
const ESC = "\x1b";
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const ST = `${ESC}\\`;
const cols = process.stdout.columns || 0;
const rows = process.stdout.rows || 0;

// Deterministic pseudo-random numbers so a failing payload can be replayed.
let seed = 20261025;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const cp = (...c) => String.fromCodePoint(...c);
const ZWJ = "\u200d";

const payloads = {
  zwj: () => {
    const seqs = [
      [cp(0x1f468), ZWJ, cp(0x1f469), ZWJ, cp(0x1f467), ZWJ, cp(0x1f466)].join(""),
      [cp(0x1f469, 0x1f3fd), ZWJ, cp(0x1f4bb)].join(""),
      [cp(0x1f3f3, 0xfe0f), ZWJ, cp(0x1f308)].join(""),
      cp(0x1f1ef, 0x1f1f5, 0x1f1fa, 0x1f1f8, 0x1f1ec, 0x1f1e7),
      `1${cp(0xfe0f, 0x20e3)}`,
      cp(0x2764, 0xfe0f),
      [cp(0x1f469), ZWJ, cp(0x2764, 0xfe0f), ZWJ, cp(0x1f48b), ZWJ, cp(0x1f468)].join(""),
      cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f),
      cp(0x1f44d, 0x1f3fb, 0x1f44d, 0x1f3ff),
    ];
    let s = "";
    for (let i = 0; i < 400; i++) s += `${seqs.map((q) => q.repeat(1 + (i % 4))).join(" ")}\r\n`;
    s += `${cp(0x1f468)}${`${ZWJ}${cp(0x1f469)}`.repeat(2000)}\r\n`; // one 2000-link joiner chain
    s += `${cp(0x1f600).repeat(500)}\r\n`; // 500 wide glyphs in a row
    s += `\r\n${seqs[0].repeat(3)}`; // three family glyphs: three double-wide cells, the cursor on column 7
    return { text: s, expectCol: 7 };
  },
  rtl: () => {
    const he = "\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd";
    const ar = "\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645";
    const ctl = ["\u202e", "\u202d", "\u202a", "\u202b", "\u2066", "\u2067", "\u2068", "\u2069", "\u200f", "\u200e", "\u061c"];
    let s = "";
    for (let i = 0; i < 300; i++) s += `${he} abc ${ar} 123 ${pick(ctl)}${he}${pick(ctl)}${ar}\r\n`;
    s += `${"\u202e".repeat(1000)}text${"\u2069".repeat(1000)}\r\n`; // unbalanced overrides and isolates
    s += `\r\n${"\u05d0".repeat(20)}`; // 20 width-1 letters at the start of a row
    return { text: s, expectCol: 21 };
  },
  combining: () => {
    const marks = [];
    for (let c = 0x300; c < 0x370; c++) marks.push(cp(c));
    let s = "";
    const part = sub === undefined ? null : Number(sub); // combining:N runs only part N (0 = 50 lines of 500 marks, 1 = one base with 10000 marks, 2 = ten cells)
    if (part === null || part === 0) for (let i = 0; i < 50; i++) s += `e${Array.from({ length: 500 }, () => pick(marks)).join("")}x\r\n`;
    if (part === null || part === 1) s += `a${Array.from({ length: 10000 }, () => pick(marks)).join("")}\r\n`; // one base character carrying 10000 marks
    s += `\r\n${"e\u0301".repeat(10)}`; // ten cells
    return { text: s, expectCol: 11 };
  },
  longline: () => {
    let s = `${"\u6f22".repeat(10000)}\r\n`; // 20000 columns of wide glyphs
    s += `${"x".repeat(10000)}\r\n`; // a 10k-column line of narrow glyphs
    const n = 10007;
    s += `${"A".repeat(n)}`; // no newline: the cursor must land at (n mod width) + 1
    return { text: s, expectCol: cols > 0 ? (n % cols) + 1 : null };
  },
  csi: () => {
    const only = sub === undefined ? null : Number(sub);
    const big = "2147483647";
    const list = [
      `${CSI}${";".repeat(100000)}m`,
      `${CSI}999999999999;999999999999H`,
      `${CSI}?;;;;m`,
      `${CSI}38;2;999;999;999m${CSI}38;5;999m${CSI}48;2;-1;-1;-1m`,
      `${CSI}${Array.from({ length: 5000 }, (_, i) => i % 200).join(";")}m`,
      `${CSI}0:1:2:3:4:5m${CSI}4:9m${CSI}58:2::1:2:3m`,
      `${ESC}${CSI}1${ESC}${CSI}2${ESC}(`,
      `${CSI}1$ ${CSI}1\" q${CSI}!p`,
      ...["A", "B", "C", "D", "E", "F", "G", "I", "J", "K", "L", "M", "P", "S", "T", "X", "Z", "@", "b", "d", "e", "`"].map((f) => `${CSI}${big}${f}`),
      `${CSI}${big};${big}r${CSI}${big};${big}s${CSI}${big}\`${CSI}${big}T`,
      `${CSI}8;99999;99999t${CSI}8;1;1t${CSI}18t${CSI}14t${CSI}22;0t${CSI}23;0t`,
      `${CSI}c${CSI}>c${CSI}=c${CSI}?6n${CSI}5n${CSI}x${CSI}?1;2c`,
      `${ESC}#8${ESC}#3${ESC}#6${ESC}%G${ESC}%@${ESC}N${ESC}O${ESC}Z${ESC}=${ESC}>${ESC}7${ESC}8${ESC}H${ESC}6${ESC}9`,
      `${ESC}P1;1|${"x".repeat(5000)}${ST}${ESC}P$qm${ST}${ESC}P+q${"4D".repeat(100)}${ST}`, // DCS, DECRQSS and XTGETTCAP
      `${ESC}_${"x".repeat(5000)}${ST}${ESC}^privacy${ST}${ESC}Xsos${ST}`, // APC, PM and SOS strings
    ];
    let s = "";
    const use = only === null ? list : [list[only] ?? ""];
    for (let i = 0; i < 20; i++) s += use.join("\r\n");
    return { text: s, items: list.length };
  },
  // win:K runs one window-manipulation sequence (the part of the csi list that resizes the pty).
  win: () => {
    const list = [`${CSI}8;99999;99999t`, `${CSI}8;1;1t`, `${CSI}18t`, `${CSI}14t`, `${CSI}22;0t`, `${CSI}23;0t`, `${CSI}8;30;100t`];
    return { text: `${list[Number(sub ?? 0)] ?? ""}
win`, items: list.length };
  },
  utf8: () => {
    const raw = [
      Buffer.from([0xc0, 0xaf, 0xed, 0xa0, 0x80, 0xed, 0xbf, 0xbf, 0xff, 0xfe, 0xf8, 0x88, 0x80, 0x80, 0x80, 0x80, 0xf4, 0x90, 0x80, 0x80]),
      Buffer.alloc(1000, 0), // NUL
      Buffer.from([0x9b, 0x31, 0x6d, 0x9d, 0x30, 0x3b, 0x78, 0x07, 0x90, 0x58, 0x9c, 0x84, 0x85, 0x88, 0x8d, 0x8e, 0x8f, 0x98, 0x9e, 0x9f]), // raw C1 bytes
      Buffer.from(Array.from({ length: 32 }, (_, i) => i).filter((c) => ![0x07, 0x1b, 0x18, 0x1a, 0x05, 0x0e, 0x0f].includes(c))), // C0 controls
      Buffer.from([0x7f, 0x7f, 0x7f]),
      Buffer.from("\ufeff\ufffe\uffff\ufffd\u2028\u2029\u0085\u00ad\u200b\u2060\ufff9\ufffa\ufffb", "utf8"),
      Buffer.from("\u{10ffff}\u{e0001}\u{e007f}\u{f0000}", "utf8"),
      Buffer.from([0xe2, 0x82]), // a cut-off sequence, completed by the text that follows
    ];
    const parts = [];
    for (let i = 0; i < 200; i++) for (const r of raw) parts.push(r, Buffer.from(`ok${i}\r\n`, "utf8"));
    return { buf: Buffer.concat(parts) };
  },
  osc: () => {
    const b64bad = "!!!not-base64!!!";
    const list = [
      `${OSC}0;${"T".repeat(1_000_000)}${ST}`,
      `${OSC}2;${"\u0001\u0002\u0003\u001f".repeat(5000)}\x07`,
      `${OSC}8;;${"http://example.invalid/".padEnd(5000, "a")}${ST}link text${OSC}8;;${ST}`,
      `${OSC}8;id=${"i".repeat(2000)};javascript:alert(1)${ST}js link${OSC}8;;${ST}`,
      `${OSC}8;;file:///C:/Windows/System32/cmd.exe${ST}file link${OSC}8;;${ST}`,
      `${OSC}7;file://%%%/\x00bad\x07${OSC}7;file:///C:/a/${"b/".repeat(3000)}\x07${OSC}7;\x07${OSC}7;${ST}`,
      ...["A", "B", "C", "D;999", "D;abc", "D;", "A;k=i", "P;k=i", "Z", "A;" + "x".repeat(5000)].map((v) => `${OSC}133;${v}\x07`),
      ...["A", "B", "C", "D;1", "E;" + "e".repeat(100000), "P;Cwd=" + "c".repeat(5000), "P;Cwd=\x00", "F", "G"].map((v) => `${OSC}633;${v}\x07`),
      `${OSC}9;4;9;999\x07${OSC}9;4;x;y\x07${OSC}9;4;1;101\x07${OSC}9;4;1;-5\x07${OSC}9;4;0;0\x07${OSC}9;4\x07${OSC}9;\x07`,
      `${OSC}1337;File=inline=1;size=99999999:${b64bad}\x07${OSC}1337;SetMark\x07${OSC}1337;CurrentDir=${"d".repeat(5000)}\x07`,
      `${OSC}52;c;${b64bad}\x07${OSC}52;;\x07${OSC}52;zz;${"A".repeat(100000)}\x07`,
      `${OSC}4;999;rgb:zz/zz/zz\x07${OSC}4;1;?\x07${OSC}10;?\x07${OSC}11;rgb:00/00/00\x07${OSC}104\x07${OSC}110\x07${OSC}111\x07${OSC}112\x07`,
      `${OSC}${"9".repeat(300)};x\x07${OSC};;;;\x07${OSC}\x07${OSC}${ST}${OSC}${OSC}${OSC}0;nested\x07`,
      `${OSC}0;${"unterminated ".repeat(200000)}`, // never closed: only the terminator below ends it
    ];
    let s = "";
    for (let i = 0; i < 5; i++) s += list.join("normal text\r\n");
    return { text: s };
  },
  modes: () => {
    const modes = [1, 3, 4, 5, 6, 7, 9, 12, 25, 40, 45, 47, 66, 67, 69, 80, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 1047, 1048, 1049, 2004, 2026, 2027, 7727, 9001];
    let s = "";
    for (let i = 0; i < 1500; i++) {
      const m = pick(modes);
      s += `${CSI}?${m}${rnd() < 0.5 ? "h" : "l"}`;
      if (i % 7 === 0) s += `${CSI}${Math.floor(rnd() * 90)};${Math.floor(rnd() * 90)}r`; // scroll region, often inverted or beyond the screen
      if (i % 11 === 0) s += `${CSI}${Math.floor(rnd() * 200)};${Math.floor(rnd() * 200)}H${"q".repeat(40)}`;
      if (i % 13 === 0) s += `${CSI}${Math.floor(rnd() * 99)}L${CSI}${Math.floor(rnd() * 99)}M${CSI}${Math.floor(rnd() * 99)}S${CSI}${Math.floor(rnd() * 99)}T`;
      if (i % 17 === 0) s += `${CSI}2J${CSI}3J${CSI}H${ESC}D${ESC}M${ESC}E`;
      if (i % 19 === 0) s += `${CSI}${Math.floor(rnd() * 90)};${Math.floor(rnd() * 90)}s${CSI}u`;
      s += `row ${i}\r\n`;
    }
    for (let i = 0; i < 500; i++) s += `${CSI}?1049h${"alt".repeat(20)}${CSI}?1049l`; // alt screen on and off
    return { text: s };
  },
  fuzz: () => {
    const alphabet = [0x1b, 0x1b, 0x5b, 0x5b, 0x5d, 0x3b, 0x3b, 0x3a, 0x3f, 0x30, 0x31, 0x32, 0x39, 0x6d, 0x48, 0x4a, 0x07, 0x18, 0x1a, 0x5c, 0x50, 0x5f, 0x20, 0x0d, 0x0a, 0x08, 0x09, 0x80, 0x9b, 0x9d, 0xc3, 0xe2, 0xf0, 0xff, 0x00];
    const n = 2_000_000;
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = rnd() < 0.8 ? pick(alphabet) : Math.floor(rnd() * 256);
    return { buf: b };
  },
};

if (!name || !outFile || !payloads[name.split(":")[0]]) {
  console.error(`usage: node s6-torture-payloads.mjs <${Object.keys(payloads).join("|")}> <result.json>`);
  process.exit(2);
}
// csi:N runs only item N of the malformed-CSI list. Parsed after the argument check so a bad call never reaches it.
const [base, sub] = name.split(":");

let inbuf = "";
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (d) => {
  inbuf += d.toString("latin1");
  if (inbuf.length > 5_000_000) inbuf = inbuf.slice(-1_000_000);
});
const write = (b) => new Promise((r) => process.stdout.write(b, r));
const writeChunked = async (buf) => {
  for (let i = 0; i < buf.length; i += 65536) await write(buf.subarray(i, i + 65536));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Asks for the cursor position; only a reply that arrives after the question counts.
const cursor = async (ms = 4000) => {
  const mark = inbuf.length;
  const t0 = Date.now();
  await write(`${CSI}6n`);
  while (Date.now() - t0 < ms) {
    const m = /\x1b\[(\d+);(\d+)R/.exec(inbuf.slice(mark));
    if (m) return { row: Number(m[1]), col: Number(m[2]), ms: Date.now() - t0 };
    await sleep(20);
  }
  return null;
};

const p = payloads[base]();
const buf = p.buf ?? Buffer.from(p.text, "utf8");
const t0 = Date.now();
await writeChunked(buf);
const writeMs = Date.now() - t0;
await sleep(500);
const cprBody = await cursor(); // asked right after the payload, before any clean-up
// The cursor holds here while the harness measures where the terminal drew it.
writeFileSync(`${outFile}.body`, JSON.stringify({ cprBody, cols, expectCol: p.expectCol ?? null }));
await sleep(1800);
// End anything half open: CAN cancels a string or sequence, then ST, then charset and mode reset and a soft reset.
await write(`\x18${ST}\x0f${ESC}(B${CSI}0m${CSI}!p${CSI}?1049l${CSI}r${CSI}?25h`);
await write("\r\nS6C");
await sleep(300);
const cprAfter = await cursor();
// The result file is the signal that the cursor now sits right after "S6C"; it stays there while the harness looks at the screen.
writeFileSync(outFile, JSON.stringify({ name, items: p.items ?? null, sizeAfter: process.stdout.getWindowSize?.() ?? null, bytes: buf.length, writeMs, cols, rows, expectCol: p.expectCol ?? null, cprBody, cprAfter }));
await sleep(3500);
await write(`\r\nS6-DONE-${name}\r\n`);
process.stdin.setRawMode?.(false);
process.exit(0);
