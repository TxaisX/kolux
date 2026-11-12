# Your Kolux layout file

Everything about the spike's window comes from one JSON file: how many panes, how they are
arranged, the colours, the font, which shell each pane runs, and the key bindings. Edit it,
save it, and the window changes while it is still open. Nothing needs a restart, and there is
no settings screen to find anything in.

The file is read when the window opens (`--prefs your-file.json`) and again every time it
changes on disk. A file that no longer parses leaves the last good layout running and shows
the reason in the status bar, so a broken edit cannot take the window down.

Start from an example and change what you like:

| File | What it shows |
|---|---|
| `prefs/midnight-focus.json` | 4 panes in a 2×2 grid, dark blue theme, headers and status bar, 13 pt |
| `prefs/daylight-reading.json` | 3 panes across, light paper theme, no headers, no status bar, 15 pt with wide margins |
| `prefs/pane-overrides.json` | 4 panes where pane 2 has its own shell, tint and font size and pane 4 is light-on-paper, all in the same dark window |

```powershell
cd spikes/rune-terminal
cargo run --release -- --prefs prefs/midnight-focus.json
```

## The shape of the file

Every section is optional; anything you leave out keeps its default. A key that is not in
this list is an error, not something silently ignored, because a mistyped key usually means
the setting you wanted never took effect.

```json
{
  "layout": { ... },
  "theme": { ... },
  "font": { ... },
  "shell": { ... },
  "keys": { ... },
  "layout.pane_overrides": [ ... ]
}
```

### `layout` — how many panes and where

| Key | Default | What it does |
|---|---|---|
| `panes` | `4` | How many panes to open, 1–32. Changing it opens or closes panes live. |
| `columns` | `0` | Panes across. `0` picks the closest-to-square grid (2 across past four panes). `3` means three across no matter how many panes there are. |
| `gap` | `6` | Space between panes, in pixels. |
| `outer_pad` | `8` | Space between the window edge and the grid. |
| `header` | `true` | Show each pane's title strip (pane number, program, and the pane's size in cells). |
| `status_bar` | `true` | Show the bottom bar (pane count, active pane, which file is loaded, and its errors). |
| `banner` | `true` | Write a coloured line into each new pane so a fresh window proves colour and underline work. Turn it off for real work. |
| `pane_overrides` | `[]` | Panes that do not match the rest of the grid. See below. |

### `theme` — the colours

All colours are `#rrggbb`; `#rgb` and a bare `rrggbb` also work.

| Key | Default | What it colours |
|---|---|---|
| `name` | `"kolux-dark"` | A label. It is only used in the status bar and the log. |
| `app_bg` | `#0b0d10` | Behind the panes and in the gaps. |
| `pane_bg` | `#101216` | Inside a pane, behind the text. |
| `header_bg` / `header_active_bg` | `#16191f` / `#1d2430` | A pane's title strip, unfocused and focused. |
| `border_idle` / `border_active` | `#272c36` / `#60a5fa` | A pane's frame, unfocused and focused. |
| `text` | `#f1f5f9` | Text the program did not colour itself. |
| `text_dim` | `#94a3b8` | Titles and the smaller status-bar text. |
| `cursor_bg` / `cursor_fg` | `#60a5fa` / `#101216` | The cursor block, and the character under it. |
| `cursor_unfocused` | `#64748b` | The cursor in a pane that does not have focus. |
| `ansi` | see below | Exactly 16 colours: ANSI 0–7 (normal), then 8–15 (bright), in this order: black, red, green, yellow, blue, magenta, cyan, white, then the same eight bright. Programs that use 16-colour mode draw from these. |

The default `ansi` palette:

```
#181a1f #ef5350 #81c784 #ffd54f #64b5f6 #ba68c8 #4dd0e1 #cbd5e1
#64748b #f87171 #4ade80 #facc15 #60a5fa #d8b4fe #22d3ee #f8fafc
```

### `font` — the cell size

| Key | Default | What it does |
|---|---|---|
| `size` | `13` | Text size in points, 6–48. |
| `line_height` | `18` | Height of one row in pixels. Handy to breathe a layout out without enlarging the glyphs. |
| `cell_width` | `0` | Width of one character column. `0` measures your real font, which is what you want; set a number only to force alignment. |
| `pad_x` / `pad_y` | `8` / `6` | Space between a pane's frame and its text. |

### `shell` — what the panes run

| Key | Default | What it does |
|---|---|---|
| `program` | `null` | `null` means Kolux's usual shell chain (PowerShell, then cmd, then anything that answers). A name such as `"wsl.exe"` or `"pwsh.exe"` runs that program in every pane. |
| `args` | `[]` | Arguments for `program`. |
| `env` | `{}` | Extra environment variables for the agent or shell, e.g. `{"KOLUX_PROFILE": "focus"}`. |

### `keys` — the key bindings

Chords use Rune's own syntax: `ctrl+tab`, `alt+1`, `mod+shift+p`. `mod` is Ctrl on Windows.

| Key | Default | What it does |
|---|---|---|
| `next_pane` | `"ctrl+tab"` | Focus the next pane. |
| `prev_pane` | `"ctrl+shift+tab"` | Focus the previous pane. |
| `reload` | `"ctrl+r"` | Re-read this file now instead of waiting for the watcher. |
| `quit` | `"ctrl+q"` | Close the window. |

### `pane_overrides` — one pane that is not like the others

Each entry names a pane by its **1-based number** (the number in its title strip, so `"pane": 1`
is the first pane) and changes whatever it lists for that pane only. Everything left out comes
from the sections above.

```json
"layout": {
  "panes": 2,
  "pane_overrides": [
    {
      "pane": 2,
      "theme": { "pane_bg": "#1a1030", "text": "#e9d5ff", "ansi": [ ...16 colours... ] },
      "font": { "size": 12, "line_height": 17 },
      "shell": { "program": "cmd.exe", "args": ["/k"] }
    }
  ]
}
```

| Key | What it changes for that pane |
|---|---|
| `theme.pane_bg`, `text`, `text_dim`, `border_active` | That pane's own ink and frame colour. |
| `theme.cursor_bg`, `cursor_fg`, `cursor_unfocused` | That pane's cursor. |
| `theme.ansi` | All 16 colours for that pane, in `theme.ansi` order, or none at all. |
| `font.size`, `font.line_height`, `font.cell_width` | That pane's cell size. Padding stays shared. |
| `shell` | That pane's own program, args and environment. |

Two panes cannot claim the same number, and a number past `layout.panes` is an error: both
are reported rather than ignored.

## When the file is wrong

The status bar shows the message, and the window keeps the last layout that worked. Editing
the file again fixes it with no restart.

- A shape error (a number where text belongs) says `at line N column M`, from the JSON parser.
- A rule we check ourselves names the field and the line it is on, e.g.
  `font.size must be 6..48, not 3 (line 4)`, or `theme.cursor_bg colour "#nope" is not hex (line 9)`.
- An override problem names the pane: `pane_overrides[pane=2].theme.text colour "#zz" is not hex`.

## Trying changes without a window

The spike renders itself headlessly, which is how its screenshots are made and how you can
check an edit without opening a window:

```powershell
# one PNG of your layout, 8 seconds after the shells start
cargo run --release -- --prefs prefs/midnight-focus.json --snap evidence/mine.png --realtime --at 8

# the element tree, as JSON (every element, its box, its text)
cargo run --release -- --prefs prefs/midnight-focus.json --tree evidence/mine-tree.json --at 2
```