//! Diagnostic: does Kolux's PtySession deliver a real shell's output to a plain callback, and does
//! answering the console host's cursor-position query (ESC[6n) unblock it?
//! Run: cargo run --example pty_probe
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kolux_lib::pty::{PtySession, SharedWriter, shell_commands, write_shared};

fn main() {
    let got: Arc<Mutex<Vec<u8>>> = Arc::default();
    let chunks: Arc<Mutex<Vec<(f64, usize, Vec<u8>)>>> = Arc::default();
    let answer = Arc::new(Mutex::new(None::<SharedWriter>));
    let (g, c, a) = (got.clone(), chunks.clone(), answer.clone());
    let start = Instant::now();

    let mut list = shell_commands(None, None);
    for cmd in &mut list {
        let prog = cmd.get_argv().first().map(|a| a.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if prog.ends_with("pwsh.exe") || prog.ends_with("powershell.exe") {
            cmd.arg("-NoProfile");
        }
        cmd.env("TERM", "xterm-256color");
    }
    println!("commands: {:?}", list.iter().map(|c| c.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>()).collect::<Vec<_>>());

    let session = PtySession::spawn_first(
        list,
        80,
        24,
        move |bytes| {
            {
                let mut c = c.lock().unwrap();
                if c.len() < 12 {
                    c.push((start.elapsed().as_secs_f64() * 1000.0, bytes.len(), bytes.to_vec()));
                }
            }
            g.lock().unwrap().extend_from_slice(bytes);
            // A terminal answers the host's cursor-position query; otherwise the host waits forever.
            if bytes.windows(4).any(|w| w == b"\x1b[6n") {
                if let Some(w) = a.lock().unwrap().as_ref() {
                    let _ = write_shared(w, b"\x1b[1;1R");
                }
            }
        },
        |code| println!("exit {:?}", code),
    );
    let session = match session {
        Ok(s) => s,
        Err(e) => {
            println!("spawn failed: {e}");
            return;
        }
    };
    *answer.lock().unwrap() = session.writer().ok();
    println!("spawned {} pid={:?}", session.program(), session.pid());

    std::thread::sleep(Duration::from_millis(2500));
    let first: Vec<u8> = got.lock().unwrap().clone();
    println!("total bytes after 2.5s: {}", first.len());
    for (ms, n, bytes) in chunks.lock().unwrap().iter() {
        let view: String = bytes.iter().take(120).map(|b| if b.is_ascii_graphic() || *b == b'\r' || *b == b'\n' { *b as char } else { '.' }).collect();
        println!("  @{ms:8.1}ms {n:6} B  {view}");
        println!("     hex: {}", bytes.iter().take(40).map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" "));
    }

    let writer = session.writer().unwrap();
    let before = got.lock().unwrap().len();
    write_shared(&writer, b"echo MARKER-42\r").unwrap();
    std::thread::sleep(Duration::from_millis(1500));
    let after: Vec<u8> = got.lock().unwrap().clone();
    println!("after typing: {} new bytes (total {})", after.len() - before, after.len());
    let tail = String::from_utf8_lossy(&after[after.len().saturating_sub(400)..]).to_string();
    println!("tail: {:?}", tail);
    println!("MARKER found: {}", tail.contains("MARKER-42"));
}
