# Kolux look: design reference for the Kolux rebuild

Source: three screenshots of the running Kolux window (user32 PrintWindow, flag 2), taken
2026-10-08, 20 s apart. Pixels only; no code, CSS or assets of the old app were read.
All hex values were sampled from the full window capture (removed 2026-10-30 at Txais's request; the measurements below stay).

## 0. How to read the numbers

- The window was **maximized** on a 1920 px wide monitor at **96 DPI (100 % scale)**.
  The raw capture is 1936 x 1048 because a maximized window's rect includes an 8 px
  off-screen frame (solid `#202020`) on every side. **All coordinates below are client
  coordinates**: subtract 8 from raw x and y. Client area = **1920 x 1032**.
- The crops (removed 2026-10-30 at Txais's request; the measurements in this file stay) were cut
  from a capture of the client area alone; the two window-corner crops came from the raw capture.
- "x 305..1105" means first and last pixel inclusive.
- Text is rendered with Windows ClearType (sub-pixel colour fringes). Text hex values are the
  colour of fully covered stems; treat them as accurate to about plus or minus 4 per channel.
- The chrome palette is almost exactly the **Tailwind v4 / shadcn "neutral" dark scale**
  (`#0a0a0a #171717 #262626 #404040 #a1a1a1 #fafafa`). That is a strong hint for tokens.

## 1. Overall layout (client coords, 1920 x 1032)

```
y 0..35     TOP BAR (35 px fill #171717 + 1 px bottom border #272727)        full width
y 36..1007  BODY on app background #050405
            x 8..296    SIDEBAR CARD, y 44..999 (8 px gutter left, top, and from content)
            x 297..1919 CONTENT COLUMN
                        y 36..75   LAYOUT STRIP, 40 px, fill #0a0a0a, runs to the right edge
                        y 76..83   8 px gap (#050405)
                        y 84..999  PANE GRID, x 305..1911 (8 px left and right margin)
            y 1000..1007  8 px gap
y 1008..1031 STATUS BAR (1 px top border #272727 + 23 px fill #171717)          full width
```

| Region | Box | Size |
|---|---|---|
| Top bar | x 0..1919, y 0..35 | 36 px tall incl. 1 px bottom border |
| Sidebar card | x 8..296, y 44..999 | 289 x 956 incl. 1 px border |
| Layout strip | x 297..1919, y 36..75 | 1623 x 40 |
| Pane grid | x 305..1911, y 84..999 | 1607 x 916 |
| One pane (2 x 2 layout) | e.g. x 305..1105, y 84..538 | 801 x 455 incl. border |
| Gap between panes | horizontal x 1106..1111, vertical y 539..544 | **6 px** |
| Status bar | x 0..1919, y 1008..1031 | 24 px tall incl. 1 px top border |

Pane positions in the 4-up layout: top-left x 305..1105 y 84..538; top-right x 1112..1911
y 84..538; bottom-left x 305..1105 y 545..999; bottom-right x 1112..1911 y 545..999.
The sidebar card bottom (y 999) lines up exactly with the pane bottoms.

Gutter rule: **8 px** between every top-level block (window edge, top bar, sidebar, layout
strip, pane grid, status bar); **6 px** between panes.

### Window corners and frame

- Frameless window with a custom title bar: no Windows caption; minimize / maximize / close
  are drawn inside the top bar.
- Maximized, so the window itself is square-cornered and flush with the screen. The corners
  of the window in its restored (not maximized) state could NOT be seen. On Windows 11 the
  OS rounds them (about 8 px) and adds its own shadow; nothing in the app suggests otherwise.
- Rounded corners appear on the floating **cards** inside the window (sidebar, panes), see 7.

## 2. Colour palette (sampled)

### Surfaces and lines

| Token (suggested) | Hex | Where |
|---|---|---|
| `--app-bg` | `#050405` | Window background behind cards and in all gutters (very slight magenta tint: R=B>G) |
| `--strip-bg` | `#0a0a0a` | Layout strip behind the "Layout" quick counts and field |
| `--pane-bg` | `#0d0d0d` | Pane header and terminal body (same colour; the terminal background) |
| `--input-bg` | `#0f0f0f` | Top-bar segmented control track, search box fill |
| `--surface` | `#171717` | Top bar, sidebar card, status bar |
| `--chip-bg` | `#1d1d1d` | Branch chip in pane header ("main") |
| `--kbd-bg` | `#1f1f1f` | Keyboard-shortcut chips in search box (border `#2c2c2c`) |
| `--line-subtle` | `#1b1b1b` | Inactive pane border; divider under every pane header |
| `--line-inner` | `#161616` | 1 px inner ring just inside every pane border (inset highlight) |
| `--line` | `#212121` | Segmented control and search box border; sidebar divider above "Next that needs you" |
| `--line-strong` | `#272727` | Top bar bottom border, status bar top border, sidebar card border, sidebar footer divider, usage pill border |
| `--line-focus` | `#2f2f2f` | **Active (focused) pane border**; layout button group border and dividers |
| `--tab-track` | `#232223` | Sidebar "Workspaces / Status" tab track (border `#2e2d2e`) |
| `--row-selected` | `#262626` | Selected sidebar row ("main") and active sidebar tab |
| `--button-border` | `#232323` | "New session" button outline |
| `--seg-active` | `#404040` | Active segment: "Terminals" in the top bar, "4" in the layout control |
| `--gauge-track` | `#1e1e1e` | Unfilled part of the context ring in pane headers |
| `--danger` | `#e5484d` | (Kolux, T-040-a) the meter bar, ring and gauge past 90%; not measured, nothing in the capture was that full; the 70% yellow is `--working-icon` |

### Text

| Token | Hex | Where |
|---|---|---|
| `--fg` | `#fafafa` | Primary: pane titles, active tab labels, selected row, terminal default text |
| `--fg-row` | `#d8d7d8` | Sidebar repo name and session rows |
| `--fg-muted` | `#a1a1a1` | Secondary: inactive tabs, search placeholder, usage pill, icons, window controls, status bar, branch chip text, "Claude" agent label |
| `--fg-nav` | `#9f9f9f` | Sidebar nav items "Tasks", "Artifacts" |
| `--fg-label` | `#868686` | Section label "Projects" |
| `--fg-faint` | `#7e7d7e` | Shortcut hint "Ctrl+J"; chevron `#797979` |
| `--fg-icon-dim` | `#565656` | Sidebar nav icons; back/forward arrows `#4a4a4a` (disabled look) |
| logo mark | `#c5c5c5` | Top-left asterisk mark |

### Status and accent colours

| Meaning | Hex | Where |
|---|---|---|
| Working (text) | `#03cce9` (cyan, about Tailwind cyan-400) | "Working" word in pane header |
| Working (icon) | `#eeb000` / `#e3a801` (amber-yellow) | Spinning arc at far left of pane header |
| Done (text) | `#01c88f` (emerald-400-ish) | "Done" word in pane header |
| Done (icon) | `#039567` | Circle-with-check at far left of pane header |
| Live session dot | `#00bb80` | 6 px dot before a sidebar session that is working |
| Idle session dot | `#3c3c3c` | 6 px dot before a sidebar session that is done/idle |
| Context gauge | `#8beeb0` ring, `#83e4a6` percentage text | "55%", "38%", "0%" in pane headers |
| Claude agent mark | `#d6775a` (coral) | Starburst before the pane title, and in the usage pill |
| Status bar "On" dot | `#fafafa` | White dot after "On" |

No blue/purple "brand accent" is used in the chrome. The active state is shown by
**lighter grey fills and borders**, not by a hue.

### Terminal colours (inside panes)

The pane body is a terminal running the Claude Code CLI; nearly all coloured text in it is
Claude Code's own truecolour output, not Kolux styling. What Kolux supplies is the terminal
theme. Observed: background `#0d0d0d` (identical to the pane), default foreground `#fafafa`.
For reference, the colours Claude Code printed: dim/secondary `#999999`, rules of its input box
`#888888`, warning/auto-mode yellow `#fdc030`, teal `#29cccc`, success green `#54b96b`,
link/permission lavender `#b2baf6`, Claude orange `#d4775a`. The 16-colour ANSI palette could
not be read (no plain ANSI output on screen).

## 3. Typography

### UI font

- A neo-grotesque sans with flat-topped `t`, double-storey `a`, single-storey `g`, tight
  spacing. **Best reading: Inter** (Geist is the other candidate). Suggested stack:
  `Inter, "Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`.
- Rendered with ClearType sub-pixel antialiasing.

| Use | Size (approx.) | Weight | Colour |
|---|---|---|---|
| Top-bar view tabs (Agents / Board / Terminals) | 13 px | 500; active 600 | muted / fg |
| Search placeholder "Search" | 12-13 px | 400 | `#a1a1a1` |
| Kbd chips (Ctrl, Shift, J) | 11 px | 500 | `#a1a1a1` |
| Usage pill text | 12 px | 400-500 | `#a1a1a1` |
| Sidebar nav (Tasks, Artifacts) | 13 px | 400-500 | `#9f9f9f` |
| Section label "Projects" | 12-13 px | 500 | `#868686` |
| Sidebar tabs (Workspaces / Status) | 12 px | 600 active, 500 inactive | fg / `#9a989a` |
| Repo name "TxaisX/session-cost-meter" | 14 px | 500 | `#d8d7d8` |
| Selected branch row "main" | 14 px | 600 | `#fafafa` |
| Session rows | 13 px | 400 | `#d8d7d8` |
| "Next that needs you" / "Ctrl+J" | 12 px | 400 | `#9b9b9b` / `#7e7d7e` |
| "New session" button | 13 px | 500-600 | `#fafafa` |
| Footer "Check for updates" | 13 px | 400 | `#a1a1a1` |
| Layout label "Layout" / numbers | 12 px / 13 px | 400 / 600 | `#a1a1a1` / `#fafafa` |
| **Pane title** ("Build remaining tasks") | **12 px** | **600** | `#fafafa` (cap height 9 px) |
| Pane agent label "Claude" | 12 px | 400 | `#a1a1a1` |
| Pane status word "Working" / "Done" | 12 px | 500 | cyan / green |
| Gauge percentage "55%" | 11 px | 500 | `#83e4a6` |
| Status bar | 11 px | 400 | `#a1a1a1` |

Sizes are inferred from cap heights (9-11 px) and average glyph advance; treat as plus or
minus 1 px.

### Terminal font

- Monospace, **cell 8 px wide x 16 px tall** (measured: a 49-character line spans exactly
  392 px; consecutive lines are 16 px apart; the cursor box is 8 px wide).
- That fits **13 px font size, line height about 1.2** (13 x 0.6 = 7.8 rounded to 8).
- Glyphs: `l` with a right-curling foot, `i` with slab, round open `g`; looks like **Cascadia
  Mono** (Windows Terminal's font). Second guess JetBrains Mono. Suggested stack:
  `"Cascadia Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace`.
- Text looks heavier than a regular weight; it may be weight 500-600 or just ClearType on a
  dark background. UNSURE; start at 400 and compare against a capture of the terminal body (removed 2026-10-30 at Txais's request; the measurements above stay).
- Terminal text inset: column 0 starts **4 px** inside the pane's inner edge (pane border at
  x 305, column 0 at x 309/310). Rows sit on a 16 px grid; leftover height goes to the bottom.
- The branch chip in the pane header uses a monospace face too (`main`), about 11 px.

## 4. Top bar (y 0..35, fill `#171717`, 1 px bottom border `#272727`)

Content is vertically centred on y 17-18. Left to right:

(Kolux, T-003b-fix-a: the bar is a three-column grid; the switcher is centred on the window
while the right group fits in its half, and gives way to the left below about 1540 px so it never
covers the search box.)

| Item | x range | Notes |
|---|---|---|
| App mark | 10..23 (14 px) | Six-spoke asterisk, `#c5c5c5` |
| Overflow menu "..." | 33..44 | Three dots, `#a1a1a1` |
| Toggle left sidebar | 67..80 (14 px) | Panel-left icon, `#919191` |
| Back / forward arrows | 105..112, 127..134 | 8 px glyphs, `#4a4a4a` (disabled look) |
| **View switcher** (centred on the window) | 855..1064, y 3..32 | 210 x 30 track `#0f0f0f`, 1 px border `#212121`, radius 8 px. Three segments: "Agents", "Board", "Terminals". Active segment `#404040` fill, x 983..1061, y 6..29 (about 79 x 24), radius 6 px, white bold text. Inactive text `#a1a1a1`. Segment text gaps about 30 px. |
| Toggle right panel | 1273..1286 | Panel-right icon, `#a1a1a1` |
| **Search box** | 1304..1493, y 4..31 | 190 x 28, fill `#0f0f0f`, 1 px border `#212121`, radius 8 px. Magnifier icon, "Search" placeholder, then kbd chips `Ctrl` + `Shift` + `J`: each chip 17 px tall (y 9..25), fill `#1f1f1f`, 1 px border `#2c2c2c`, radius 4 px, with grey "+" between chips. |
| Notifications bell | 1509..1518 | `#a1a1a1` |
| **Usage pill** | 1534..1767, y 6..28 | 234 x 23, transparent (shows `#171717`), 1 px border `#272727`, fully rounded. Contents: coral Claude starburst, "Claude 98% left", Codex (OpenAI knot) icon in grey, "Codex 100% left". 12 px `#a1a1a1`. |
| Minimize / maximize / close | glyph centres at about 1805, 1851, 1897 | 10 px line glyphs, `#a1a1a1`; buttons on a 46 px pitch (Windows caption-button width), full bar height. Hover states not observed. |

## 5. Left sidebar (card x 8..296, y 44..999)

Card: fill `#171717`, 1 px border `#272727`, radius 12 px on all four corners, no shadow.
Inner content runs from about x 13 to x 291. Top to bottom:

| Block | y range | Composition |
|---|---|---|
| Nav: "Tasks" | text 63..74 | list icon at x 26 (14 px, `#565656`), label at x 55, `#9f9f9f`, 13 px |
| Nav: "Artifacts" | 94..109 | file-code icon, same styling. Nav rows are about 32 px apart. |
| Section header "Projects" | 139..152 | Label at x 25 `#868686`. Right-aligned icon buttons `#a1a1a1`, 12-14 px glyphs at x 158, 186, 213, 243, 269 (about 28 px pitch): bell, sliders (filter), folder-plus, plus, rocket. |
| Tabs "Workspaces / Status" | 170..199 | Track x 17..287 (271 x 30), fill `#232223`, border `#2e2d2e`, radius 8 px. Active half (left, x 20..151, y 174..195) fill `#262626`, radius 6 px, text `#fafafa` 600. Inactive "Status" text `#9a989a`. The active fill is very subtle; contrast comes mostly from text weight. |
| Repo heading "TxaisX/session-cost-meter" | 218..230 | x 21, 14 px medium, `#d8d7d8`, no icon |
| Branch row "main" (selected) | 242..273 | Row x 13..291 (279 x 32), fill `#262626`, radius 6-8 px. "main" x 21, 14 px 600 white. Right side: count "4" at x 246 (white, 11 px, no badge fill) and a down chevron at x 270 (`#797979`). |
| Session rows | text 285..297, 317..327, 349..359, 381..391 | **32 px row pitch**. 6 px round dot at x 39..44 (green `#00bb80` = working, grey `#3c3c3c` = done/idle), label at x 55, 13 px `#d8d7d8`. Labels: "Build remaining tasks", "Inter-session communication mod", "✳ Claude Code", "Session context and cost mod". No row fill when not selected. |
| (empty space) | to 876 | |
| Divider | 877 | 1 px `#212121`, x 13..291 |
| "Next that needs you" ........ "Ctrl+J" | 895..905 | left label x 25 `#9b9b9b` 12 px; right hint ending x 279 `#7e7d7e` 12 px |
| "+ New session" button | 920..953 | x 17..287 (271 x 34), no fill, 1 px border `#232323`, radius 8 px. Plus icon + "New session" centred, white 13 px medium. |
| Divider | 962 | 1 px `#272727`, full card width |
| Footer icon row | 974..987 | gear (x 23), help-circle (x 50), refresh icon + "Check for updates" (x 91..214), a circle/target icon (x 241), and a pause-like glyph (x 271). All `#a1a1a1`, 12-14 px. |

> Amendment 2026-10-12 (T-116-a-fix): the sidebar's add-project form (the Projects header button) no longer holds the branch prefix or the default compare base; one link in it opens Settings > Git & worktrees, where both now live.

## 6. Layout strip (x 297..1919, y 36..75, fill `#0a0a0a`)

- "Layout" label at x 309, 12 px `#a1a1a1`, vertically centred (y 51..61).
- Button group x 363..491, y 42..69 (129 x 28), 1 px border `#2f2f2f`, radius 6 px, 1 px
  `#2f2f2f` dividers between buttons. Quick counts 1, 2, 4, 6, 9 and 12 (the current one pressed,
  fill `#404040`), then a free number field for any count up to 24. Numbers 13 px 600 white.
- The right end carries the workspace spend ribbon: "Workspace", the total tokens and estimated
  cost of the workspace in front across all its sessions, today's tokens and cost, and a 14-bar
  gauge of the last 14 days. Hover it for the seven-day figure, the provider split and the count
  time. As the strip narrows (a right sidebar or a small window) the today figure drops first,
  then the gauge, then the label.
  (Kolux, owner change 2026-11-06: the strip's New tab and Preview buttons are gone; panes are
  added with a split, a pane's plus, the sidebar's New session or a tab shortcut. Their space now
  carries this ribbon.)

## 7. Panes

### Shell of a pane

- Fill `#0d0d0d`. 1 px border: **`#2f2f2f` on the focused pane, `#1b1b1b` on all others**.
  Just inside the border a 1 px ring `#161616` (reads like `inset 0 0 0 1px rgba(255,255,255,.03)`).
- Corner radius about **12 px** (the curve runs 13 px along each edge, same as the sidebar card).
- No drop shadow, no blur, no gradient (gutter pixels are a flat `#050405` right up to the border).
- Active vs inactive differs **only** in that border colour. Header text, icons and body
  are identical (titles sample `#fafafa` on both).

### Pane header (inner y 86..111 = 26 px, then 1 px divider `#1b1b1b` at y 112)

Same background as the body (`#0d0d0d`); separated only by the 1 px divider. All items are
vertically centred on y 98. Left group, left to right (top-left pane, x values):

| Item | x | Notes |
|---|---|---|
| Status icon | 314..324 (10 px) | Working: amber `#eeb000` spinning arc (animated; it changed between captures). Done: green `#039567` circle with a check. |
| Agent mark | 330..342 (13 px) | Claude coral starburst `#d6775a` |
| Title | from 349 | 12 px 600 `#fafafa`, e.g. "Build remaining tasks" |
| Branch chip | 479..517, y 91..105 | 15 px tall pill, fill `#1d1d1d`, fully rounded, monospace 11 px `#a1a1a1` "main", about 6 px side padding |
| Agent name | 524..562 | "Claude", 12 px `#a1a1a1` |
| Status word | 569..614 | "Working" `#03cce9` or "Done" `#01c88f`, 12 px 500 |

Gaps between left-group items: about 6 px.

Right group (top-left pane), right-aligned, icons on a **26-27 px pitch**:

| Item | x | Notes |
|---|---|---|
| Context gauge | 944..958 ring + 962..984 text | 13-14 px ring, 2 px stroke, track `#1e1e1e`, arc `#8beeb0`; then "55%" `#83e4a6` 11 px |
| More "..." | 1002..1011 | `#a1a1a1` |
| Expand / maximize pane | 1028..1037 | diagonal two-way arrow |
| Add / split "+" | 1055..1062 | |
| Split right (Kolux addition) | between Expand and "+" | two-column glyph, 24 px hit target; splits the pane with a shell in the same folder (Ctrl+Shift+D); not in the captures, added by T-003b |
| Close "x" | 1081..1088 | about 15 px from the pane's inner right edge |

Icons are 8-10 px glyphs, `#a1a1a1` (they antialias to about `#383838` at the edges);
probably 24 px square hit targets. The fourth pane's title starts with "✳ " (part of its name).

### Pane body (terminal)

- Starts right under the header divider (y 113) and fills the pane to its inner bottom edge.
- Terminal background `#0d0d0d`, foreground `#fafafa`, 8 x 16 px cells, 4 px left inset.
- Visible cursor in the focused pane: hollow 8 x 16 px box (`#fafafa` outline). That glyph
  may be drawn by Claude Code rather than the terminal; UNSURE.
- Everything else in the body (bullets, `❯` prompt, input-box rules, "auto mode on", token
  counters, the Claude Code mascot) is Claude Code's own output, not app chrome.

## 8. Status bar (y 1008..1031)

1 px top border `#272727`, fill `#171717`, 23 px tall. Left side empty. Right-aligned,
11 px `#a1a1a1`, items centred on y 1020, ending 16 px from the right edge:

| Item | x | Content |
|---|---|---|
| Hook/connection | 1691..1730 | cup/plug-like icon, "On", white dot `#fafafa` |
| Memory | 1751..1819 | chip/RAM icon, "717.9 MB" |
| Separator | 1826 | middle dot |
| Terminals | 1835..1858 | `>_` icon, "4" |
| Power/agents | 1881..1903 | plug icon, "0" |

Item gaps about 20 px; icon-to-text gap about 6 px.

## 9. Spacing rhythm and radii

- Base unit **4 px**; the big gutters are **8 px**, the pane gap is **6 px**.
- Sidebar rows on a **32 px** pitch; nav rows about 31-32 px; the top bar is 36 px; pane header
  26 px + 1 px divider; layout strip 40 px; status bar 24 px.
- Radii: cards (sidebar, panes) **12 px**; segmented tracks, search box, buttons **8 px**;
  active segments and selected row **6 px**; layout group **6 px**; kbd chips **4 px**;
  usage pill and branch chip **fully rounded**.
- Borders are always 1 px, solid, grey; there is no shadow, blur, transparency effect or
  gradient anywhere in the chrome.

## 10. Live vs static (from the three captures)

Between captures only these changed: the top-left pane's body text, the pane-header
spinner (animated), and the bottom-left pane's input/footer lines. All chrome (top bar,
sidebar, layout strip, borders, status bar) was pixel-identical.

## 11. Branding: what belongs to Txais vs third parties

| Element | Whose |
|---|---|
| App name "Kolux" | Only in the OS window title (not drawn anywhere in the UI) |
| Top-left six-spoke asterisk mark | The app's own mark as shown (no "K" logo is visible anywhere) |
| Coral starburst (pane headers, usage pill) | Anthropic's Claude mark, used as the agent icon |
| Knot icon in usage pill | OpenAI Codex mark |
| Repo "TxaisX/session-cost-meter", session names | Txais's data, not chrome |
| Everything else (layout, palette, icons) | Generic: neutral dark theme, line icons in the Lucide style |

## 12. Not determinable from these pixels

- Hover, pressed, focus-ring and disabled states (nothing was hovered).
- The Agents and Board views, menus, dialogs, tooltips, and the right panel.
- Restored-window corner radius and shadow (window was maximized).
- Exact font families (best readings given), exact weights, letter-spacing.
- The terminal's 16-colour ANSI palette and selection colour.
- Whether the 1 px inner pane ring is an inset shadow or a second border.
- Light theme (if any).
- Animation timing of the spinner.

## 13. Reference files

The 36 screenshot crops of the old app that this file was measured from (removed 2026-10-30 at Txais's request; the measurements above stay).
