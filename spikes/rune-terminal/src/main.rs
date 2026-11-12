mod vt;

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kolux_lib::pty::{PtySession, SharedWriter, fresh_terminal_path, shell_commands, write_shared};
use rune::tok::{Family, TextStyle, type_};
use rune::{AppSpec, Cx, El, GridRow, Key, KeyEvent, Tx, Waker, col, el, grid, row, text};

use vt::{Palette, rgb, sync_rows};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const CELL_PAD_X: f32 = 8.0;
const CELL_PAD_Y: f32 = 6.0;
const HEADER_H: f32 = 24.0;
const STATUS_H: f32 = 24.0;
const GRID_GAP: f32 = 6.0;
const OUTER_PAD: f32 = 8.0;

#[derive(Clone, Copy)]
struct ProbeSample {
    sent_at: Instant,
    byte: u8,
}

enum Msg {
    Output(usize, Vec<u8>),
    Exit(usize, Option<u32>),
}

struct Pane {
    id: usize,
    title: String,
    parser: vt100::Parser,
    rows_cache: RefCell<Vec<(u64, Rc<GridRow>)>>,
    session: Option<PtySession>,
    writer: Option<SharedWriter>,
    exited: Option<Option<u32>>,
    cols: u16,
    rows: u16,
    bytes_in: u64,
}

impl Pane {
    fn new(id: usize, cols: u16, rows: u16) -> Self {
        Self {
            id,
            title: format!("Pane {}", id + 1),
            parser: vt100::Parser::new(rows, cols, 1000),
            rows_cache: RefCell::new(Vec::new()),
            session: None,
            writer: None,
            exited: None,
            cols,
            rows,
            bytes_in: 0,
        }
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        let cols = cols.max(16);
        let rows = rows.max(4);
        if self.cols == cols && self.rows == rows {
            return;
        }
        self.cols = cols;
        self.rows = rows;
        self.parser.set_size(rows, cols);
        self.rows_cache.borrow_mut().clear();
        if let Some(s) = &self.session {
            let _ = s.resize(cols, rows);
        }
    }
}

struct BenchState {
    enabled: bool,
    probe_enabled: bool,
    started_at: Instant,
    last_frame_at: Option<Instant>,
    frame_times_ms: Vec<f64>,
    pending_probe: Option<ProbeSample>,
    key_latencies_ms: Vec<f64>,
    probes_sent: usize,
    probes_target: usize,
    next_probe_at: Option<Instant>,
    reported: bool,
    frames_rendered: u64,
}

impl BenchState {
    fn new(enabled: bool, probe_enabled: bool) -> Self {
        Self {
            enabled,
            probe_enabled,
            started_at: Instant::now(),
            last_frame_at: None,
            frame_times_ms: Vec::with_capacity(512),
            pending_probe: None,
            key_latencies_ms: Vec::with_capacity(64),
            probes_sent: 0,
            probes_target: 20,
            next_probe_at: None,
            reported: false,
            frames_rendered: 0,
        }
    }
}

struct AppState {
    pane_count: usize,
    active: usize,
    panes: Vec<Pane>,
    queue: Arc<Mutex<VecDeque<Msg>>>,
    waker: Option<Waker>,
    mono_style: TextStyle,
    cell_w: f32,
    cell_h: f32,
    palette: Palette,
    demo_banner: bool,
    fast_cmd: bool,
    bench: BenchState,
}

impl Default for AppState {
    fn default() -> Self {
        let args = rune::extra_args();
        let pane_count = arg_value(&args, "--panes")
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&n| matches!(n, 1 | 2 | 4 | 6 | 8))
            .unwrap_or(4);
        let demo_banner = args.iter().any(|a| a == "--demo");
        let fast_cmd = args.iter().any(|a| a == "--cmd");
        let bench = args.iter().any(|a| a == "--bench");
        let probe = args.iter().any(|a| a == "--probe");

        let mono_style = TextStyle::new(13.0, 400.0)
            .family(Family::SystemMono)
            .lh(18.0);
        let measured = rune::text::advance("MMMMMMMMMM", mono_style) / 10.0;
        let cell_w = if measured.is_finite() && measured > 2.0 { measured } else { 7.8 };
        let cell_h = mono_style.line_px();

        Self {
            pane_count,
            active: 0,
            panes: Vec::new(),
            queue: Arc::new(Mutex::new(VecDeque::new())),
            waker: None,
            mono_style,
            cell_w,
            cell_h,
            palette: Palette::default(),
            demo_banner,
            fast_cmd,
            bench: BenchState::new(bench, probe),
        }
    }
}

fn arg_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == flag).map(|w| w[1].as_str())
}

fn spawn_panes(s: &mut AppState, waker: Waker) {
    s.waker = Some(waker.clone());
    let path_env = fresh_terminal_path(std::env::var_os("PATH"));
    let count = s.pane_count.max(1);
    s.panes = (0..count)
        .map(|i| Pane::new(i, DEFAULT_COLS, DEFAULT_ROWS))
        .collect();

    for i in 0..count {
        let mut cmds = if s.fast_cmd {
            let mut c = portable_pty::CommandBuilder::new("cmd.exe");
            c.args(["/k", "chcp.com", "65001", ">nul"]);
            vec![c]
        } else {
            let mut list = shell_commands(None, None);
            // Skip PowerShell user profile in spike runs so 8 panes reach prompt fast and predictably.
            for c in &mut list {
                let prog = c.get_argv().first().map(|a| a.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                if prog.ends_with("pwsh.exe") || prog.ends_with("powershell.exe") {
                    c.arg("-NoProfile");
                }
            }
            list
        };
        for c in &mut cmds {
            c.env("PATH", &path_env);
            c.env("TERM", "xterm-256color");
            c.env("COLORTERM", "truecolor");
        }

        let q_out = Arc::clone(&s.queue);
        let w_out = waker.clone();
        let q_exit = Arc::clone(&s.queue);
        let w_exit = waker.clone();

        match PtySession::spawn_first(
            cmds,
            DEFAULT_COLS,
            DEFAULT_ROWS,
            move |bytes| {
                if let Ok(mut q) = q_out.lock() {
                    q.push_back(Msg::Output(i, bytes.to_vec()));
                }
                w_out();
            },
            move |code| {
                if let Ok(mut q) = q_exit.lock() {
                    q.push_back(Msg::Exit(i, code));
                }
                w_exit();
            },
        ) {
            Ok(session) => {
                let prog = session.program().to_owned();
                let short = prog
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(&prog)
                    .to_string();
                let writer = session.writer().ok();
                if s.demo_banner {
                    if let Some(w) = &writer {
                        let cmd = if short.to_ascii_lowercase().contains("cmd") {
                            format!("echo Pane {} [%CD%] \x1b[1;36mrune-terminal\x1b[0m \x1b[32mANSI\x1b[0m \x1b[38;2;250;204;21mRGB\x1b[0m\r\n", i + 1)
                        } else {
                            format!(
                                "Write-Host \"Pane {} $([char]27)[1;36mrune-terminal$([char]27)[0m $([char]27)[32mANSI16$([char]27)[0m $([char]27)[38;2;250;204;21mTrueColor$([char]27)[0m $([char]27)[4;35mUnderline$([char]27)[0m\"\r\n",
                                i + 1
                            )
                        };
                        let _ = write_shared(w, cmd.as_bytes());
                    }
                }
                s.panes[i].title = format!("Pane {} · {}", i + 1, short);
                s.panes[i].writer = writer;
                s.panes[i].session = Some(session);
            }
            Err(err) => {
                let msg = format!("\x1b[31mFailed to spawn PTY: {err}\x1b[0m\r\n");
                s.panes[i].parser.process(msg.as_bytes());
            }
        }
    }

    if s.bench.probe_enabled {
        s.bench.next_probe_at = Some(Instant::now() + Duration::from_millis(1200));
    }
    if s.bench.enabled {
        println!(
            "BENCH_INIT pid={} panes={} cell_w={:.2} cell_h={:.2}",
            std::process::id(),
            count,
            s.cell_w,
            s.cell_h
        );
    }
}

fn poll_pty(s: &mut AppState, _clock: f64, tx: &mut Tx) -> bool {
    let now = Instant::now();
    if let Some(prev) = s.bench.last_frame_at {
        let dt_ms = now.duration_since(prev).as_secs_f64() * 1000.0;
        if dt_ms < 250.0 {
            s.bench.frame_times_ms.push(dt_ms);
        }
    }
    s.bench.last_frame_at = Some(now);
    s.bench.frames_rendered += 1;

    let mut changed = false;
    let drained: Vec<Msg> = {
        let mut q = s.queue.lock().unwrap();
        q.drain(..).collect()
    };

    for msg in drained {
        match msg {
            Msg::Output(idx, bytes) => {
                if let Some(pane) = s.panes.get_mut(idx) {
                    pane.bytes_in += bytes.len() as u64;
                    pane.parser.process(&bytes);
                    changed = true;
                    if idx == 0 {
                        if let Some(probe) = s.bench.pending_probe {
                            if bytes.contains(&probe.byte) {
                                let elapsed = now.duration_since(probe.sent_at).as_secs_f64() * 1000.0;
                                s.bench.key_latencies_ms.push(elapsed);
                                s.bench.pending_probe = None;
                            }
                        }
                    }
                }
            }
            Msg::Exit(idx, code) => {
                if let Some(pane) = s.panes.get_mut(idx) {
                    pane.exited = Some(code);
                    let notice = format!("\r\n\x1b[2m[process exited: {:?}]\x1b[0m\r\n", code);
                    pane.parser.process(notice.as_bytes());
                    changed = true;
                }
            }
        }
    }

    if s.bench.probe_enabled {
        if let Some(due) = s.bench.next_probe_at {
            if now >= due && s.bench.pending_probe.is_none() && s.bench.probes_sent < s.bench.probes_target {
                let ch = b'a' + (s.bench.probes_sent % 26) as u8;
                if let Some(w) = s.panes.first().and_then(|p| p.writer.as_ref()) {
                    let sent_at = Instant::now();
                    if write_shared(w, &[ch]).is_ok() {
                        s.bench.pending_probe = Some(ProbeSample { sent_at, byte: ch });
                        s.bench.probes_sent += 1;
                        s.bench.next_probe_at = Some(sent_at + Duration::from_millis(90));
                        changed = true;
                    }
                }
            } else if s.bench.probes_sent >= s.bench.probes_target
                && s.bench.pending_probe.is_none()
                && !s.bench.reported
            {
                s.bench.reported = true;
                report_bench(&s.bench);
            }
        }
        if !s.bench.reported {
            tx.wake_after(Duration::from_millis(16));
        }
    }

    changed
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn report_bench(b: &BenchState) {
    let mut frames = b.frame_times_ms.clone();
    frames.sort_by(f64::total_cmp);
    let mut keys = b.key_latencies_ms.clone();
    keys.sort_by(f64::total_cmp);
    println!(
        "BENCH_RESULT pid={} uptime_s={:.2} frames={} frame_p50_ms={:.2} frame_p95_ms={:.2} key_samples={} key_p50_ms={:.2} key_p95_ms={:.2} key_max_ms={:.2}",
        std::process::id(),
        b.started_at.elapsed().as_secs_f64(),
        b.frames_rendered,
        percentile(&frames, 0.50),
        percentile(&frames, 0.95),
        keys.len(),
        percentile(&keys, 0.50),
        percentile(&keys, 0.95),
        keys.last().copied().unwrap_or(0.0),
    );
}

fn key_to_vt(ev: &KeyEvent) -> Option<Vec<u8>> {
    if ev.mods.ctrl {
        match &ev.key {
            Key::Command(c) if c.is_ascii_alphabetic() => {
                let byte = (c.to_ascii_lowercase() as u8) - b'a' + 1;
                return Some(vec![byte]);
            }
            Key::Text(t) if t.len() == 1 => {
                let c = t.as_bytes()[0].to_ascii_lowercase();
                if c.is_ascii_alphabetic() {
                    return Some(vec![c - b'a' + 1]);
                }
            }
            _ => {}
        }
    }

    match &ev.key {
        Key::Text(s) => Some(s.as_bytes().to_vec()),
        Key::Enter => Some(b"\r".to_vec()),
        Key::Backspace => Some(vec![0x7f]),
        Key::Tab => Some(b"\t".to_vec()),
        Key::Escape => Some(vec![0x1b]),
        Key::Up => Some(b"\x1b[A".to_vec()),
        Key::Down => Some(b"\x1b[B".to_vec()),
        Key::Right => Some(b"\x1b[C".to_vec()),
        Key::Left => Some(b"\x1b[D".to_vec()),
        Key::Home => Some(b"\x1b[H".to_vec()),
        Key::End => Some(b"\x1b[F".to_vec()),
        Key::PageUp => Some(b"\x1b[5~".to_vec()),
        Key::PageDown => Some(b"\x1b[6~".to_vec()),
        Key::Delete => Some(b"\x1b[3~".to_vec()),
        Key::Insert => Some(b"\x1b[2~".to_vec()),
        Key::Function(n) => {
            let seq = match n {
                1 => "\x1bOP",
                2 => "\x1bOQ",
                3 => "\x1bOR",
                4 => "\x1bOS",
                5 => "\x1b[15~",
                6 => "\x1b[17~",
                7 => "\x1b[18~",
                8 => "\x1b[19~",
                9 => "\x1b[20~",
                10 => "\x1b[21~",
                11 => "\x1b[23~",
                12 => "\x1b[24~",
                _ => return None,
            };
            Some(seq.as_bytes().to_vec())
        }
        _ => None,
    }
}

fn on_key(s: &mut AppState, ev: &KeyEvent, _tx: &mut Tx) -> bool {
    // Ctrl+Tab cycles panes; Alt+1..8 focuses pane N directly.
    if ev.mods.ctrl && matches!(ev.key, Key::Tab) && !s.panes.is_empty() {
        s.active = if ev.mods.shift {
            (s.active + s.panes.len() - 1) % s.panes.len()
        } else {
            (s.active + 1) % s.panes.len()
        };
        return true;
    }
    if ev.mods.alt {
        if let Key::Text(t) = &ev.key {
            if let Ok(n) = t.parse::<usize>() {
                if (1..=s.panes.len()).contains(&n) {
                    s.active = n - 1;
                    return true;
                }
            }
        }
    }

    let Some(bytes) = key_to_vt(ev) else {
        return false;
    };
    if let Some(pane) = s.panes.get(s.active) {
        if let Some(writer) = &pane.writer {
            if !ev.mods.ctrl && !ev.mods.alt && bytes.len() == 1 && bytes[0].is_ascii_graphic() {
                s.bench.pending_probe = Some(ProbeSample {
                    sent_at: Instant::now(),
                    byte: bytes[0],
                });
            }
            let _ = write_shared(writer, &bytes);
            return true;
        }
    }
    false
}

fn grid_dims(count: usize) -> (usize, usize) {
    match count {
        0 | 1 => (1, 1),
        2 => (2, 1),
        3 | 4 => (2, 2),
        5 | 6 => (3, 2),
        _ => (4, 2),
    }
}

fn view(s: &AppState, _cx: &mut Cx<AppState>) -> El {
    let bg_app = rgb(11, 13, 16);
    let bg_header = rgb(22, 25, 31);
    let bg_header_active = rgb(29, 36, 48);
    let border_idle = rgb(39, 44, 54);
    let border_active = rgb(96, 165, 250);
    let text_dim = rgb(148, 163, 184);
    let text_bright = rgb(241, 245, 249);
    let accent = rgb(96, 165, 250);

    let (cols_n, rows_n) = grid_dims(s.panes.len());
    let mut rows_els = Vec::with_capacity(rows_n);

    for r_idx in 0..rows_n {
        let mut row_panes = Vec::with_capacity(cols_n);
        for c_idx in 0..cols_n {
            let idx = r_idx * cols_n + c_idx;
            if let Some(pane) = s.panes.get(idx) {
                let is_active = idx == s.active;
                let mut cache = pane.rows_cache.borrow_mut();
                let grid_rows = sync_rows(
                    pane.parser.screen(),
                    s.mono_style,
                    s.palette,
                    is_active,
                    &mut cache,
                );
                let cell_w = s.cell_w;
                let cell_h = s.cell_h;
                let pane_idx = pane.id;

                let header = row()
                    .key(format!("hdr-{pane_idx}"))
                    .w_full()
                    .h(HEADER_H)
                    .px(8.0)
                    .align(rune::Align::Center)
                    .gap(6.0)
                    .fill(if is_active { bg_header_active } else { bg_header })
                    .child(
                        el()
                            .size(7.0, 7.0)
                            .radius(3.5)
                            .fill(if pane.exited.is_some() {
                                rgb(248, 113, 113)
                            } else if is_active {
                                accent
                            } else {
                                rgb(74, 222, 128)
                            }),
                    )
                    .child(
                        text(&pane.title)
                            .font(type_::LABEL)
                            .color(if is_active { text_bright } else { text_dim }),
                    )
                    .child(rune::spacer())
                    .child(
                        text(format!("{}x{}", pane.cols, pane.rows))
                            .font(type_::MONO_CAPTION)
                            .color(text_dim),
                    );

                let viewport = el()
                    .key(format!("vp-{pane_idx}"))
                    .w_full()
                    .grow(1.0)
                    .min_h(0.0)
                    .padding(CELL_PAD_Y)
                    .px(CELL_PAD_X)
                    .fill(s.palette.bg)
                    .on_layout(move |st: &mut AppState, rect: [f32; 4]| {
                        let inner_w = (rect[2] - CELL_PAD_X * 2.0).max(cell_w * 16.0);
                        let inner_h = (rect[3] - CELL_PAD_Y * 2.0).max(cell_h * 4.0);
                        let new_cols = (inner_w / cell_w).floor() as u16;
                        let new_rows = (inner_h / cell_h).floor() as u16;
                        if let Some(p) = st.panes.get_mut(pane_idx) {
                            p.resize(new_cols, new_rows);
                        }
                    })
                    .child(
                        grid(pane.cols, cell_w, cell_h, grid_rows)
                            .key(format!("grid-{pane_idx}"))
                            .w(pane.cols as f32 * cell_w)
                            .h(pane.rows as f32 * cell_h),
                    );

                let card = col()
                    .key(format!("pane-{pane_idx}"))
                    .grow(1.0)
                    .h_full()
                    .min_h(0.0)
                    .radius(6.0)
                    .border(if is_active { 1.5 } else { 1.0 }, if is_active { border_active } else { border_idle })
                    .fill(s.palette.bg)
                    .focusable(true)
                    .on_press(move |st: &mut AppState| {
                        st.active = pane_idx;
                    })
                    .child(header)
                    .child(viewport);

                row_panes.push(card);
            }
        }
        rows_els.push(
            row()
                .key(format!("grid-row-{r_idx}"))
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .gap(GRID_GAP)
                .children(row_panes),
        );
    }

    let active_info = s
        .panes
        .get(s.active)
        .map(|p| format!("{} · {}x{} · {} B", p.title, p.cols, p.rows, p.bytes_in))
        .unwrap_or_default();
    let status = row()
        .key("status-bar")
        .w_full()
        .h(STATUS_H)
        .px(8.0)
        .align(rune::Align::Center)
        .gap(12.0)
        .fill(bg_header)
        .radius(4.0)
        .child(
            text(format!("Kolux Rune Terminal Spike · {} pane{}", s.panes.len(), if s.panes.len() == 1 { "" } else { "s" }))
                .font(type_::LABEL)
                .color(text_bright),
        )
        .child(text(active_info).font(type_::MONO_CAPTION).color(text_dim))
        .child(rune::spacer())
        .child(
            text("Click pane or Ctrl+Tab / Alt+1..8 to focus")
                .font(type_::LABEL)
                .color(text_dim),
        );

    col()
        .key("root")
        .w_full()
        .h_full()
        .padding(OUTER_PAD)
        .gap(GRID_GAP)
        .fill(bg_app)
        .child(
            col()
                .key("pane-grid")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .gap(GRID_GAP)
                .children(rows_els),
        )
        .child(status)
}

fn main() {
    rune::run(AppSpec::<AppState> {
        scenes: &[
            ("1", |s| s.pane_count = 1),
            ("4", |s| s.pane_count = 4),
            ("8", |s| s.pane_count = 8),
        ],
        families: ("Inter", "ui-monospace"),
        setup: Some(spawn_panes),
        poll: Some(poll_pty),
        on_key: Some(on_key),
        ..AppSpec::new("Kolux Rune Terminal Spike", (1440.0, 900.0), AppState::default, view)
    });
}
