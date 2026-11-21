# Claude TUI visuals — 2026-11-20

What a Claude Code turn looks like on screen: glyphs, indent widths, colours, wording.
Companion to `claude-code-turn-capture-2026-11-20.md`, which inferred these from the binary.

OBSERVED method: `claude` 2.1.330 in a 110x40 window under a real pseudo-terminal
(`@lydell/node-pty` → ConPTY), screen rebuilt by `@xterm/headless` + serialize addon, so every
colour below is the byte sequence the TUI emitted. Classic renderer (fullscreen had failed on
an earlier launch and fell back). Real model turns were impossible — the account is at its
weekly limit (`You've hit your weekly limit · resets Nov 21, 9pm`) — so the **real binary** is
driven by a local mock Messages API (`mock-rich.js`, 127.0.0.1:8799) returning scripted tool
calls. Renderer, prompts, diff preview, grouping and spinner are the binary's own code.

Evidence, all under `G:\Temp\opencode\claude-tui\`:

| id | what | file |
|---|---|---|
| V1 | raw bytes of the 5-turn session (36.9 KB) + 22 labelled snapshots (`.txt`, `.ansi.txt` exact SGR, `.colors.tsv`) | `run-groups/raw.bin`, `run-groups/snap-*` |
| V2 | shell permission prompt, then `Tab to amend` | `run-bash2/snap-001`, `snap-002` |
| V3 | 6-row degradation, rejection row, grouping in flight vs settled, verbose transcript, 136 auto frames | `run-tiny/`, `run-full2/snap-005`, `run-groups/snap-006`, `snap-009`, `run-groups/auto/` |

## 1. Turn anatomy — glyphs, indent, colour

OBSERVED (V1, V3). One turn is rows at a fixed set of left edges. Columns are 1-based.

| row | indent | glyph | colour | text |
|---|---|---|---|---|
| user message | col 1 | `❯` U+276F | #FFFFFF on a full-width #373737 bar (`\e[48;2;55;55;55m`) | prompt verbatim |
| assistant text | col 1 | `●` U+25CF | bullet #FFFFFF, body default fg | prose |
| tool call | col 1 | `●` U+25CF | bullet **green #4EBA65** on `Write`/`Update`, **grey #999999** on `Bash` and grouped rows (rule INFERRED); tool name bold, target normal | `Write(notes.txt)`, `Update(notes.txt)`, `Printing ok` |
| tool result | col 3 | `⎿` U+23BF | gutter #999999 | one line, truncated; gutter is `⎿` + space + non-breaking space |
| diff line | col 7 | none | see §3 | ` 4 -delta line four` |
| group summary | col 3 | none | #999999, counts bold | `Searched for 1 pattern, read 2 files, ran 1 shell command · 1 failed` |
| closing line | col 1 | `✻` U+273B | #999999 | `Churned for 13s · done 4:52 PM` |

Colours by name: Claude orange **#D77757** `\e[38;2;215;119;87m` (logomark, spinner glyph),
lighter orange **#EB9F7F** `\e[38;2;235;159;127m` (spinner verb), secondary grey **#999999**
`\e[38;2;153;153;153m` (results, summaries, footer), rule grey **#888888**
`\e[38;2;136;136;136m` (input box), box grey **#505050** `\e[38;2;80;80;80m` (dashed
separators), lavender **#B1B9F9** `\e[38;2;177;185;249m` (permission border, title, selection),
near-white **#F8F8F2** `\e[38;2;248;248;242m` (diff content), plus dim `\e[2m` and bold `\e[1m`.

**Copy one thing:** three left edges only — col 1 for who spoke, col 3 for what came back, col
7 for what changed — and let colour carry state instead of extra glyphs.

## 2. One line per call, and the collapse

OBSERVED (V2, V3). A finished call is two lines, never a block:

```
● Write(notes.txt)
  ⎿  Wrote 6 lines to notes.txt
```

The row label is not the tool name: `Write` prints as `Write(…)`, `Edit` prints as `Update(…)`,
`Bash` prints the call's own `description` as a gerund (`Print ok` → `Printing ok`). The result
is `⎿ ` plus a past-tense summary: `Wrote 6 lines to notes.txt`, `Added 2 lines, removed 1
line`, `$ echo ok`, `Rejected write to notes.txt`.

A burst of calls in one message never prints one row each. While running it is a single
present-continuous sentence with bold counts, plus the newest call's detail beneath; when the
batch ends, all of it collapses to ONE past-tense line at indent 2, failure count in pink
#FF6B80 `\e[38;2;255;107;128m`:

```
● Searching for 1 pattern, reading 2 files, running 1 shell command…
  ⎿  $ mkdir probe-dir
  Searched for 1 pattern, read 2 files, ran 1 shell command · 1 failed
```

Rule: group by assistant segment, summarise by verb and count, keep the newest detail while it
runs, drop the lot for one summary when it ends. UNKNOWN: `N calls: open the group for the
rest` (a string in the binary) never appeared on screen — this renderer uses the sentence.
`ctrl+o` opens a verbose transcript (`Showing detailed transcript · ctrl+o to toggle · ? for
shortcuts`) that expands every result body and adds hook rows, cwd notices and a right-aligned
`4:52 PM claude-mock` stamp.

**Copy one thing:** a finished group is a sentence, not a stack — that line is why a busy turn
reads calm.

## 3. The live diff body

OBSERVED (V1, V3). Counts first, then the body, both under the result gutter:

```
● Update(notes.txt)
  ⎿  Added 2 lines, removed 1 line
      1  alpha line one
      4 -delta line four
      4 +delta line FOUR changed
      5 +epsilon line new
      6  echo line five
        \ No newline at end of file
```

Wording is exact and pluralised — `Added 1 line, removed 2 lines` and `Added 2 lines, removed
1 line` both observed — additions before removals. The permission preview shows the same
numbers, one column further left, inside the prompt box.

Gutter geometry: `[6 spaces][line number][space][marker][content]`, marker `-`, `+` or a space
for context. One number column only: `-` rows carry the old file's number, `+` and context rows
the new file's, so a replaced line appears twice with the same number. Colour covers only the
four gutter cells, not the line — removed **#DC5A5A on #3D0100**
`\e[38;2;220;90;90;48;2;61;1;0m`, added **#50C850 on #022800**
`\e[38;2;80;200;80;48;2;2;40;0m`, content **#F8F8F2** `\e[38;2;248;248;242m`, context numbers
dim `\e[2m`. `\ No newline at end of file` is always present, dim, col 9.

**Copy one thing:** the four-character tint strip and counts as a sentence before the body —
the reader learns the size of the change before reading a line of it.

## 4. The permission prompt

OBSERVED (V2). A bordered box between transcript and input:

```
──────────────────────────────────────────────────────────────   #B1B9F9
 Bash command                                                    title, #B1B9F9 bold
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below   bold
 Make a directory                                                #999999 description
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌   #505050
 mkdir probe-dir                                                 the literal command
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to <dir> from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No
 Esc to cancel · Tab to amend
```

`❯` and the selected label are #B1B9F9, option numbers #999999, the salient value bold. Two
other variants, same chrome: `Create file` / `Do you want to create notes.txt?` and `Edit file`
/ `Do you want to make this edit to notes.txt?` — file variants add a consequences line and the
diff body, and offer 3 options instead of 4. Tab rewrites the selected option to `Yes, and tell
Claude what to do next` and the footer loses `· Tab to amend`: amending is a mode you enter,
not a hidden key. Refusing is grey, not red — `⎿  Rejected write to notes.txt` in #999999.

Honest failures. OBSERVED: shrink the window to 9 rows mid-prompt and the options degrade to
`❯ 1. Yes` plus `↑ 9 more lines`; at 6 rows, `↑ 12 more lines`. The true default stays visible
and the rest is a count, never silently dropped. UNKNOWN: the harsher copy in the binary
(`This terminal is too short. Make it taller to choose Yes, or choose No.`) did not appear down
to 4 rows, and the refusal to summarise an unshowable file list (`This list of files is too
long to show in full…`) could not be triggered with trivial work.

**Copy one thing:** the box names the exact action, the exact target, and what "yes" will mean
afterwards — and degrades to counts rather than hiding a choice.

## 5. The working line

OBSERVED (V1, V3). One line above the input box, assembled from fragments:

```
✶ Sketching… (20s · ↓ 160 tokens)
```

glyph #D77757, verb #EB9F7F, parenthetical #999999. The parenthetical is the sub-state, in this
order: `(running PostToolUse hook · 14s · ↓ 80 tokens)`, `(20s · ↓ 160 tokens)`. A network
retry replaces it whole: `✻ Connection refused — a firewall or proxy may be blocking it
(ECONNREFUSED) · retrying in 2s · attempt 3/10`. The glyph cycles six frames: `·` `✢` `*` `✻`
`✽` `✶` (U+00B7, U+2722, U+002A, U+273B, U+273D, U+2736). Verbs observed: Sketching, Noodling,
Fiddle-faddling, Actualizing, Ebbing — decorative and user-replaceable.

`esc to interrupt` is not on that line. It lives in the footer, which changes with state:

```
  ⏸ manual mode on · esc to interrupt
  ⏸ manual mode on · ← for agents
  ⏸ manual mode on · context ┄┄┄┄┄┄┄┄┄┄ 0%  0k/200k · 200k left
```

Footer text is #999999; the context percentage turns green #4EBA65 bold as it fills. The turn
ends with `✻ Churned for 13s · done 4:52 PM`. No money figure appears in the footer — UNKNOWN
where `/cost` prints.

**Copy one thing:** the interrupt hint never moves, and the sub-state is a parenthetical that
says how long, how much, and what it is waiting on. Leave the rest behind: the 180 spinner
verbs, `ctrl+o` as an information architecture, fixed-width truncation, the alt-screen.
