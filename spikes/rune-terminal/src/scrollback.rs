//! The scrollback probe: Rune's `.virtualize` + `.growth` on a terminal-sized history
//! (`--scrollback N`), streaming new rows the way a terminal's own output arrives.
//!
//! This is the last capability question in the Rune comparison, and it is deliberately separate
//! from the pty panes: a terminal's scrollback is a 10,000-row list whose tail moves every frame,
//! which is the shape xterm.js answers with its own buffer and Rune has to answer with a virtual
//! list. Rows are prebuilt `GridRow`s (what the pty panes draw), so the number this scene produces
//! is the cost of the list, not the cost of shaping text again.
//!
//! Every preference that decides how it looks (font, cell metrics, palette, ink) comes from the
//! same `prefs` file as the grid, through the same `PaneLook`.

use std::rc::Rc;

use rune::tok::type_;
use rune::{col, grid, row, text, Color, El, GridRow, GrowthSpec, ScrollSpec, Span, TextStyle};

use crate::vt::rgb;
use crate::{AppState, PaneLook};

/// Rows a stream run may add on top of the starting history, so a long run stays a window onto a
/// realistic buffer rather than an unbounded leak.
const STREAM_CAP: usize = 20_000;

/// The shapes a synthetic log line cycles through: a dim stamp, a body, a coloured tail.
const SHAPES: usize = 24;

pub struct Scrollback {
    rows: Vec<Rc<GridRow>>,
    cols: u16,
    cell_w: f32,
    cell_h: f32,
    style: TextStyle,
    ink: Color,
    dim: Color,
    bg: Color,
    stream: bool,
    added: usize,
}

impl Scrollback {
    pub fn new(n: usize, look: &PaneLook, stream: bool) -> Self {
        let cols = 96u16;
        // Real history: N distinct rows, because a real 10,000-line scrollback holds 10,000
        // different lines, and its memory is part of what this probe is measuring.
        let rows = (0..n)
            .map(|i| Rc::new(line(i, cols, look.style, look.text, look.text_dim)))
            .collect();
        Self {
            rows,
            cols,
            cell_w: look.cell_w,
            cell_h: look.cell_h,
            style: look.style,
            ink: look.text,
            dim: look.text_dim,
            bg: look.palette.bg,
            stream,
            added: 0,
        }
    }

    pub fn count(&self) -> usize {
        self.rows.len()
    }

    /// One frame of terminal output: a fresh row on the tail, which is what keeps a scrollback
    /// viewport pinned to the bottom working every frame.
    pub fn tick(&mut self) -> bool {
        if !self.stream || self.added >= STREAM_CAP {
            return false;
        }
        let n = self.added + SHAPES;
        self.rows.push(Rc::new(line(n, self.cols, self.style, self.ink, self.dim)));
        self.added += 1;
        true
    }

    pub fn view(&self, s: &AppState) -> El {
        let c = s.prefs.colors;
        let row_h = self.cell_h.max(8.0);
        let cols = self.cols;
        let cell_w = self.cell_w;
        let cell_h = self.cell_h;
        let bg = self.bg;

        let list = col()
            .key("hist")
            .growth(GrowthSpec::default())
            .virtual_rows(
                self.rows.len(),
                row_h,
                |_s: &AppState, i| format!("h{i}").into(),
                move |s: &AppState, i| {
                    let h = s.hist.as_ref().expect("the build closure runs under this scene");
                    let r = Rc::clone(&h.rows[i]);
                    grid(cols, cell_w, cell_h, vec![r])
                        .key(format!("hg-{i}"))
                        .w(cols as f32 * cell_w)
                        .h(cell_h)
                },
            );

        let viewport = col()
            .key("hist-vp")
            .w_full()
            .min_w(0.0)
            .grow(1.0)
            .min_h(0.0)
            .scroll(ScrollSpec { stick_bottom: true })
            .padding(6.0)
            .fill(bg)
            .child(list);

        let header = row()
            .key("hist-hdr")
            .w_full()
            .h(24.0)
            .px(8.0)
            .align(rune::Align::Center)
            .gap(8.0)
            .fill(c.header_bg)
            .child(text("Scrollback probe").font(type_::LABEL).color(c.text))
            .child(
                text(format!("{} rows · {} cols · {:.1} pt", self.rows.len(), self.cols, self.style.size))
                    .font(type_::MONO_CAPTION)
                    .color(c.text_dim),
            )
            .child(rune::spacer())
            .child(
                text(if self.stream { "streaming" } else { "static" })
                    .font(type_::LABEL)
                    .color(if self.stream { rgb(74, 222, 128) } else { c.text_dim }),
            );

        let status = row()
            .key("hist-status")
            .w_full()
            .h(24.0)
            .px(8.0)
            .align(rune::Align::Center)
            .gap(12.0)
            .fill(c.header_bg)
            .radius(4.0)
            .child(
                text(format!("Kolux Rune Spike · scrollback · {} added this run", self.added))
                    .font(type_::LABEL)
                    .color(c.text),
            )
            .child(rune::spacer())
            .child(text("virtualize + growth").font(type_::MONO_CAPTION).color(c.text_dim));

        col()
            .key("hist-root")
            .w_full()
            .h_full()
            .padding(8.0)
            .gap(6.0)
            .fill(c.app_bg)
            .child(header)
            .child(viewport)
            .child(status)
    }
}

/// One history row: `[hh:mm:ss] level  message …`, the shape a log tail has.
fn line(i: usize, cols: u16, style: TextStyle, ink: Color, dim: Color) -> GridRow {
    let secs = i % 60;
    let body: &str = match i % 6 {
        0 => "cargo test --release --workspace",
        1 => "running 214 tests across 9 binaries",
        2 => "ok    src/usage/tokens.rs: 41 passed",
        3 => "warning: unused variable `rows` (build continues)",
        4 => "error: could not compile `kolux` (1 error) → retrying with --keep-going",
        _ => "git -C . status --short · 3 files modified, 1 untracked",
    };
    let mut text_out = format!("[{:02}:{:02}:{:02}] ", (i / 3600) % 24, (i / 60) % 60, secs);
    let stamp_end = text_out.len();
    let level = match i % 6 {
        4 => "ERR ",
        3 => "WARN",
        _ => "info",
    };
    text_out.push_str(level);
    let level_end = text_out.len();
    text_out.push(' ');
    let body_start = text_out.len();
    text_out.push_str(body);
    let pad = usize::from(cols).saturating_sub(text_out.chars().count());
    for _ in 0..pad {
        text_out.push(' ');
    }

    let err = rgb(248, 113, 113);
    let warn = rgb(250, 204, 21);
    let info = rgb(100, 116, 139);
    let spans = vec![
        Span::new(0, stamp_end).color(dim),
        Span::new(stamp_end, level_end).color(if i % 6 == 4 { err } else if i % 6 == 3 { warn } else { info }),
        Span::new(body_start, text_out.len()).color(ink),
    ];
    GridRow::new(text_out, spans, style)
}
