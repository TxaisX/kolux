import { describe, expect, it } from "vitest";
import { keepRaw, richBlocker, richBlockerSince, richChange } from "./frontMatter";
import { roundTrip } from "./markdown";

// Row 94 review (HIGH): on repetitive text a typed word must land in the paragraph the user edited,
// and every other byte of the file stays as it was.
const apply = (t: string, c: { from: number; to: number; insert: string } | null) => (c ? t.slice(0, c.from) + c.insert + t.slice(c.to) : t);

/** The user's edit as the rich view reports it: `edited` is the text with the change made in the file's own
 *  spelling, `out` is the rich view's spelling of it. The change must give back exactly `edited`. */
const typed = (body: string, edited: string) => {
  const prev = roundTrip(body)!;
  const out = roundTrip(edited)!;
  return apply(body, richChange(body, out, prev));
};


/** The probe-style edit: the rich view gives back its own spelling (`prev`) with " NEWWORD" typed at the first space
 *  `skip` characters into paragraph `n`. Returns the file after the change (null: no space in the paragraph there). */
const spelt = new Map<string, string>();
const typedInRich = (body: string, n: number, skip = 10) => {
  const prev = (spelt.get(body) ?? spelt.set(body, roundTrip(body)!).get(body))!;
  const paras = prev.split("\n\n");
  const start = paras.slice(0, n).reduce((a, p) => a + p.length + 2, 0);
  const at = prev.indexOf(" ", start + skip);
  if (at < 0 || at >= start + paras[n].length) return null;
  const out = prev.slice(0, at) + " NEWWORD" + prev.slice(at);
  return apply(body, richChange(body, out, prev));
};
/** One NEWWORD (and one space beside it) was added, in paragraph `n`, and every other byte is as the file had it. */
const landedIn = (body: string, got: string | null, n: number) => {
  if (got === null) return true;
  const k = got.indexOf("NEWWORD");
  return k > 0 && got.slice(0, k).split("\n\n").length - 1 === n && [" NEWWORD", "NEWWORD "].some((m) => got.replace(m, "") === body);
};

const twelve = Array.from({ length: 12 }, () => "Meeting notes for the week\nwith action items listed\nand owners named");
const wrapped = (n: number) => Array.from({ length: n }, (_, i) => `para ${i} first_line of some words\nsecond line with *star* here\nand __bold__ end`);

/** Paragraph `n` of `paras` with `f` applied, the rest as they were, joined into a file. */
const edit = (paras: string[], n: number, f: (p: string) => string) => paras.map((p, i) => (i === n ? f(p) : p)).join("\n\n") + "\n";

describe("repro (a): twelve identical paragraphs", () => {
  const body = twelve.join("\n\n") + "\n";
  it("a word typed anywhere in the rich view's paragraphs 1..10 lands in that paragraph (839-byte note)", () => {
    expect(body.length).toBeLessThan(1000);
    const bad: string[] = [];
    for (let n = 1; n < 11; n++) for (let skip = 0; skip < 70; skip += 3) if (!landedIn(body, typedInRich(body, n, skip), n)) bad.push(`${n}/${skip}`);
    expect(bad).toEqual([]);
  });
  it.each([0, 1, 5, 6, 10, 11])("a word typed in paragraph %i lands there", (n) => {
    expect(typed(body, edit(twelve, n, (p) => p.replace("the week", "the typed week")))).toBe(edit(twelve, n, (p) => p.replace("the week", "the typed week")));
  });
  it.each([0, 6, 11])("edits at the start, middle and end of paragraph %i", (n) => {
    for (const f of [(p: string) => "Start " + p, (p: string) => p.replace("action items", "action mid items"), (p: string) => p + " end"]) expect(typed(body, edit(twelve, n, f))).toBe(edit(twelve, n, f));
  });
});

describe("repro (b): wrapped paragraphs the rich view respells", () => {
  it.each([5, 60])("%i paragraphs: a word typed in a middle paragraph lands there (small and big notes)", (count) => {
    const paras = wrapped(count);
    const body = paras.join("\n\n") + "\n";
    expect(roundTrip(body)).toContain("**bold**"); // the rich view respells __bold__
    const bad: string[] = [];
    for (let n = 1; n < count - 1; n++) for (let skip = 0; skip < 70; skip += 3) if (!landedIn(body, typedInRich(body, n, skip), n)) bad.push(`${n}/${skip}`);
    expect(bad).toEqual([]);
    for (const n of [0, Math.floor(count / 2), count - 1]) {
      for (const f of [(p: string) => p.replace("first_line", "first_line typed"), (p: string) => p.replace("second line", "second typed line"), (p: string) => p.replace("end", "end typed"), (p: string) => "Start " + p]) {
        expect(typed(body, edit(paras, n, f))).toBe(edit(paras, n, f));
      }
    }
  }, 20_000);
  it("the 839-byte case stays under 8 KB and still lands right", () => {
    const paras = wrapped(7);
    const body = paras.join("\n\n") + "\n";
    expect(body.length).toBeLessThan(8000);
    expect(typed(body, edit(paras, 4, (p) => p.replace("*star*", "*star* typed")))).toBe(edit(paras, 4, (p) => p.replace("*star*", "*star* typed")));
  });
});

describe("whole words and whole paragraphs", () => {
  const paras = wrapped(9);
  const body = paras.join("\n\n") + "\n";
  it("inserting and deleting whole words", () => {
    expect(typed(body, edit(paras, 4, (p) => p.replace("of some", "of brand new some")))).toBe(edit(paras, 4, (p) => p.replace("of some", "of brand new some")));
    expect(typed(body, edit(paras, 4, (p) => p.replace("of some ", "")))).toBe(edit(paras, 4, (p) => p.replace("of some ", "")));
    expect(typed(body, edit(paras, 7, (p) => p.replace("second line with *star* here\n", "")))).toBe(edit(paras, 7, (p) => p.replace("second line with *star* here\n", "")));
  });
  it("inserting a whole paragraph", () => {
    const edited = [...paras.slice(0, 5), "A brand new paragraph", ...paras.slice(5)].join("\n\n") + "\n";
    expect(typed(body, edited)).toBe(edited);
  });
  it("deleting a whole paragraph", () => {
    const edited = [...paras.slice(0, 5), ...paras.slice(6)].join("\n\n") + "\n";
    expect(typed(body, edited)).toBe(edited);
  });
  it("deleting a paragraph among identical ones removes the one the user chose", () => {
    const same = Array.from({ length: 12 }, (_, i) => (i === 7 ? "the odd one out" : "Meeting notes for the week\nwith action items listed\nand owners named"));
    const edited = [...same.slice(0, 7), ...same.slice(8)].join("\n\n") + "\n";
    expect(typed(same.join("\n\n") + "\n", edited)).toBe(edited);
  });
});

describe("small bodies", () => {
  it("typing into an empty note, a one-word note and a note of only markers", () => {
    expect(typed("", "first words")).toBe("first words");
    expect(typed("one\n", "one two")).toBe("one two\n");
    // Round 3: `prev` is the rich view's real spelling (it keeps `*` bullets); a made-up "- " read back as "- a", not "* a".
    expect(roundTrip(typed("* \n", "* a\n"))).toBe("* a");
    expect(typed("* one\n", "* one two\n")).toBe("* one two\n");
  });
});

describe("fail closed", () => {
  it("a body whose words differ from the rich view's earlier text is never written into a guessed place", () => {
    // `prev` says "alpha beta"; the file says something else entirely.
    expect(keepRaw("one two\n", "alpha beta gamma", "alpha beta")).toBe("one two\n");
    expect(richChange("one two\n", "alpha beta gamma", "alpha beta")).toBeNull();
  });
  it("twelve identical paragraphs where the file drifted by one word: refused, not placed in a guessed copy", () => {
    const body = twelve.join("\n\n") + "\n";
    const prev = roundTrip(body)!;
    const drifted = body.replace("owners named", "owners renamed");
    const k = prev.indexOf("the week");
    const out = prev.slice(0, k) + "the typed week" + prev.slice(k + 8);
    let refused = 0;
    expect(richChange(drifted, out, prev, () => refused++)).toBeNull();
    expect(refused).toBe(1);
  });
  it("tells the caller when it refused", () => {
    let refused = 0;
    richChange("one two\n", "alpha beta gamma", "alpha beta", () => refused++);
    expect(refused).toBe(1);
    richChange("alpha beta\n", "alpha beta gamma", "alpha beta", () => refused++);
    expect(refused).toBe(1);
  });
});

describe("a ~43 KB wrapped note", () => {
  const paras = Array.from({ length: 330 }, (_, i) => `para ${i} first_line of some snake_case words\nsecond line with *star* here\nthird line wraps on\nand __bold__ ends the paragraph`);
  const body = paras.join("\n\n") + "\n";
  const prev = roundTrip(body)!;
  it("one edit changes only that span, and is not slower than a quarter of a second", () => {
    expect(body.length).toBeGreaterThan(40_000);
    expect(body.length).toBeLessThan(48_000);
    const edited = edit(paras, 211, (p) => p.replace("some snake_case", "some typed snake_case"));
    const out = roundTrip(edited)!;
    const t0 = performance.now();
    let c = null;
    for (let i = 0; i < 20; i++) c = richChange(body, out, prev);
    const ms = (performance.now() - t0) / 20;
    console.log(`43 KB keepRaw: ${ms.toFixed(2)} ms per edit (${body.length} bytes)`);
    expect(apply(body, c)).toBe(edited);
    expect(c!.insert.length).toBeLessThan(40);
    expect(ms).toBeLessThan(250);
  });
});

describe("the twin-pane re-show asks the same question as the first show", () => {
  it("a body whose words the rich view cannot spell back is refused with the source-view banner", () => {
    const note = "---\ntitle: x\n---\nplain words here\n";
    expect(richBlocker(note, false)).toBeNull();
    // A reference link line is text the rich view would drop.
    const lossy = "---\ntitle: x\n---\nsome words\n\n[r]: http://a.b/c\n";
    expect(richBlocker(lossy, false)?.text).toMatch(/^Showing source: the rich view cannot show this file because it has reference links/);
    // An HTML comment is dropped on the way back.
    const dropped = "some words <!-- hidden --> here\n";
    expect(richBlocker(dropped, false)?.text).toContain("HTML comments");
  });
  it("a body past the size limit is refused unless the user chose Open anyway", () => {
    const big = "word ".repeat(400_000);
    expect(richBlocker(big, false)?.big).toBe(true);
    expect(richBlocker(big, true)?.big).toBeUndefined();
  });
  it("front matter is not part of what is checked", () => {
    expect(richBlocker("---\ntags: [a, <!-- x -->]\n---\nbody\n", false)).toBeNull();
  });
  it("L1: a twin keystroke in a ~44 KB note checks only the blocks it changed, and still catches what the full check catches", () => {
    const paras = Array.from({ length: 330 }, (_, i) => `para ${i} first_line of some snake_case words\nsecond line with *star* here\nthird line wraps on\nand __bold__ ends the paragraph`);
    const big = "---\ntitle: x\n---\n" + paras.join("\n\n") + "\n";
    const typedIn = big.replace("para 200 first_line", "para 200 typed first_line");
    expect(richBlockerSince(big, typedIn, false)).toBeNull();
    expect(richBlockerSince(big, big, false)).toBeNull();
    const comment = big.replace("para 200 first_line", "para 200 <!-- x --> first_line");
    expect(richBlockerSince(big, comment, false)?.text).toBe(richBlocker(comment, false)?.text);
    const ref = big.replace("\n\npara 200 ", "\n\n[r]: http://a.b/c\n\npara 200 ");
    expect(richBlockerSince(big, ref, false)?.text).toBe(richBlocker(ref, false)?.text);
    const html = big.replace("and __bold__ ends the paragraph\n", "and __bold__ ends <b>the</b> paragraph\n");
    expect(richBlockerSince(big, html, false)?.text).toBe(richBlocker(html, false)?.text);
    const time = (f: () => unknown, n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) f();
      return (performance.now() - t0) / n;
    };
    const full = time(() => richBlocker(typedIn, false), 3);
    const since = time(() => richBlockerSince(big, typedIn, false), 20);
    console.log(`twin re-show check at ${big.length} bytes: full ${full.toFixed(1)} ms, changed blocks ${since.toFixed(2)} ms`);
    expect(since).toBeLessThan(full / 5);
  });
});

// Row 94 review round 3 (HOLD): the word check alone cannot see marker or line-break damage. Each edit must save a
// body the rich view reads back as its own text, and every byte outside the touched paragraph stays as the file had it.
describe("marker and line-break damage next to respelt emphasis", () => {
  const PRE = "Keep __this__ one\nas is\n\n\n";
  const POST = "\n\n\nAnd _keep_ this\n";
  /** `body` placed between two untouched paragraphs (only after one when `end`), edited in the rich view's spelling. */
  const check = (body: string, ed: (p: string) => string, exact?: string, end = false) => {
    const full = PRE + body + (end ? "" : POST);
    const prev = roundTrip(full)!;
    const cp = roundTrip(body)!;
    expect(prev).toContain(cp);
    const out = prev.replace(cp, ed(cp));
    let refused = 0;
    const next = apply(full, richChange(full, out, prev, () => refused++));
    expect(refused).toBe(0);
    expect(roundTrip(next)).toBe(roundTrip(out));
    expect(next.startsWith(PRE)).toBe(true);
    if (!end) expect(next.endsWith(POST)).toBe(true);
    if (exact !== undefined) expect(next).toBe(PRE + exact + (end ? "" : POST));
  };
  it("H1: Enter after italic at line end", () => check("see _this_\nwrapped", (p) => p.replace("* wr", "*\n\nwr")));
  it("H1: Enter after bold at line end", () => check("see __this__\nwrapped", (p) => p.replace("** wr", "**\n\nwr")));
  it("H1: Backspace joining the next line onto italic", () => check("see _this_\nwrapped", (p) => p.replace("* wr", "*wr")));
  it("H1: Enter before italic at line start", () => check("wrapped\n_this_ see", (p) => p.replace("wrapped *", "wrapped\n\n*")));
  it("H1: typing after italic at line end", () => check("see _this_\nwrapped", (p) => p.replace("* wr", "*Q wr")));
  it("H2: a period after italic at the note's end keeps the last line end", () => check("see _this_\n", (p) => p + ".", "see *this*.\n", true));
  it("H2: a period after italic before extra blank lines", () => check("see _this_\n\n\nNext one", (p) => p.replace("*\n\n", "*.\n\n"), "see *this*.\n\n\nNext one"));
  it("H2: a period after italic with a trailing space", () => check("see _this_ \n\nNext one", (p) => p.replace("*\n\n", "*.\n\n"), "see *this*.\n\nNext one"));
  it("H2: CRLF note", () => {
    const body = "one __two__\r\n";
    const prev = roundTrip(body)!;
    const next = apply(body, richChange(body, prev + ".", prev));
    expect(roundTrip(next)).toBe(roundTrip(prev + "."));
    expect(next.endsWith("\r\n")).toBe(true);
  });
  it("H2: front matter stays and the period lands", () => {
    const fm = "---\ntitle: x\n---\n";
    const prev = roundTrip("see _this_\n")!;
    const next = apply(fm + "see _this_\n", richChange(fm + "see _this_\n", prev + ".", prev));
    expect(next).toBe(fm + "see *this*.\n");
  });
  it("H3: pasting at the start of a paragraph after extra blank lines", () => check("a\n\n\n\nb", (p) => p.replace("\nb", "\nNote: b"), "a\n\n\n\nNote: b"));
  it("H3: selecting the blank lines and typing a space joins the paragraphs", () => check("a\n\n\n\nb", (p) => p.replace("a\n\nb", "a b"), "a b"));
  it("M1: typing at the start of a paragraph after extra blank lines is accepted", () => check("a\n\n\n\nb", (p) => p.replace("\nb", "\nZb"), "a\n\n\n\nZb"));
  it("M1: Backspace at the start of that paragraph joins it", () => check("a\n\n\n\nb", (p) => p.replace("a\n\nb", "ab"), "ab"));
  it("M2: a letter typed right after _API_", () => check("the _API_ call", (p) => p.replace("* call", "*s call")));
  it("M2: a letter typed right before __API__", () => check("the __API__ call", (p) => p.replace("the **", "the X**")));
  it("L2: Enter after italic in a wrapped list item leaves no line of only spaces", () => {
    check("- see _this_\n  wrapped", (p) => p.replace("* wr", "*\n- wr"));
    const body = "- see _this_\n  wrapped\n";
    const prev = roundTrip(body)!;
    const next = apply(body, richChange(body, prev.replace("* wr", "*\n- wr"), prev));
    expect(next).not.toMatch(/^[ \t]+$/m);
  });
});
