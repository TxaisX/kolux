mod prefs;
mod vt;

use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kolux_lib::pty::{PtySession, SharedWriter, fresh_terminal_path, shell_commands, write_shared};
use rune::tok::{Family, TextStyle, type_};
use rune::{AppSpec, Cx, El, GridRow, Key, KeyEvent, Tx, Waker, col, el, grid, row, text};

use prefs::{Prefs, Resolved};
use vt::{Palette, rgb, sync_rows};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const HEADER_H: f32 = 24.0;
const STATUS_H: f32 = 24.0;

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
    panes: Vec<Pane>,
    active: usize,
    queue: Arc<Mutex<VecDeque<Msg>>>,
    waker: Option<Waker>,
    /// Everything the user can change, live, from one file (or from the flags below when no file
    /// is given).
    prefs: Resolved,
    prefs_path: Option<PathBuf>,
    /// Set when a file is on the command line, so `--scene N` and `--panes N` stop overriding it.
    prefs_locked: bool,
    prefs_error: Option<String>,
    prefs_note: Option<String>,
    watcher: prefs::Watcher,
    /// One per pane: metrics, ink and palette. A pane may differ from the rest (`pane_overrides`).
    looks: Vec<PaneLook>,
    fast_cmd: bool,
    no_pty: bool,
    bench: BenchState,
}

/// A pane's resolved drawing recipe: what `PaneLook::from` measured out of one `prefs::Look`.
struct PaneLook {
    style: TextStyle,
    cell_w: f32,
    cell_h: f32,
    palette: Palette,
    text: rune::Color,
    text_dim: rune::Color,
    accent: rune::Color,
}

impl PaneLook {
    fn new(look: &prefs::Look) -> Self {
        let font = &look.font;
        let style = TextStyle::new(font.size, 400.0).family(Family::SystemMono).lh(font.line_height);
        let measured = rune::text::advance("MMMMMMMMMM", style) / 10.0;
        let cell_w = if font.cell_width > 0.0 {
            font.cell_width
        } else if measured.is_finite() && measured > 2.0 {
            measured
        } else {
            7.8
        };
        Self {
            cell_w,
            cell_h: style.line_px(),
            style,
            palette: look.palette,
            text: look.text,
            text_dim: look.text_dim,
            accent: look.border_active,
        }
    }
}

impl AppState {
    fn pane_count(&self) -> usize {
        self.prefs.raw.layout.panes
    }

    /// Pane `idx`'s look, falling back to the first when the two counts disagree for a frame.
    fn look(&self, idx: usize) -> &PaneLook {
        self.looks.get(idx).or_else(|| self.looks.first()).expect("prefs always resolve to one look")
    }
}

impl Default for AppState {
    fn default() -> Self {
        let args = rune::extra_args();
        let mut prefs = Prefs::default();
        if let Some(n) = arg_value(&args, "--panes").and_then(|v| v.parse::<usize>().ok()).filter(|&n| (1..=32).contains(&n)) {
            prefs.layout.panes = n;
        }
        if args.iter().any(|a| a == "--no-banner") {
            prefs.layout.banner = false;
        }
        let fast_cmd = args.iter().any(|a| a == "--cmd");
        let no_pty = args.iter().any(|a| a == "--no-pty");
        let bench = args.iter().any(|a| a == "--bench");
        let probe = args.iter().any(|a| a == "--probe");

        // A prefs file on the command line is loaded before the first frame. A file that will not
        // parse must not take the window down: the built-in defaults stay live and the reason is
        // shown in the status bar, and the watcher keeps trying.
        let prefs_path = arg_value(&args, "--prefs").map(PathBuf::from);
        let mut prefs_error = None;
        let resolved = match &prefs_path {
            Some(path) => match Prefs::load(path).and_then(|p| p.resolve()) {
                Ok(r) => r,
                Err(e) => {
                    println!("PREFS_ERROR {e}");
                    prefs_error = Some(e);
                    prefs.resolve().expect("built-in prefs always resolve")
                }
            },
            None => prefs.resolve().expect("built-in prefs always resolve"),
        };

        let mut state = Self {
            panes: Vec::new(),
            active: 0,
            queue: Arc::new(Mutex::new(VecDeque::new())),
            waker: None,
            prefs: resolved,
            watcher: prefs::Watcher::new(prefs_path.clone()),
            prefs_locked: prefs_path.is_some(),
            prefs_path,
            prefs_error,
            prefs_note: None,
            looks: Vec::new(),
            fast_cmd,
            no_pty,
            bench: BenchState::new(bench, probe),
        };
        state.apply_prefs();
        state
    }
}

impl AppState {
    /// Keeps the preferences file under watch while the app runs, and asks for a frame a few
    /// times a second so an idle window still notices an edit (a window with nothing drawing gets
    /// no poll otherwise).
    fn prefs_watch_tick(&mut self, tx: &mut Tx) -> bool {
        if self.prefs_path.is_none() {
            return false;
        }
        tx.wake_after(Duration::from_millis(400));
        self.watcher.changed(Instant::now())
    }

    /// Everything derived from the preferences: one look per pane (metrics, ink, palette). Cheap
/// enough to redo on every live reload.
    fn apply_prefs(&mut self) {
        self.looks = self.prefs.looks.iter().map(PaneLook::new).collect();
        for pane in &mut self.panes {
            pane.rows_cache.borrow_mut().clear();
        }
    }

    /// Re-resolves the in-memory preferences after a flag or scene changed them, so the looks
    /// match the pane count.
    fn refresh_looks(&mut self) {
        match self.prefs.raw.resolve() {
            Ok(r) => {
                self.prefs = r;
                self.apply_prefs();
            }
            Err(e) => self.prefs_error = Some(e),
        }
    }
}

fn arg_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == flag).map(|w| w[1].as_str())
}

fn spawn_panes(s: &mut AppState, waker: Waker) {
    s.waker = Some(waker.clone());
    let path_env = fresh_terminal_path(std::env::var_os("PATH"));
    let count = s.pane_count().max(1);
    let banner = s.prefs.raw.layout.banner;
    // A pane may name its own shell (`pane_overrides`); the rest take the grid's.
    let shells: Vec<prefs::Shell> = (0..count).map(|i| s.prefs.raw.shell_for(i).clone()).collect();
    s.panes = (0..count)
        .map(|i| Pane::new(i, DEFAULT_COLS, DEFAULT_ROWS))
        .collect();

    // `--no-pty`: a static grid with no shells, so a memory run can separate the render/readback
    // loop from the pty plumbing.
    if s.no_pty {
        for (i, pane) in s.panes.iter_mut().enumerate() {
            let banner = format!(
                "Pane {} (no pty)\r\n\x1b[1;36mrune-terminal\x1b[0m \x1b[32mANSI16\x1b[0m \x1b[38;2;250;204;21mTrueColor\x1b[0m\r\n",
                i + 1
            );
            pane.parser.process(banner.as_bytes());
            pane.title = format!("Pane {} · static", i + 1);
        }
        return;
    }

    for (i, shell) in shells.iter().enumerate().take(count) {
        let mut cmds = if let Some(program) = &shell.program {
            // The preferences name the program: `cargo` panes (shell.program = "wsl.exe").
            let mut c = portable_pty::CommandBuilder::new(program);
            c.args(&shell.args);
            vec![c]
        } else if s.fast_cmd {
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
            for (k, v) in &shell.env {
                c.env(k.as_str(), v.as_str());
            }
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
                if banner {
                    if let Some(w) = &writer {
                        let cmd = if short.to_ascii_lowercase().contains("cmd") {
                            format!("echo Pane {} rune-terminal ANSI RGB\x1b[0m\r", i + 1)
                        } else {
                            format!(
                                "Write-Host \"Pane {} $([char]27)[1;36mrune-terminal$([char]27)[0m $([char]27)[32mANSI16$([char]27)[0m $([char]27)[38;2;250;204;21mTrueColor$([char]27)[0m $([char]27)[4;35mUnderline$([char]27)[0m\"\r",
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
        s.bench.next_probe_at = Some(Instant::now() + Duration::from_millis(4000));
    }
    if s.bench.enabled {
        println!(
            "BENCH_INIT pid={} panes={} cell_w={:.2} cell_h={:.2}",
            std::process::id(),
            s.pane_count(),
            s.look(0).cell_w,
            s.look(0).cell_h
        );
    }
}

/// The console host asks the terminal where the cursor is (`ESC[6n`) before it prints anything, and
/// waits for the answer. Windows Terminal answers it; xterm.js answers it inside Kolux today; a grid
/// drawn by hand has to answer it too or every pane stays blank (measured: 4 bytes, then silence).
/// Also answers the status report (`ESC[5n`) and the primary device attributes (`ESC[c`).
fn terminal_replies(bytes: &[u8], screen: &vt100::Screen) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] != 0x1b || bytes[i + 1] != b'[' {
            i += 1;
            continue;
        }
        let start = i + 2;
        let mut end = start;
        while end < bytes.len() && !(0x40..=0x7e).contains(&bytes[end]) {
            end += 1;
        }
        if end >= bytes.len() {
            break; // a sequence split across reads is answered when its tail arrives
        }
        let params = &bytes[start..end];
        match bytes[end] {
            b'n' if params == &b"6"[..] || params.is_empty() => {
                let (row, col) = screen.cursor_position();
                out.extend_from_slice(format!("\x1b[{};{}R", row + 1, col + 1).as_bytes());
            }
            b'n' if params == &b"5"[..] => out.extend_from_slice(b"\x1b[0n"),
            b'c' if params.is_empty() || params == &b"0"[..] => out.extend_from_slice(b"\x1b[?1;2c"),
            _ => {}
        }
        i = end + 1;
    }
    out
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
                    let replies = terminal_replies(&bytes, pane.parser.screen());
                    if !replies.is_empty() {
                        if let Some(w) = pane.writer.as_ref() {
                            let _ = write_shared(w, &replies);
                        }
                    }
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

    if s.prefs_watch_tick(tx) {
        reload_prefs(s, tx);
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

/// Re-reads the preferences file and applies it to the live window. A file that does not parse
/// leaves the last good preferences running and shows the error; the watcher keeps trying, so
/// fixing the typo is enough to recover.
fn reload_prefs(s: &mut AppState, tx: &mut Tx) {
    let Some(path) = s.prefs_path.clone() else { return };
    match Prefs::load(&path).and_then(|p| p.resolve()) {
        Ok(resolved) => {
            let want = resolved.raw.layout.panes;
            s.prefs = resolved;
            s.prefs_error = None;
            s.active = s.active.min(want.saturating_sub(1));
            s.apply_prefs();
            s.prefs_note = Some(format!(
                "{} · {} pane{} · {}",
                path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                want,
                if want == 1 { "" } else { "s" },
                s.prefs.raw.theme.name
            ));
            println!(
                "PREFS_RELOAD file={} panes={} columns={} theme={} font={}/{} shell={} gap={} overrides={}",
                path.display(),
                want,
                s.prefs.raw.layout.columns,
                s.prefs.raw.theme.name,
                s.prefs.raw.font.size,
                s.prefs.raw.font.line_height,
                s.prefs.raw.shell.program.clone().unwrap_or_else(|| "kolux-default".into()),
                s.prefs.raw.layout.gap,
                s.prefs.raw.layout.pane_overrides.len(),
            );
            if want != s.panes.len() {
                if let Some(w) = s.waker.clone() {
                    spawn_panes(s, w);
                }
            }
            tx.wake_after(Duration::ZERO);
        }
        Err(err) => {
            s.prefs_error = Some(err.clone());
            println!("PREFS_ERROR {err}");
            tx.wake_after(Duration::ZERO);
        }
    }
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

fn on_key(s: &mut AppState, ev: &KeyEvent, tx: &mut Tx) -> bool {
    // Every binding here comes from the user's preferences file (Rune chord syntax).
    if s.prefs.keys.reload.matches(ev) {
        reload_prefs(s, tx);
        return true;
    }
    if s.prefs.keys.quit.matches(ev) {
        tx.close_window();
        return true;
    }
    if !s.panes.is_empty() && s.prefs.keys.next_pane.matches(ev) {
        s.active = (s.active + 1) % s.panes.len();
        return true;
    }
    if !s.panes.is_empty() && s.prefs.keys.prev_pane.matches(ev) {
        s.active = (s.active + s.panes.len() - 1) % s.panes.len();
        return true;
    }
    // Alt+1..8 always jumps straight to a pane: one key, one pane, kept out of the file so a user
    // can never bind it to something that leaves them unable to reach a pane.
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

fn view(s: &AppState, cx: &mut Cx<AppState>) -> El {
    // Uncoloured text takes the first pane's ink until the pane loop sets its own.
    cx.foreground(s.look(0).palette.fg);
    cx.caption_color(s.prefs.colors.text_dim);
    let c = s.prefs.colors;
    let layout = &s.prefs.raw.layout;
    let pad_x = s.prefs.raw.font.pad_x;
    let pad_y = s.prefs.raw.font.pad_y;

    let (cols_n, rows_n) = layout.grid(s.panes.len());
    let mut rows_els = Vec::with_capacity(rows_n);

    for r_idx in 0..rows_n {
        let mut row_panes = Vec::with_capacity(cols_n);
        for c_idx in 0..cols_n {
            let idx = r_idx * cols_n + c_idx;
            if let Some(pane) = s.panes.get(idx) {
                let is_active = idx == s.active;
                // Pane `idx` may carry its own ink, palette and cell metrics.
                let lk = s.look(idx);
                let style = lk.style;
                let palette = lk.palette;
                let cell_w = lk.cell_w;
                let cell_h = lk.cell_h;
                let accent = lk.accent;
                cx.foreground(palette.fg);
                let mut cache = pane.rows_cache.borrow_mut();
                let grid_rows = sync_rows(
                    pane.parser.screen(),
                    style,
                    palette,
                    is_active,
                    &mut cache,
                );
                let pane_idx = pane.id;

                let header = row()
                    .key(format!("hdr-{pane_idx}"))
                    .w_full()
                    .h(HEADER_H)
                    .px(8.0)
                    .align(rune::Align::Center)
                    .gap(6.0)
                    .fill(if is_active { c.header_active_bg } else { c.header_bg })
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
                            .color(if is_active { lk.text } else { lk.text_dim }),
                    )
                    .child(rune::spacer())
                    .child(
                        text(format!("{}x{}", pane.cols, pane.rows))
                            .font(type_::MONO_CAPTION)
                            .color(lk.text_dim),
                    );

                let viewport = el()
                    .key(format!("vp-{pane_idx}"))
                    .w_full()
                    .min_w(0.0)
                    .grow(1.0)
                    .min_h(0.0)
                    .padding(pad_y)
                    .px(pad_x)
                    .fill(palette.bg)
                    .on_layout(move |st: &mut AppState, rect: [f32; 4]| {
                        let inner_w = (rect[2] - pad_x * 2.0).max(cell_w * 16.0);
                        let inner_h = (rect[3] - pad_y * 2.0).max(cell_h * 4.0);
                        let new_cols = (inner_w / cell_w).floor() as u16;
                        let new_rows = (inner_h / cell_h).floor() as u16;
                        if let Some(p) = st.panes.get_mut(pane_idx) {
                            p.resize(new_cols, new_rows);
                        }
                    })
                    .child(
                        grid(pane.cols, cell_w, cell_h, grid_rows)
                            .key(format!("grid-{pane_idx}"))
                            .min_w(0.0)
                            .w(pane.cols as f32 * cell_w)
                            .h(pane.rows as f32 * cell_h),
                    );

                let mut card = col()
                    .key(format!("pane-{pane_idx}"))
                    .grow(1.0)
                    .min_w(0.0)
                    .h_full()
                    .min_h(0.0)
                    .radius(6.0)
                    .clip_rounded(6.0)
                    .border(
                        if is_active { 1.5 } else { 1.0 },
                        if is_active { accent } else { c.border_idle },
                    )
                    .fill(palette.bg)
                    .focusable(true)
                    .on_press(move |st: &mut AppState| {
                        st.active = pane_idx;
                    });
                if layout.header {
                    card = card.child(header);
                }
                row_panes.push(card.child(viewport));
            }
        }
        rows_els.push(
            row()
                .key(format!("grid-row-{r_idx}"))
                .w_full()
                .min_w(0.0)
                .grow(1.0)
                .min_h(0.0)
                .gap(layout.gap)
                .children(row_panes),
        );
    }

    let active_info = s
        .panes
        .get(s.active)
        .map(|p| format!("{} · {}x{} · {} B", p.title, p.cols, p.rows, p.bytes_in))
        .unwrap_or_default();
    let origin = match (&s.prefs_path, &s.prefs_error) {
        (_, Some(err)) => format!("prefs error: {err}"),
        (Some(path), None) => format!("prefs: {}", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()),
        (None, None) => "prefs: built-in".to_string(),
    };
    let error_shown = s.prefs_error.is_some();
    let hint = s.prefs_note.clone().unwrap_or_else(|| {
        format!("{} focus · {} next", s.prefs.keys.reload, s.prefs.keys.next_pane)
    });

    let status = row()
        .key("status-bar")
        .w_full()
        .h(STATUS_H)
        .px(8.0)
        .align(rune::Align::Center)
        .gap(12.0)
        .fill(c.header_bg)
        .radius(4.0)
        .child(
            text(format!(
                "Kolux Rune Terminal Spike · {} pane{}",
                s.panes.len(),
                if s.panes.len() == 1 { "" } else { "s" }
            ))
            .font(type_::LABEL)
            .color(c.text),
        )
        .child(text(active_info).font(type_::MONO_CAPTION).color(c.text_dim))
        .child(rune::spacer())
        .child(
            text(origin)
                .font(type_::MONO_CAPTION)
                .color(if error_shown { rgb(248, 113, 113) } else { c.text_dim }),
        )
        .child(text(hint).font(type_::LABEL).color(c.text_dim));

    let mut root = col()
        .key("root")
        .w_full()
        .h_full()
        .padding(layout.outer_pad)
        .gap(layout.gap)
        .fill(c.app_bg)
        .child(
            col()
                .key("pane-grid")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .gap(layout.gap)
                .children(rows_els),
        );
    if layout.status_bar {
        root = root.child(status);
    }
    root
}

/// The smallest possible app: no poll, no pty, no panes. Used to attribute the headless memory
/// growth to Rune's own loop rather than to this app's frame work.
fn bare_view(_s: &AppState, _cx: &mut Cx<AppState>) -> El {
    col()
        .key("root")
        .w_full()
        .h_full()
        .fill(rgb(11, 13, 16))
        .child(row().key("bare-bar").w_full().h(24.0).fill(rgb(22, 25, 31)))
        .child(text("bare").font(type_::LABEL).color(rgb(241, 245, 249)))
}

/// `--scene N` sets the pane count only when no preferences file was given: a file owns its own
/// pane count, so a user's layout is never overridden by a flag.
fn set_scene_panes(s: &mut AppState, n: usize) {
    if !s.prefs_locked {
        s.prefs.raw.layout.panes = n;
        s.refresh_looks();
    }
}

fn scene1(s: &mut AppState) {
    set_scene_panes(s, 1);
}

fn scene4(s: &mut AppState) {
    set_scene_panes(s, 4);
}

fn scene8(s: &mut AppState) {
    set_scene_panes(s, 8);
}

fn main() {
    if std::env::args().any(|a| a == "--bare") {
        rune::run(AppSpec::<AppState> {
            scenes: &[("1", scene1)],
            families: ("Inter", "ui-monospace"),
            ..AppSpec::new("Rune Bare Spike", (1440.0, 900.0), AppState::default, bare_view)
        });
        return;
    }
    rune::run(AppSpec::<AppState> {
        scenes: &[("1", scene1), ("4", scene4), ("8", scene8)],
        families: ("Inter", "ui-monospace"),
        setup: Some(spawn_panes),
        poll: Some(poll_pty),
        on_key: Some(on_key),
        ..AppSpec::new("Kolux Rune Terminal Spike", (1440.0, 900.0), AppState::default, view)
    });
}
