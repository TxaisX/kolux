//! VT100/ANSI screen -> Rune `GridRow` converter with per-row hashing/caching.
//! Unchanged rows reuse their `Rc<GridRow>` so Rune skips Parley shaping and GPU instance rebuilds.

use std::hash::{Hash, Hasher};
use std::rc::Rc;

use rune::color::srgb_decode;
use rune::{Color, GridRow, Span, TextStyle};

#[derive(Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub fg: Color,
    pub cursor_bg: Color,
    pub cursor_fg: Color,
    pub cursor_unfocused: Color,
    /// ANSI 0-15, so a theme can restyle every coloured program in the pane.
    pub ansi: [[u8; 3]; 16],
}

impl Default for Palette {
    fn default() -> Self {
        Self {
            bg: rgb(16, 18, 22),
            fg: rgb(226, 232, 240),
            cursor_bg: rgb(96, 165, 250),
            cursor_fg: rgb(16, 18, 22),
            cursor_unfocused: rgb(100, 116, 139),
            ansi: DEFAULT_ANSI,
        }
    }
}

/// xterm's own ANSI defaults.
pub const DEFAULT_ANSI: [[u8; 3]; 16] = [
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

#[inline]
pub fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color {
        r: srgb_decode(f32::from(r) / 255.0),
        g: srgb_decode(f32::from(g) / 255.0),
        b: srgb_decode(f32::from(b) / 255.0),
        a: 1.0,
    }
}

/// Standard xterm-256 palette lookup.
pub fn vt_color(c: vt100::Color, default: Color, ansi16: &[[u8; 3]; 16]) -> Color {
    match c {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => rgb(r, g, b),
        vt100::Color::Idx(idx) => {
            match idx {
                0..=15 => {
                    let [r, g, b] = ansi16[idx as usize];
                    rgb(r, g, b)
                }
                16..=231 => {
                    let n = idx - 16;
                    let ri = n / 36;
                    let gi = (n % 36) / 6;
                    let bi = n % 6;
                    let step = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
                    rgb(step(ri), step(gi), step(bi))
                }
                232..=255 => {
                    let v = 8 + (idx - 232) * 10;
                    rgb(v, v, v)
                }
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct CellStyle {
    fg_tag: u32,
    bg_tag: u32,
    flags: u8,
}

fn color_tag(c: vt100::Color) -> u32 {
    match c {
        vt100::Color::Default => 0,
        vt100::Color::Idx(i) => 0x0100_0000 | u32::from(i),
        vt100::Color::Rgb(r, g, b) => 0x0200_0000 | (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b),
    }
}

fn row_hash(screen: &vt100::Screen, row: u16, cols: u16, cursor_col: Option<u16>, focused: bool) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    row.hash(&mut h);
    cols.hash(&mut h);
    cursor_col.hash(&mut h);
    if cursor_col.is_some() {
        focused.hash(&mut h);
    }
    for col in 0..cols {
        if let Some(cell) = screen.cell(row, col) {
            cell.contents().hash(&mut h);
            color_tag(cell.fgcolor()).hash(&mut h);
            color_tag(cell.bgcolor()).hash(&mut h);
            let flags = u8::from(cell.bold())
                | (u8::from(cell.italic()) << 1)
                | (u8::from(cell.underline()) << 2)
                | (u8::from(cell.inverse()) << 3)
                | (u8::from(cell.is_wide()) << 4)
                | (u8::from(cell.is_wide_continuation()) << 5);
            flags.hash(&mut h);
        } else {
            0u8.hash(&mut h);
        }
    }
    h.finish()
}

/// Syncs `cache` to `screen`, rebuilding only rows whose content, styling, or cursor state changed.
pub fn sync_rows(
    screen: &vt100::Screen,
    style: TextStyle,
    palette: Palette,
    focused: bool,
    cache: &mut Vec<(u64, Rc<GridRow>)>,
) -> Vec<Rc<GridRow>> {
    let (rows, cols) = screen.size();
    let (cur_row, cur_col) = screen.cursor_position();
    let show_cursor = !screen.hide_cursor();
    if cache.len() != usize::from(rows) {
        cache.clear();
        cache.resize_with(usize::from(rows), || {
            (u64::MAX, Rc::new(GridRow::new(" ", Vec::new(), style)))
        });
    }

    let mut out = Vec::with_capacity(usize::from(rows));
    for r in 0..rows {
        let cursor_on_row = if show_cursor && r == cur_row && cur_col < cols {
            Some(cur_col)
        } else {
            None
        };
        let hash = row_hash(screen, r, cols, cursor_on_row, focused);
        let slot = &mut cache[usize::from(r)];
        if slot.0 != hash {
            let built = Rc::new(build_row(screen, r, cols, cursor_on_row, focused, style, palette));
            *slot = (hash, built);
        }
        out.push(Rc::clone(&slot.1));
    }
    out
}

fn build_row(
    screen: &vt100::Screen,
    row: u16,
    cols: u16,
    cursor_col: Option<u16>,
    focused: bool,
    style: TextStyle,
    palette: Palette,
) -> GridRow {
    let mut line = String::with_capacity(usize::from(cols));
    let mut spans: Vec<Span> = Vec::new();
    let mut fills: Vec<(u16, u16, Color)> = Vec::new();
    let mut wide_cells: Vec<(u16, String, TextStyle, Color)> = Vec::new();

    let mut active_span: Option<(usize, CellStyle, Color)> = None;
    let mut active_fill: Option<(u16, Color)> = None;

    for col in 0..cols {
        let byte_start = line.len();
        let cell = screen.cell(row, col);
        let is_cursor = cursor_col == Some(col);

        let (ch_str, wide, wide_cont, mut fg, mut bg, bold, italic, underline, has_bg) = match cell {
            Some(c) => {
                let mut fg_raw = vt_color(c.fgcolor(), palette.fg, &palette.ansi);
                let mut bg_raw = vt_color(c.bgcolor(), palette.bg, &palette.ansi);
                let mut has_explicit_bg = !matches!(c.bgcolor(), vt100::Color::Default);
                if c.inverse() {
                    std::mem::swap(&mut fg_raw, &mut bg_raw);
                    has_explicit_bg = true;
                }
                (
                    c.contents(),
                    c.is_wide(),
                    c.is_wide_continuation(),
                    fg_raw,
                    bg_raw,
                    c.bold(),
                    c.italic(),
                    c.underline(),
                    has_explicit_bg,
                )
            }
            None => (String::new(), false, false, palette.fg, palette.bg, false, false, false, false),
        };

        let mut draw_bg = has_bg;
        if is_cursor {
            draw_bg = true;
            if focused {
                bg = palette.cursor_bg;
                fg = palette.cursor_fg;
            } else {
                bg = palette.cursor_unfocused;
            }
        }

        // Background runs
        if draw_bg {
            match active_fill {
                Some((start, prev_bg)) if prev_bg == bg => {
                    let _ = start;
                }
                Some((start, prev_bg)) => {
                    fills.push((start, col, prev_bg));
                    active_fill = Some((col, bg));
                }
                None => {
                    active_fill = Some((col, bg));
                }
            }
        } else if let Some((start, prev_bg)) = active_fill.take() {
            fills.push((start, col, prev_bg));
        }

        // Character & wide cell placement
        if wide_cont {
            line.push(' ');
            if let Some((s, cs, sfg)) = active_span.take() {
                push_span(&mut spans, s, byte_start, cs, sfg);
            }
            continue;
        } else if wide {
            line.push(' ');
            if let Some((s, cs, sfg)) = active_span.take() {
                push_span(&mut spans, s, byte_start, cs, sfg);
            }
            let mut w_style = style;
            if bold {
                w_style.weight = 600.0;
            }
            if italic {
                w_style = w_style.italic();
            }
            wide_cells.push((col, ch_str.to_owned(), w_style, fg));
            continue;
        }

        if ch_str.is_empty() {
            line.push(' ');
        } else {
            line.push_str(&ch_str);
        }

        let fg_tag = if is_cursor {
            0x0300_0000 | u32::from(focused)
        } else if let Some(c) = cell {
            if c.inverse() {
                0x0400_0000 ^ color_tag(c.bgcolor())
            } else {
                color_tag(c.fgcolor())
            }
        } else {
            0
        };
        let flags = u8::from(bold) | (u8::from(italic) << 1) | (u8::from(underline) << 2);
        let styled = fg_tag != 0 || flags != 0;
        let cs = CellStyle { fg_tag, bg_tag: 0, flags };

        if styled {
            match active_span {
                Some((start, prev_cs, prev_fg)) if prev_cs == cs && prev_fg == fg => {
                    let _ = start;
                }
                Some((start, prev_cs, prev_fg)) => {
                    push_span(&mut spans, start, byte_start, prev_cs, prev_fg);
                    active_span = Some((byte_start, cs, fg));
                }
                None => {
                    active_span = Some((byte_start, cs, fg));
                }
            }
        } else if let Some((start, prev_cs, prev_fg)) = active_span.take() {
            push_span(&mut spans, start, byte_start, prev_cs, prev_fg);
        }
    }

    if let Some((start, prev_bg)) = active_fill.take() {
        fills.push((start, cols, prev_bg));
    }
    if let Some((start, prev_cs, prev_fg)) = active_span.take() {
        push_span(&mut spans, start, line.len(), prev_cs, prev_fg);
    }

    let mut row_el = GridRow::new(line, spans, style);
    for (start, end, color) in fills {
        row_el = row_el.fill(start, end, color);
    }
    for (col, txt, w_style, fg) in wide_cells {
        row_el = row_el.cell(col, 2, txt, w_style, fg);
    }
    row_el
}

fn push_span(spans: &mut Vec<Span>, start: usize, end: usize, cs: CellStyle, fg: Color) {
    if end <= start {
        return;
    }
    let mut s = Span::new(start, end).color(fg);
    if (cs.flags & 1) != 0 {
        s = s.bold();
    }
    if (cs.flags & 2) != 0 {
        s = s.italic();
    }
    if (cs.flags & 4) != 0 {
        s = s.underline(fg);
    }
    spans.push(s);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune::tok::Family;

    #[test]
    fn sync_rows_reuses_unchanged_rows_and_tracks_colors_wide_cells_and_cursor() {
        let mut parser = vt100::Parser::new(4, 12, 0);
        parser.process(b"\x1b[38;2;250;204;21mHi\x1b[0m \xe6\x97\xa5\r\nnext");
        let style = TextStyle::new(13.0, 400.0).family(Family::SystemMono).lh(18.0);
        let mut cache = Vec::new();

        let r1 = sync_rows(parser.screen(), style, Palette::default(), true, &mut cache);
        assert_eq!(r1.len(), 4);

        // Unchanged row 0 keeps exact Rc pointer; changed row 1 rebuilds.
        parser.process(b"!");
        let r2 = sync_rows(parser.screen(), style, Palette::default(), true, &mut cache);
        assert!(Rc::ptr_eq(&r1[0], &r2[0]), "unchanged row 0 should reuse cached GridRow");
        assert!(!Rc::ptr_eq(&r1[1], &r2[1]), "edited cursor row 1 should rebuild");
    }
}

