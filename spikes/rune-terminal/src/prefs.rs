//! One user-editable preferences file drives the whole spike: layout and pane arrangement, theme,
//! ANSI palette, cell size, shell and key bindings (requirement f: "a Kolux people can make their
//! own"). The file is re-read while the app runs, so a user edits it and watches the window change
//! without a restart.
//!
//! Design rules kept from the rest of Kolux: a typo must be loud, not silent (unknown keys are an
//! error), and a broken file must never take the window down (the last good preferences stay live
//! and the error is shown in the status bar).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rune::Chord;
use serde::Deserialize;

use crate::vt::{rgb, Palette};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Prefs {
    pub layout: Layout,
    pub theme: Theme,
    pub font: Font,
    pub shell: Shell,
    pub keys: Keys,
}

/// How the panes are arranged.
#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Layout {
    /// Number of panes to open.
    pub panes: usize,
    /// Fixed column count. `0` picks the closest-to-square grid for `panes`.
    pub columns: usize,
    pub gap: f32,
    pub outer_pad: f32,
    /// Show each pane's title strip.
    pub header: bool,
    /// Show the bottom status bar.
    pub status_bar: bool,
    /// Draw the demo banner (a coloured line of text) into every pane.
    pub banner: bool,
    /// Panes that get their own shell, theme or font size instead of the grid's.
    pub pane_overrides: Vec<PaneOverride>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            panes: 4,
            columns: 0,
            gap: 6.0,
            outer_pad: 8.0,
            header: true,
            status_bar: true,
            banner: true,
            pane_overrides: Vec::new(),
        }
    }
}

/// One pane that does not match the rest of the grid. `pane` is 1-based, the same number the
/// pane's title strip shows, so a user can point at what they see.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PaneOverride {
    pub pane: usize,
    pub theme: ThemeOverride,
    pub font: FontOverride,
    /// This pane's own program; unset means the grid's `shell`.
    pub shell: Option<Shell>,
}

/// The theme fields one pane may change. Everything left out keeps the grid's value.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ThemeOverride {
    pub pane_bg: Option<String>,
    pub text: Option<String>,
    pub text_dim: Option<String>,
    pub border_active: Option<String>,
    pub cursor_bg: Option<String>,
    pub cursor_fg: Option<String>,
    pub cursor_unfocused: Option<String>,
    /// All 16, in `theme.ansi` order, or none at all.
    pub ansi: Option<Vec<String>>,
}

/// The cell metrics one pane may change. Padding stays global: it is a frame measurement, not ink.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FontOverride {
    pub size: Option<f32>,
    pub line_height: Option<f32>,
    pub cell_width: Option<f32>,
}

impl Layout {
    /// Columns first, rows second. A fixed `columns` wins; otherwise the layout stays at two
    /// columns past four panes, because four columns of an 80-column pane overflow a 1440 px
    /// window and the right-hand panes fall off the edge.
    pub fn grid(&self, count: usize) -> (usize, usize) {
        let count = count.max(1);
        let cols = if self.columns > 0 { self.columns.min(count) } else if count <= 2 { count } else { 2 };
        (cols, count.div_ceil(cols.max(1)))
    }
}

/// Colours, as `#rrggbb` strings so a user can type them.
#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Theme {
    pub name: String,
    pub app_bg: String,
    pub pane_bg: String,
    pub header_bg: String,
    pub header_active_bg: String,
    pub border_idle: String,
    pub border_active: String,
    pub text: String,
    pub text_dim: String,
    pub cursor_bg: String,
    pub cursor_fg: String,
    pub cursor_unfocused: String,
    /// ANSI 0-15, in order: normal black, red, green, yellow, blue, magenta, cyan, white, then
    /// the bright eight.
    pub ansi: Vec<String>,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            name: "kolux-dark".into(),
            app_bg: "#0b0d10".into(),
            pane_bg: "#101216".into(),
            header_bg: "#16191f".into(),
            header_active_bg: "#1d2430".into(),
            border_idle: "#272c36".into(),
            border_active: "#60a5fa".into(),
            text: "#f1f5f9".into(),
            text_dim: "#94a3b8".into(),
            cursor_bg: "#60a5fa".into(),
            cursor_fg: "#101216".into(),
            cursor_unfocused: "#64748b".into(),
            ansi: DEFAULT_ANSI.iter().map(|c| hex_of(*c)).collect(),
        }
    }
}

const DEFAULT_ANSI: [(u8, u8, u8); 16] = [
    (24, 26, 31),
    (239, 83, 80),
    (129, 199, 132),
    (255, 213, 79),
    (100, 181, 246),
    (186, 104, 200),
    (77, 208, 225),
    (203, 213, 225),
    (100, 116, 139),
    (248, 113, 113),
    (74, 222, 128),
    (250, 204, 21),
    (96, 165, 250),
    (216, 180, 254),
    (34, 211, 238),
    (248, 250, 252),
];

fn hex_of(c: (u8, u8, u8)) -> String {
    format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2)
}

/// Cell metrics.
#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Font {
    pub size: f32,
    pub line_height: f32,
    /// `0` measures the real font (recommended); set it only to force a width.
    pub cell_width: f32,
    pub pad_x: f32,
    pub pad_y: f32,
}

impl Default for Font {
    fn default() -> Self {
        Self { size: 13.0, line_height: 18.0, cell_width: 0.0, pad_x: 8.0, pad_y: 6.0 }
    }
}

/// Which program each pane runs.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Shell {
    /// Empty: Kolux's usual shell chain (`shell_commands`). Otherwise this program only.
    pub program: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

/// Key bindings, parsed with Rune's own chord syntax (`ctrl+tab`, `alt+1`, `mod+shift+p`).
#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Keys {
    pub next_pane: String,
    pub prev_pane: String,
    /// Re-read the preferences file now, without waiting for the watcher.
    pub reload: String,
    /// Quit the spike (there is no window chrome to close it with in a headless run).
    pub quit: String,
}

impl Default for Keys {
    fn default() -> Self {
        Self {
            next_pane: "ctrl+tab".into(),
            prev_pane: "ctrl+shift+tab".into(),
            reload: "ctrl+r".into(),
            quit: "ctrl+q".into(),
        }
    }
}

/// Preferences with every string parsed into what the app draws with.
#[derive(Clone, Debug)]
pub struct Resolved {
    pub raw: Prefs,
    pub colors: Colors,
    pub keys: Bindings,
    /// One per pane, index 0 = pane 1, after that pane's override (if any) is applied.
    pub looks: Vec<Look>,
}

/// What one pane draws with: its ink, its ANSI palette and its cell metrics.
#[derive(Clone, Debug)]
pub struct Look {
    pub palette: Palette,
    pub text: rune::Color,
    pub text_dim: rune::Color,
    pub border_active: rune::Color,
    pub font: Font,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Colors {
    pub app_bg: rune::Color,
    pub pane_bg: rune::Color,
    pub header_bg: rune::Color,
    pub header_active_bg: rune::Color,
    pub border_idle: rune::Color,
    pub border_active: rune::Color,
    pub text: rune::Color,
    pub text_dim: rune::Color,
}

#[derive(Clone, Debug)]
pub struct Bindings {
    pub next_pane: Chord,
    pub prev_pane: Chord,
    pub reload: Chord,
    pub quit: Chord,
}

impl Default for Bindings {
    fn default() -> Self {
        let keys = Keys::default();
        Self {
            next_pane: Chord::parse(&keys.next_pane).expect("default chord"),
            prev_pane: Chord::parse(&keys.prev_pane).expect("default chord"),
            reload: Chord::parse(&keys.reload).expect("default chord"),
            quit: Chord::parse(&keys.quit).expect("default chord"),
        }
    }
}

/// Parses `#rrggbb` (or `#rgb`). Unknown or short strings are an error, not a silent default: a
/// mistyped colour is exactly the kind of thing a user needs told.
pub fn parse_hex(s: &str) -> Result<rune::Color, String> {
    let [r, g, b] = parse_hex_bytes(s)?;
    Ok(rgb(r, g, b))
}

fn parse_hex_bytes(s: &str) -> Result<[u8; 3], String> {
    let t = s.trim().trim_start_matches('#');
    let full = match t.len() {
        3 => t.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 => t.to_string(),
        n => return Err(format!("colour {s:?} must be #rrggbb, not {n} digits")),
    };
    let byte = |r: std::ops::Range<usize>| u8::from_str_radix(&full[r], 16).map_err(|_| format!("colour {s:?} is not hex"));
    Ok([byte(0..2)?, byte(2..4)?, byte(4..6)?])
}

impl Prefs {
    /// Which program pane `index` (0-based) runs: its own override, else the grid's shell.
    pub fn shell_for(&self, index: usize) -> &Shell {
        self.layout
            .pane_overrides
            .iter()
            .find(|o| o.pane == index + 1)
            .and_then(|o| o.shell.as_ref())
            .unwrap_or(&self.shell)
    }

    /// Parses the file's contents. Errors name the field and the reason, and — when the field is
    /// in the file rather than missing — the line it sits on.
    pub fn from_json(text: &str) -> Result<Self, String> {
        let p: Prefs = serde_json::from_str(text).map_err(|e| format!("prefs: {e}"))?;
        p.validate().map_err(|e| at_line(text, e))?;
        Ok(p)
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("prefs {}: {e}", path.display()))?;
        Self::from_json(&text)
    }

    fn validate(&self) -> Result<(), String> {
        if self.layout.panes == 0 || self.layout.panes > 32 {
            return Err(format!("layout.panes must be 1..32, not {}", self.layout.panes));
        }
        if self.font.size < 6.0 || self.font.size > 48.0 {
            return Err(format!("font.size must be 6..48, not {}", self.font.size));
        }
        for (i, o) in self.layout.pane_overrides.iter().enumerate() {
            if o.pane == 0 || o.pane > self.layout.panes {
                return Err(format!(
                    "pane_overrides[{i}].pane must be 1..{} (1-based), not {}",
                    self.layout.panes, o.pane
                ));
            }
            if self.layout.pane_overrides.iter().take(i).any(|seen| seen.pane == o.pane) {
                return Err(format!("pane_overrides[{i}].pane = {} is listed twice", o.pane));
            }
        }
        self.resolve().map(|_| ())
    }

    /// Turns the strings into colours, a terminal palette, key bindings and one look per pane.
    pub fn resolve(&self) -> Result<Resolved, String> {
        let t = &self.theme;
        let hex = |field: &str, s: &str| parse_hex(s).map_err(|e| format!("theme.{field} {e}"));
        let colors = Colors {
            app_bg: hex("app_bg", &t.app_bg)?,
            pane_bg: hex("pane_bg", &t.pane_bg)?,
            header_bg: hex("header_bg", &t.header_bg)?,
            header_active_bg: hex("header_active_bg", &t.header_active_bg)?,
            border_idle: hex("border_idle", &t.border_idle)?,
            border_active: hex("border_active", &t.border_active)?,
            text: hex("text", &t.text)?,
            text_dim: hex("text_dim", &t.text_dim)?,
        };
        if t.ansi.len() != 16 {
            return Err(format!("theme.ansi needs exactly 16 colours, has {}", t.ansi.len()));
        }
        let mut ansi = [[0u8; 3]; 16];
        for (i, s) in t.ansi.iter().enumerate() {
            ansi[i] = parse_hex_bytes(s)?;
        }
        let palette = Palette {
            bg: colors.pane_bg,
            fg: colors.text,
            cursor_bg: hex("cursor_bg", &t.cursor_bg)?,
            cursor_fg: hex("cursor_fg", &t.cursor_fg)?,
            cursor_unfocused: hex("cursor_unfocused", &t.cursor_unfocused)?,
            ansi,
        };
        let chord = |what: &str, s: &str| Chord::parse(s).map_err(|e| format!("keys.{what} {s:?}: {e}"));
        let keys = Bindings {
            next_pane: chord("next_pane", &self.keys.next_pane)?,
            prev_pane: chord("prev_pane", &self.keys.prev_pane)?,
            reload: chord("reload", &self.keys.reload)?,
            quit: chord("quit", &self.keys.quit)?,
        };
        let looks = (0..self.layout.panes)
            .map(|i| self.look_for(i, &palette, &colors))
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Resolved { raw: self.clone(), colors, keys, looks })
    }

    /// Pane `index` (0-based) with its override, if any, laid over the grid's look.
    fn look_for(&self, index: usize, base: &Palette, colors: &Colors) -> Result<Look, String> {
        let mut font = self.font.clone();
        let mut look = Look {
            palette: *base,
            text: colors.text,
            text_dim: colors.text_dim,
            border_active: colors.border_active,
            font: font.clone(),
        };
        let Some(o) = self.layout.pane_overrides.iter().find(|o| o.pane == index + 1) else {
            return Ok(look);
        };
        let at = format!("pane_overrides[pane={}].theme", o.pane);
        let hex = |field: &str, s: &str| parse_hex(s).map_err(|e| format!("{at}.{field} {e}"));
        let t = &o.theme;
        if let Some(s) = &t.text {
            look.text = hex("text", s)?;
            look.palette.fg = look.text;
        }
        if let Some(s) = &t.text_dim {
            look.text_dim = hex("text_dim", s)?;
        }
        if let Some(s) = &t.border_active {
            look.border_active = hex("border_active", s)?;
        }
        if let Some(s) = &t.pane_bg {
            look.palette.bg = hex("pane_bg", s)?;
        }
        if let Some(s) = &t.cursor_bg {
            look.palette.cursor_bg = hex("cursor_bg", s)?;
        }
        if let Some(s) = &t.cursor_fg {
            look.palette.cursor_fg = hex("cursor_fg", s)?;
        }
        if let Some(s) = &t.cursor_unfocused {
            look.palette.cursor_unfocused = hex("cursor_unfocused", s)?;
        }
        if let Some(list) = &t.ansi {
            if list.len() != 16 {
                return Err(format!("{at}.ansi needs exactly 16 colours, has {}", list.len()));
            }
            for (i, s) in list.iter().enumerate() {
                look.palette.ansi[i] = parse_hex_bytes(s).map_err(|e| format!("{at}.ansi[{i}] {e}"))?;
            }
        }
        font.size = o.font.size.unwrap_or(font.size);
        font.line_height = o.font.line_height.unwrap_or(font.line_height);
        font.cell_width = o.font.cell_width.unwrap_or(font.cell_width);
        if font.size < 6.0 || font.size > 48.0 {
            return Err(format!("pane_overrides[pane={}].font.size must be 6..48, not {}", o.pane, font.size));
        }
        look.font = font;
        Ok(look)
    }
}

/// Adds the line a field sits on to a validation error, so a user can go straight to it.
/// `serde_json` already reports line and column for shape errors; this covers the rules we check
/// after parsing. Something we cannot place (a missing file, an override rule) is returned as-is.
fn at_line(text: &str, err: String) -> String {
    if err.contains("at line ") {
        return err;
    }
    let Some(field) = err.split_whitespace().next() else { return err };
    let leaf = field.rsplit('.').next().unwrap_or(field);
    let leaf = leaf.split('[').next().unwrap_or(leaf);
    let needle = format!("\"{leaf}\"");
    let Some(pos) = text.find(&needle) else { return err };
    let line = text[..pos].matches('\n').count() + 1;
    format!("{err} (line {line})")
}

/// Watches the preferences file's modification time. `stamp` is taken at load time, so an edit
/// made while the app is running is noticed on the next tick.
pub struct Watcher {
    pub path: Option<PathBuf>,
    stamp: Option<SystemTime>,
    last_check: Option<std::time::Instant>,
}

impl Watcher {
    pub fn new(path: Option<PathBuf>) -> Self {
        let stamp = path.as_deref().and_then(stamp_of);
        Self { path, stamp, last_check: None }
    }

    /// `true` at most twice a second, when the file's timestamp moved.
    pub fn changed(&mut self, now: std::time::Instant) -> bool {
        if self.last_check.is_some_and(|t| now.duration_since(t).as_millis() < 500) {
            return false;
        }
        self.last_check = Some(now);
        let Some(path) = self.path.clone() else { return false };
        let stamp = stamp_of(&path);
        if stamp.is_some() && stamp != self.stamp {
            self.stamp = stamp;
            true
        } else {
            false
        }
    }
}

fn stamp_of(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_file_keeps_the_defaults_and_denies_typos() {
        let p = Prefs::from_json(r#"{"layout":{"panes":3}}"#).unwrap();
        assert_eq!(p.layout.panes, 3);
        assert_eq!(p.layout.gap, Layout::default().gap, "unset fields keep their default");
        let err = Prefs::from_json(r#"{"layout":{"panes":3,"gapx":1}}"#).unwrap_err();
        assert!(err.contains("gapx"), "a typo is named, not ignored: {err}");
    }

    #[test]
    fn colours_parse_or_say_why() {
        assert!(parse_hex("#1e90ff").is_ok());
        assert!(parse_hex("1e90ff").is_ok(), "the hash is optional");
        assert!(parse_hex("#abc").is_ok(), "short form");
        assert!(parse_hex("#12345").unwrap_err().contains("must be #rrggbb"));
        assert!(parse_hex("#zzzzzz").unwrap_err().contains("not hex"));
    }

    #[test]
    fn a_bad_colour_or_chord_fails_the_load_by_name() {
        let mut p = Prefs::default();
        p.theme.cursor_bg = "#nope".into();
        assert!(p.resolve().unwrap_err().contains("colour"));
        let mut p = Prefs::default();
        p.keys.next_pane = "ctrl+nosuchkey".into();
        assert!(p.resolve().unwrap_err().contains("keys.next_pane"));

        let mut p = Prefs::default();
        p.theme.ansi.truncate(3);
        assert!(p.resolve().unwrap_err().contains("16 colours"));
    }

    #[test]
    fn grid_stays_two_wide_past_four_panes_unless_the_user_says_otherwise() {
        let auto = Layout::default();
        assert_eq!(auto.grid(1), (1, 1));
        assert_eq!(auto.grid(4), (2, 2));
        assert_eq!(auto.grid(8), (2, 4));
        let three_across = Layout { columns: 3, ..Layout::default() };
        assert_eq!(three_across.grid(3), (3, 1), "one row of three");
        assert_eq!(three_across.grid(8), (3, 3), "three across, three rows");
        let one_across = Layout { columns: 1, ..Layout::default() };
        assert_eq!(one_across.grid(4), (1, 4), "a single column");
    }

    #[test]
    fn key_bindings_come_from_the_file() {
        let p = Prefs::from_json(r#"{"keys":{"next_pane":"alt+n","quit":"ctrl+shift+q"}}"#).unwrap();
        let r = p.resolve().unwrap();
        assert_eq!(r.keys.next_pane.to_string(), "alt+n");
        assert_eq!(r.keys.quit.to_string(), "ctrl+shift+q");
        assert_eq!(r.keys.prev_pane.to_string(), "ctrl+shift+tab", "unset bindings keep the default");
    }

    const SIXTEEN: &str = r##"["#000000","#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888","#999999","#aaaaaa","#bbbbbb","#cccccc","#dddddd","#eeeeee","#ffffff"]"##;

    #[test]
    fn a_pane_override_changes_only_that_pane() {
        let text = format!(
            r##"{{
              "layout": {{ "panes": 3, "pane_overrides": [
                {{ "pane": 2, "theme": {{ "pane_bg": "#101020", "text": "#e0d0ff", "ansi": {SIXTEEN} }},
                   "font": {{ "size": 16, "line_height": 22 }},
                   "shell": {{ "program": "cmd.exe", "args": ["/k", "echo hi"] }} }}
              ] }}
            }}"##
        );
        let p = Prefs::from_json(&text).unwrap();
        let r = p.resolve().unwrap();
        assert_eq!(r.looks.len(), 3, "one look per pane");
        assert_eq!(r.looks[1].font.size, 16.0, "pane 2's own font size");
        assert_eq!(r.looks[1].font.line_height, 22.0);
        assert_eq!(r.looks[0].font.size, Font::default().size, "the other panes keep the grid's");
        assert_eq!(r.looks[2].font.size, Font::default().size);
        assert_ne!(r.looks[1].palette.bg, r.looks[0].palette.bg, "pane 2's own background");
        assert_eq!(r.looks[1].palette.ansi[15], [255, 255, 255], "pane 2's own ANSI palette");
        assert_ne!(r.looks[0].palette.ansi[15], [255, 255, 255], "pane 1 keeps the theme's");
        let shell = p.layout.pane_overrides[0].shell.as_ref().unwrap();
        assert_eq!(shell.program.as_deref(), Some("cmd.exe"));
        assert_eq!(shell.args, vec!["/k", "echo hi"]);
    }

    #[test]
    fn an_override_that_points_nowhere_is_named() {
        let past_the_end = Prefs::from_json(r#"{"layout":{"panes":2,"pane_overrides":[{"pane":5}]}}"#).unwrap_err();
        assert!(past_the_end.contains("pane_overrides[0].pane must be 1..2"), "{past_the_end}");
        let zero = Prefs::from_json(r#"{"layout":{"panes":2,"pane_overrides":[{"pane":0}]}}"#).unwrap_err();
        assert!(zero.contains("1-based"), "{zero}");
        let twice = Prefs::from_json(
            r#"{"layout":{"panes":2,"pane_overrides":[{"pane":1},{"pane":1}]}}"#,
        )
        .unwrap_err();
        assert!(twice.contains("listed twice"), "{twice}");
        let bad_colour = Prefs::from_json(
            r##"{"layout":{"panes":1,"pane_overrides":[{"pane":1,"theme":{"text":"#zz"}}]}}"##,
        )
        .unwrap_err();
        assert!(bad_colour.contains("pane_overrides[pane=1].theme.text"), "{bad_colour}");
        let short_ansi = Prefs::from_json(
            r##"{"layout":{"panes":1,"pane_overrides":[{"pane":1,"theme":{"ansi":["#000"]}}]}}"##,
        )
        .unwrap_err();
        assert!(short_ansi.contains("needs exactly 16"), "{short_ansi}");
    }

    #[test]
    fn a_typo_in_the_file_says_which_line_it_is_on() {
        let text = "{\n  \"font\": {\n    \"size\": 3\n  }\n}";
        let err = Prefs::from_json(text).unwrap_err();
        assert!(err.contains("font.size must be 6..48"), "{err}");
        assert!(err.contains("(line 3)"), "the line is named too: {err}");

        let colour = "{\n  \"theme\": {\n    \"cursor_bg\": \"#nope\"\n  }\n}";
        let err = Prefs::from_json(colour).unwrap_err();
        assert!(err.contains("theme.cursor_bg"), "{err}");
        assert!(err.contains("(line 3)"), "{err}");

        // serde's own shape errors already carry a line and column.
        let shape = Prefs::from_json("{\n  \"layout\": {\n    \"panes\": \"three\"\n  }\n}").unwrap_err();
        assert!(shape.contains("at line 3"), "{shape}");
        assert!(!shape.contains("(line 3)"), "not double-labelled: {shape}");
    }

    #[test]
    fn the_watcher_notices_a_rewrite_and_only_once() {
        let dir = std::env::temp_dir().join(format!("rune-prefs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prefs.json");
        std::fs::write(&file, r#"{"layout":{"panes":1}}"#).unwrap();
        let mut w = Watcher::new(Some(file.clone()));
        assert!(!w.changed(std::time::Instant::now()), "an untouched file is quiet");

        // Windows timestamps move in 100 ns steps but the directory entry can lag a millisecond.
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(&file, r#"{"layout":{"panes":2}}"#).unwrap();
        let later = std::time::Instant::now() + std::time::Duration::from_secs(1);
        assert!(w.changed(later), "a rewrite is seen");
        assert!(!w.changed(later + std::time::Duration::from_secs(1)), "and reported once");
        std::fs::remove_dir_all(&dir).ok();
    }
}
