//! EDIT-024 (T-316-b): running a Jupyter notebook cell with Python, behind a trust prompt. A notebook is
//! trusted by the user's say-so, once per file; an untrusted one never runs, and the check is made here,
//! not only in the window. Each run starts a fresh interpreter (`python -I -X utf8 -`) with the cell's text on
//! standard input, so no state survives between cells (DT-C81). The run has a time ceiling, a cap on what it
//! may print, no Kolux secrets in its environment, and an interpreter that is never taken from the notebook's
//! own folder. This file never writes the notebook: the window saves, and shows the outputs it is handed.

use serde::Serialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

type Store<'a> = tauri::State<'a, Mutex<crate::state::Store>>;

/// The Store key that holds the trusted notebooks: a JSON list of absolute paths.
const KEY: &str = "notebooks.trusted";
/// How long one cell may run before it is stopped.
const RUN_LIMIT: Duration = Duration::from_secs(60);
/// The most one stream (standard output or standard error) keeps of what a cell prints.
const OUT_CAP: usize = 1024 * 1024;
/// A notebook file or one cell's text bigger than this is not run.
const FILE_MAX: u64 = 64 * 1024 * 1024;
const SOURCE_MAX: usize = 4 * 1024 * 1024;
/// How long to wait for the output pipes to close once the program has ended.
const PIPE_WAIT: Duration = Duration::from_secs(2);
/// The most notebooks the trust list keeps; a new one past this drops the oldest.
const TRUSTED_MAX: usize = 500;

#[derive(Serialize, Debug)]
pub struct RunResult {
    pub outputs: Vec<Value>,
    pub execution_count: u32,
}

// ---- which notebook: one spelling per file ------------------------------------------------------------------

/// `\\?\C:\x` as `C:\x` and `\\?\UNC\h\s` as `\\h\s`, so one file has one spelling in the trust list
/// whichever way it was asked for. Any other path is left alone.
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

/// What two spellings of one path are compared by: the plain form with one slash style. The case is kept
/// exact: both sides come from `canonicalize`, which gives the real on-disk case, and a folder can be
/// case-sensitive on Windows, where `A.ipynb` and `a.ipynb` are two files.
fn key(p: &Path) -> String {
    let s = plain(p).to_string_lossy().to_string();
    if cfg!(windows) { s.replace('/', "\\") } else { s }
}

/// `key` with Windows' case blindness, for asking whether a folder is below another. Never for trust.
fn fold(p: &Path) -> String {
    if cfg!(windows) { key(p).to_lowercase() } else { key(p) }
}

/// The real file a path names: `..`, links, another case or slash spelling all resolved. Only an
/// existing file whose own name ends in .ipynb counts, so no other file can be trusted or run.
fn real_notebook(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') {
        return Err("That is not a notebook file.".into());
    }
    let real = std::fs::canonicalize(path).map_err(|_| "That notebook file could not be found.".to_string())?;
    let named = real.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("ipynb"));
    if !real.is_file() || !named {
        return Err("Only an existing .ipynb file can be trusted or run.".into());
    }
    Ok(real)
}

// ---- the trust list -------------------------------------------------------------------------------------------

fn listed(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|r| serde_json::from_str::<Vec<String>>(r).ok()).unwrap_or_default()
}

fn is_listed(raw: Option<&str>, real: &Path) -> bool {
    let want = key(real);
    listed(raw).iter().any(|p| key(Path::new(p)) == want)
}

/// The list with `real` added (once). Past `TRUSTED_MAX` entries the oldest is dropped.
// ponytail: no way to untrust yet; revoking comes with a settings list of trusted notebooks.
fn with_listed(raw: Option<&str>, real: &Path) -> String {
    let mut all = listed(raw);
    if !is_listed(raw, real) {
        all.push(plain(real).to_string_lossy().to_string());
        let extra = all.len().saturating_sub(TRUSTED_MAX);
        all.drain(..extra);
    }
    serde_json::to_string(&all).unwrap_or_else(|_| "[]".into())
}

fn lock(store: &Mutex<crate::state::Store>) -> std::sync::MutexGuard<'_, crate::state::Store> {
    store.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Whether the user said this notebook may run. Anything that cannot be read or resolved is untrusted.
#[tauri::command(async)]
pub fn notebook_trusted(path: String, store: Store<'_>) -> bool {
    let Ok(real) = real_notebook(&path) else { return false };
    let raw = lock(&store).get(KEY).ok().flatten();
    is_listed(raw.as_deref(), &real)
}

/// The user's yes: this notebook file may run its cells.
#[tauri::command(async)]
pub fn notebook_trust(path: String, store: Store<'_>) -> Result<(), String> {
    let real = real_notebook(&path)?;
    let store = lock(&store);
    let raw = store.get(KEY).map_err(|_| "Trust could not be read, so nothing was saved.".to_string())?;
    store.set(KEY, &with_listed(raw.as_deref(), &real)).map_err(|_| "Trust could not be saved.".to_string())
}

/// Whether a cell is running now: one at a time for the whole app.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// T-713 (DT-C149): set by the cell's Stop button; the running cell's wait loop sees it and ends the run.
static STOP: AtomicBool = AtomicBool::new(false);
/// What a stopped cell shows, told apart from the time ceiling's message.
const STOPPED: &str = "The cell was stopped.";

/// Stops the running cell, if there is one; with none running it does nothing, so a late press cannot stop
/// the next run. A press while the notebook is still being saved, before Python starts, is not kept.
#[tauri::command]
pub fn notebook_stop() {
    if RUNNING.load(Ordering::Acquire) {
        STOP.store(true, Ordering::Release);
    }
}

/// Held for the length of one run; dropping it (on any path out, a panic included) frees the slot.
struct RunGuard;

impl RunGuard {
    fn take() -> Option<RunGuard> {
        RUNNING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| RunGuard)
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::Release);
    }
}

/// Runs one code cell. `notebook_trusted` is checked again here: the window's yes is not the guard.
/// Only one cell runs at a time; a second asked for meanwhile is refused before anything is read or started.
/// An async command that does the waiting on a blocking thread, so a 60 s run never holds a runtime thread.
#[tauri::command]
pub async fn notebook_run_cell(app: tauri::AppHandle, path: String, index: usize) -> Result<RunResult, String> {
    use tauri::Manager;
    let guard = RunGuard::take().ok_or("Another cell is still running.")?;
    STOP.store(false, Ordering::Release);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let store = app.state::<Mutex<crate::state::Store>>();
        let trusted = |real: &Path| {
            let raw = lock(&store).get(KEY).ok().flatten();
            is_listed(raw.as_deref(), real)
        };
        run_cell_in(&path, index, &trusted, &Setup { path_var: std::env::var_os("PATH"), limit: RUN_LIMIT, cap: OUT_CAP, stop: &STOP })
    })
    .await
    .map_err(|_| "The run stopped unexpectedly.".to_string())?
}

// ---- the run ----------------------------------------------------------------------------------------------------

struct Setup<'a> {
    path_var: Option<OsString>,
    limit: Duration,
    cap: usize,
    /// Set from outside to end the run early (the Stop button).
    stop: &'a AtomicBool,
}

/// The whole run, with the trust list, the PATH and the limits handed in so a test can drive it.
fn run_cell_in(path: &str, index: usize, trusted: &dyn Fn(&Path) -> bool, setup: &Setup) -> Result<RunResult, String> {
    let real = real_notebook(path)?;
    if !trusted(&real) {
        return Err("This notebook is not trusted, so its cells were not run.".into());
    }
    let (source, count) = read_cell(&real, index)?;
    let dir = plain(real.parent().ok_or("That notebook has no folder.")?);
    let python = pick_python(setup.path_var.clone(), &dir).ok_or("No Python found. Install Python and make sure it is on the PATH.")?;
    let ran = run_python(&python, &source, &dir, setup.limit, setup.cap, setup.stop)?;
    Ok(RunResult { outputs: outputs_of(&ran, setup.limit), execution_count: count })
}

/// The text of code cell `index`, and the run number it gets: one more than any the notebook shows.
fn read_cell(file: &Path, index: usize) -> Result<(String, u32), String> {
    let size = std::fs::metadata(file).map_err(|_| "That notebook could not be read.".to_string())?.len();
    if size > FILE_MAX {
        return Err("That notebook is too large to run a cell from.".into());
    }
    let bytes = std::fs::read(file).map_err(|_| "That notebook could not be read.".to_string())?;
    let nb: Value = serde_json::from_slice(&bytes).map_err(|_| "That file is not valid notebook JSON.".to_string())?;
    let cells = nb["cells"].as_array().ok_or("That file has no list of cells.")?;
    let cell = cells.get(index).ok_or_else(|| format!("There is no cell number {}.", index.saturating_add(1)))?;
    if cell["cell_type"].as_str() != Some("code") {
        return Err(format!("Cell {} is not a code cell, so it cannot run.", index.saturating_add(1)));
    }
    let source = match &cell["source"] {
        Value::String(s) => s.clone(),
        Value::Array(lines) => lines.iter().filter_map(Value::as_str).collect::<String>(),
        _ => String::new(),
    };
    if source.len() > SOURCE_MAX {
        return Err(format!("Cell {} is too large to run.", index.saturating_add(1)));
    }
    let last = cells.iter().filter_map(|c| c["execution_count"].as_u64()).max().unwrap_or(0);
    Ok((source, u32::try_from(last.saturating_add(1)).unwrap_or(u32::MAX)))
}

// ---- the interpreter ------------------------------------------------------------------------------------------

/// A Windows Store alias (`...\WindowsApps\python.exe`) is a stub that opens the Store when no Python is
/// installed through it, so a real install on the PATH goes first.
fn is_store_alias(p: &Path) -> bool {
    fold(p).replace('\\', "/").contains("/windowsapps/")
}

/// On Windows only a real program (.exe or .com) is run: `Command::new` on a .bat or .cmd goes through
/// cmd.exe, which `files::find_program` still offers. Elsewhere any file will do.
fn is_direct_program(p: &Path) -> bool {
    !cfg!(windows) || p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("com"))
}

/// The interpreter to run: an absolute file found on the PATH's absolute folders (`files::find_program`
/// drops a relative one such as "."), never one in the notebook's folder or below it, which is where a
/// downloaded notebook can plant a `python.exe`. `None` when there is none.
fn pick_python(path_var: Option<OsString>, notebook_dir: &Path) -> Option<PathBuf> {
    let below = PathBuf::from(fold(notebook_dir));
    let dirs: Vec<PathBuf> = path_var
        .map(|v| std::env::split_paths(&v).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|d| d.is_absolute())
        .filter(|d| !PathBuf::from(fold(&std::fs::canonicalize(d).unwrap_or_else(|_| d.clone()))).starts_with(&below))
        .collect();
    let names: &[&str] = if cfg!(windows) { &["python3", "python", "py"] } else { &["python3", "python"] };
    let found: Vec<PathBuf> = names
        .iter()
        .flat_map(|n| dirs.iter().filter_map(move |d| crate::files::find_program(n, Some(d.clone().into_os_string()))))
        .filter(|p| p.is_absolute() && is_direct_program(p))
        .collect();
    found.iter().find(|p| !is_store_alias(p)).or_else(|| found.first()).cloned()
}

// ---- the process --------------------------------------------------------------------------------------------------

#[derive(Default)]
struct Capture {
    bytes: Vec<u8>,
    cut: bool,
}

struct Ran {
    out: Capture,
    err: Capture,
    code: Option<i32>,
    timed_out: bool,
    stopped: bool,
}

/// Reads `r` in chunks into `sink`, keeping at most `cap` bytes. Past the cap it keeps reading and drops
/// the rest, so the program is never left blocked on a full pipe and memory stays bounded.
fn drain(mut r: impl Read + Send + 'static, cap: usize, sink: Arc<Mutex<Capture>>, done: mpsc::Sender<()>) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            let n = match r.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let mut s = sink.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let room = cap.saturating_sub(s.bytes.len());
            if n > room {
                s.cut = true;
            }
            s.bytes.extend_from_slice(&chunk[..n.min(room)]);
        }
        let _ = done.send(());
    });
}

/// Starts `python -I -X utf8 -` on the absolute `python`, hands it `source` on standard input only, and
/// waits for it up to `limit` or until `halt` is set. Then the program and everything it started are ended.
fn run_python(python: &Path, source: &str, cwd: &Path, limit: Duration, cap: usize, halt: &AtomicBool) -> Result<Ran, String> {
    let mut cmd = Command::new(python);
    cmd.args(["-I", "-X", "utf8", "-"]).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // The cell must not see Kolux's own tokens (the hook endpoint's, a pane's identity, a sign-in token).
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("KOLUX_") {
            cmd.env_remove(k);
        }
    }
    cmd.env_remove(crate::claude_key::ENV);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // Its own process group, so procs::kill_tree's group signal ends the cell's children too.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Python could not be started: {e}"))?;
    // A kill-on-close job holds the program and whatever it starts, so a grandchild that detached itself
    // still ends with the run. Without one (or off Windows) `kill_tree` is the fallback.
    let job = crate::procs::Job::new().and_then(|j| j.assign_pid(child.id()).map(|()| j)).ok();
    let jobbed = cfg!(windows) && job.is_some();
    let stop = |child: &mut std::process::Child| {
        if !jobbed {
            crate::procs::kill_tree(child.id());
        }
        let _ = child.kill();
        let _ = child.wait();
    };
    let (out, err) = (Arc::new(Mutex::new(Capture::default())), Arc::new(Mutex::new(Capture::default())));
    let (tx, rx) = mpsc::channel();
    drain(child.stdout.take().expect("piped"), cap, out.clone(), tx.clone());
    drain(child.stderr.take().expect("piped"), cap, err.clone(), tx);
    let mut stdin = child.stdin.take().expect("piped");
    let text = source.as_bytes().to_vec();
    // A thread writes the text, so a program that never reads it cannot hold this one up.
    std::thread::spawn(move || {
        let _ = stdin.write_all(&text);
    });
    let deadline = Instant::now() + limit;
    let (mut code, mut timed_out, mut stopped) = (None, false, false);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                code = status.code();
                break;
            }
            Ok(None) if halt.load(Ordering::Acquire) => {
                stopped = true;
                stop(&mut child);
                break;
            }
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                // ponytail: the job object ends the cell's whole tree, detached grandchildren too, when it is dropped
                // below; with no job (or off Windows) taskkill /T or a group signal reaches only children still
                // attached to the program, and one that detached itself first is not reached.
                stop(&mut child);
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                // The program's state cannot be read: end it rather than leave it running unwatched.
                stop(&mut child);
                break;
            }
        }
    }
    drop(job);
    // Both pipes close when the program (and anything holding them) is gone; a straggler is not waited for.
    let end = Instant::now() + PIPE_WAIT;
    for _ in 0..2 {
        let _ = rx.recv_timeout(end.saturating_duration_since(Instant::now()));
    }
    let take = |c: &Arc<Mutex<Capture>>| std::mem::take(&mut *c.lock().unwrap_or_else(std::sync::PoisonError::into_inner));
    Ok(Ran { out: take(&out), err: take(&err), code, timed_out, stopped })
}

// ---- what the notebook gets back ---------------------------------------------------------------------------------

/// Text as Jupyter stores it: a list of lines, each keeping its line break.
fn lines_of(c: &Capture) -> Vec<String> {
    // Python's text layer writes CRLF on Windows; a notebook keeps plain line feeds.
    let mut text = String::from_utf8_lossy(&c.bytes).replace("\r\n", "\n");
    if c.cut {
        text.push_str("\n[Output cut: Kolux keeps the first 1 MB of each stream.]\n");
    }
    text.split_inclusive('\n').map(str::to_string).collect()
}

fn outputs_of(ran: &Ran, limit: Duration) -> Vec<Value> {
    let mut outputs = Vec::new();
    if !ran.out.bytes.is_empty() {
        outputs.push(json!({ "output_type": "stream", "name": "stdout", "text": lines_of(&ran.out) }));
    }
    let failed = ran.timed_out || ran.code != Some(0);
    if ran.stopped {
        outputs.push(json!({ "output_type": "error", "ename": "Error", "evalue": STOPPED, "traceback": [STOPPED] }));
    } else if ran.timed_out {
        let why = format!("The cell ran for more than {} seconds and was stopped.", limit.as_secs().max(1));
        outputs.push(json!({ "output_type": "error", "ename": "Error", "evalue": why, "traceback": [why] }));
    } else if failed {
        let trace: Vec<String> = String::from_utf8_lossy(&ran.err.bytes).lines().map(str::to_string).collect();
        let last = trace.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_else(|| match ran.code {
            Some(c) => format!("The cell ended with exit code {c}."),
            None => "The cell ended without an exit code.".to_string(),
        });
        outputs.push(json!({ "output_type": "error", "ename": "Error", "evalue": last, "traceback": trace }));
    } else if !ran.err.bytes.is_empty() {
        // Exit 0 with text on standard error (a warning): Jupyter shows it as a stderr stream, not an error.
        outputs.push(json!({ "output_type": "stream", "name": "stderr", "text": lines_of(&ran.err) }));
    }
    outputs
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: Duration = Duration::from_secs(30);

    fn notebook(dir: &Path, name: &str, cells: Value) -> String {
        let p = dir.join(name);
        std::fs::write(&p, serde_json::to_string(&json!({ "cells": cells, "metadata": {}, "nbformat": 4, "nbformat_minor": 5 })).unwrap()).unwrap();
        p.to_string_lossy().to_string()
    }

    fn code(source: &str) -> Value {
        json!({ "cell_type": "code", "metadata": {}, "execution_count": null, "outputs": [], "source": source })
    }

    static NEVER: AtomicBool = AtomicBool::new(false);

    fn setup(limit: Duration, cap: usize) -> Setup<'static> {
        Setup { path_var: std::env::var_os("PATH"), limit, cap, stop: &NEVER }
    }

    /// True when this PC has a Python; otherwise the test says so and skips.
    fn python_here(dir: &Path) -> bool {
        let there = pick_python(std::env::var_os("PATH"), dir).is_some();
        if !there {
            eprintln!("notebook_run: no Python on the PATH, so this test is skipped");
        }
        there
    }

    #[test]
    fn a_print_cell_gives_one_stdout_stream() {
        let d = crate::test_dir::temp("nbrun-print");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([code("print('hi')\nprint('there')")]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        assert_eq!(r.outputs, vec![json!({ "output_type": "stream", "name": "stdout", "text": ["hi\n", "there\n"] })]);
        assert_eq!(r.execution_count, 1);
    }

    #[test]
    fn a_raising_cell_gives_an_error_output_with_the_message() {
        let d = crate::test_dir::temp("nbrun-raise");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([{ "cell_type": "code", "execution_count": 4, "metadata": {}, "outputs": [], "source": ["raise ValueError('boom')"] }]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        assert_eq!(r.outputs.len(), 1);
        assert_eq!(r.outputs[0]["output_type"], "error");
        assert_eq!(r.outputs[0]["ename"], "Error");
        assert!(r.outputs[0]["evalue"].as_str().unwrap().contains("boom"));
        assert!(!r.outputs[0]["traceback"].as_array().unwrap().is_empty());
        assert_eq!(r.execution_count, 5, "one more than the highest the notebook shows");
    }

    #[test]
    fn warnings_on_stderr_with_a_clean_exit_are_a_stderr_stream() {
        let d = crate::test_dir::temp("nbrun-warn");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([code("import sys\nprint('w', file=sys.stderr)")]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        assert_eq!(r.outputs, vec![json!({ "output_type": "stream", "name": "stderr", "text": ["w\n"] })]);
    }

    #[test]
    fn an_untrusted_notebook_is_refused_before_any_process_starts() {
        let d = crate::test_dir::temp("nbrun-untrusted");
        let marker = d.join("ran.txt");
        let source = format!("open({:?}, 'w').write('x')", marker.to_string_lossy());
        let nb = notebook(&d, "a.ipynb", json!([code(&source)]));
        let err = run_cell_in(&nb, 0, &|_| false, &setup(FAST, OUT_CAP)).unwrap_err();
        assert!(err.contains("not trusted"), "{err}");
        assert!(!err.contains("open("), "the message never echoes the cell");
        assert!(!marker.exists(), "no process ran");
    }

    #[test]
    fn only_a_code_cell_at_a_real_index_runs() {
        let d = crate::test_dir::temp("nbrun-kind");
        let marker = d.join("ran.txt");
        let source = format!("open({:?}, 'w').write('x')", marker.to_string_lossy());
        let nb = notebook(&d, "a.ipynb", json!([{ "cell_type": "markdown", "metadata": {}, "source": [source.clone()] }, { "cell_type": "raw", "metadata": {}, "source": [source.clone()] }, code("pass")]));
        let md = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap_err();
        assert!(md.contains("not a code cell"), "{md}");
        assert!(!md.contains("open("), "the message never echoes the cell");
        assert!(run_cell_in(&nb, 1, &|_| true, &setup(FAST, OUT_CAP)).unwrap_err().contains("not a code cell"));
        assert!(run_cell_in(&nb, 3, &|_| true, &setup(FAST, OUT_CAP)).unwrap_err().contains("no cell number 4"));
        assert!(run_cell_in(&nb, usize::MAX, &|_| true, &setup(FAST, OUT_CAP)).is_err());
        assert!(!marker.exists(), "no process ran");
    }

    #[test]
    fn only_an_existing_ipynb_file_counts() {
        let d = crate::test_dir::temp("nbrun-names");
        std::fs::write(d.join("a.txt"), "{}").unwrap();
        std::fs::create_dir(d.join("dir.ipynb")).unwrap();
        for bad in [d.join("a.txt"), d.join("dir.ipynb"), d.join("missing.ipynb")] {
            let p = bad.to_string_lossy().to_string();
            assert!(real_notebook(&p).is_err(), "{p}");
            assert!(run_cell_in(&p, 0, &|_| true, &setup(FAST, OUT_CAP)).is_err(), "{p}");
        }
        assert!(real_notebook("").is_err());
        assert!(real_notebook("a\0.ipynb").is_err());
    }

    #[test]
    fn one_file_has_one_trust_entry_whatever_its_spelling() {
        let d = crate::test_dir::temp("nbrun-spell");
        std::fs::create_dir(d.join("sub")).unwrap();
        let nb = notebook(&d, "Note.ipynb", json!([code("pass")]));
        let plain_spelling = real_notebook(&nb).unwrap();
        let dotdot = d.join("sub").join("..").join("Note.ipynb").to_string_lossy().to_string();
        let raw = with_listed(None, &plain_spelling);
        assert!(is_listed(Some(&raw), &real_notebook(&dotdot).unwrap()), "a .. spelling is the same file");
        assert_eq!(with_listed(Some(&raw), &real_notebook(&dotdot).unwrap()), raw, "listed once");
        #[cfg(windows)]
        {
            let shout = nb.to_uppercase().replace('\\', "/");
            assert!(is_listed(Some(&raw), &real_notebook(&shout).unwrap()), "another case and slash spelling is the same file");
        }
        // The verbatim spelling and the plain one are the same entry.
        assert_eq!(key(Path::new(r"\\?\C:\Work\A.ipynb")), key(Path::new(r"C:\Work\A.ipynb")));
        let other = notebook(&d, "Other.ipynb", json!([code("pass")]));
        assert!(!is_listed(Some(&raw), &real_notebook(&other).unwrap()), "another file is not trusted");
        assert!(!is_listed(None, &plain_spelling));
        assert!(!is_listed(Some("not json"), &plain_spelling));
    }

    #[test]
    fn trust_keys_compare_the_case_exactly() {
        // Two files that differ only in case (possible in a case-sensitive folder) are two entries.
        let raw = serde_json::to_string(&[r"C:\Work\A.ipynb"]).unwrap();
        assert!(is_listed(Some(&raw), Path::new(r"C:\Work\A.ipynb")));
        assert!(!is_listed(Some(&raw), Path::new(r"C:\Work\a.ipynb")));
        assert_ne!(key(Path::new(r"C:\Work\A.ipynb")), key(Path::new(r"C:\Work\a.ipynb")));
        // Only the folder-below question folds the case.
        assert_eq!(fold(Path::new(r"C:\Work\A.ipynb")) == fold(Path::new(r"C:\Work\a.ipynb")), cfg!(windows));
    }

    #[test]
    fn the_trust_list_keeps_the_newest_500_and_never_repeats_one() {
        let d = crate::test_dir::temp("nbrun-cap500");
        let old: Vec<String> = (0..TRUSTED_MAX).map(|i| format!("/nbrun-old/n{i}.ipynb")).collect();
        let raw = serde_json::to_string(&old).unwrap();
        let nb = notebook(&d, "new.ipynb", json!([code("pass")]));
        let real = real_notebook(&nb).unwrap();
        let after = with_listed(Some(&raw), &real);
        let all = listed(Some(&after));
        assert_eq!(all.len(), TRUSTED_MAX, "still 500");
        assert_eq!(all[0], "/nbrun-old/n1.ipynb", "the oldest went");
        assert!(is_listed(Some(&after), &real), "the new one is in, last");
        assert!(!is_listed(Some(&after), Path::new("/nbrun-old/n0.ipynb")));
        // Trusting it again, or one already in the list, changes nothing.
        assert_eq!(with_listed(Some(&after), &real), after);
        let again = with_listed(Some(&after), Path::new("/nbrun-old/n1.ipynb"));
        assert_eq!(again, after);
    }

    #[test]
    fn only_one_cell_runs_at_a_time() {
        let first = RunGuard::take();
        assert!(first.is_some(), "free at the start");
        assert!(RunGuard::take().is_none(), "refused while held");
        drop(first);
        let again = RunGuard::take();
        assert!(again.is_some(), "free again after the drop");
    }

    #[test]
    fn a_batch_file_is_never_the_interpreter() {
        let d = crate::test_dir::temp("nbrun-nb");
        let elsewhere = crate::test_dir::temp("nbrun-bat");
        for n in ["python.bat", "python3.cmd", "py.bat"] {
            std::fs::write(elsewhere.join(n), "@echo off").unwrap();
        }
        let only_bat = std::env::join_paths([elsewhere.0.clone()]).unwrap();
        assert_eq!(pick_python(Some(only_bat), &d), None, "a .bat or .cmd runs through cmd.exe, so it is not chosen");
        if cfg!(windows) {
            // The same folder with a real program in it is chosen (the file is not run here).
            std::fs::write(elsewhere.join("python.EXE"), "not a program").unwrap();
            let with_exe = std::env::join_paths([elsewhere.0.clone()]).unwrap();
            let picked = pick_python(Some(with_exe), &d).unwrap();
            assert!(picked.extension().unwrap().eq_ignore_ascii_case("exe"), "{}", picked.display());
        }
    }

    #[test]
    fn a_replaced_file_stays_trusted_by_its_path() {
        // The card's model: trust belongs to the path, not the contents. A swapped file under a trusted
        // path still runs; trust is the user's say-so about where the notebook lives.
        let d = crate::test_dir::temp("nbrun-swapped");
        let nb = notebook(&d, "a.ipynb", json!([code("pass")]));
        let raw = with_listed(None, &real_notebook(&nb).unwrap());
        notebook(&d, "a.ipynb", json!([code("print(1)")]));
        assert!(is_listed(Some(&raw), &real_notebook(&nb).unwrap()));
    }

    #[test]
    fn the_interpreter_is_never_taken_from_the_notebooks_folder() {
        let d = crate::test_dir::temp("nbrun-fake");
        let fake = d.join("bin");
        std::fs::create_dir(&fake).unwrap();
        for n in ["python.exe", "python3.exe", "py.exe", "python", "python3", "python.bat", "python3.cmd"] {
            std::fs::write(fake.join(n), "not a program").unwrap();
        }
        // The notebook's own folder, and a folder below it, are on the PATH, ahead of everything, with a relative entry too.
        let real_path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs = vec![d.0.clone(), fake.clone(), PathBuf::from("."), PathBuf::from("bin")];
        dirs.extend(std::env::split_paths(&real_path));
        let path_var = std::env::join_paths(dirs).unwrap();
        let picked = pick_python(Some(path_var.clone()), &d);
        if let Some(p) = &picked {
            assert!(p.is_absolute(), "{}", p.display());
            assert!(!fold(p).starts_with(&fold(&d)), "{} is inside the notebook folder", p.display());
        }
        // With only the planted folders on the PATH there is no interpreter at all.
        let only_fake = std::env::join_paths([d.0.clone(), fake, PathBuf::from(".")]).unwrap();
        assert_eq!(pick_python(Some(only_fake), &d), None);
        assert_eq!(pick_python(None, &d), None);
        // And a whole run with the planted files in the way still uses the real one (or reports none).
        if picked.is_some() {
            let nb = notebook(&d, "a.ipynb", json!([code("print('real')")]));
            let r = run_cell_in(&nb, 0, &|_| true, &Setup { path_var: Some(path_var), limit: FAST, cap: OUT_CAP, stop: &NEVER }).unwrap();
            assert_eq!(r.outputs[0]["text"], json!(["real\n"]));
        }
    }

    #[test]
    fn a_cell_does_not_see_kolux_secrets() {
        let d = crate::test_dir::temp("nbrun-env");
        if !python_here(&d) {
            return;
        }
        std::env::set_var("KOLUX_NBRUN_TEST_TOKEN", "secret-value");
        std::env::set_var(crate::claude_key::ENV, "secret-value");
        let nb = notebook(&d, "a.ipynb", json!([code("import os\nprint(sorted(k for k in os.environ if k.upper().startswith('KOLUX_') or k == 'CLAUDE_CODE_OAUTH_TOKEN'))\nprint('PATH' in {k.upper() for k in os.environ})")]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        std::env::remove_var("KOLUX_NBRUN_TEST_TOKEN");
        std::env::remove_var(crate::claude_key::ENV);
        assert_eq!(r.outputs[0]["text"], json!(["[]\n", "True\n"]), "no Kolux variable, but PATH stays");
    }

    #[test]
    fn t713_stop_ends_a_running_cell_at_once() {
        static HALT: AtomicBool = AtomicBool::new(false);
        let d = crate::test_dir::temp("nbrun-stop");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([code("import time\ntime.sleep(120)")]));
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(500));
            HALT.store(true, Ordering::Release);
        });
        let began = Instant::now();
        let r = run_cell_in(&nb, 0, &|_| true, &Setup { stop: &HALT, ..setup(Duration::from_secs(60), OUT_CAP) }).unwrap();
        assert!(began.elapsed() < Duration::from_secs(20), "the stop took {:?}", began.elapsed());
        let last = r.outputs.last().unwrap();
        assert_eq!(last["output_type"], "error", "{:?}", r.outputs);
        assert_eq!(last["evalue"], STOPPED, "a stop is told apart from the time ceiling");
    }

    #[test]
    fn the_cell_text_goes_on_standard_input_never_on_the_command_line() {
        let d = crate::test_dir::temp("nbrun-stdin");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([code("import sys\nprint(sys.argv)\nprint('é')\nimport os\nprint(os.path.basename(os.getcwd()))")]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        assert_eq!(r.outputs[0]["text"][0], "['-']\n", "the only argument is the dash that means standard input");
        assert_eq!(r.outputs[0]["text"][1], "é\n", "UTF-8 out");
        assert!(r.outputs[0]["text"][2].as_str().unwrap().contains("nbrun-stdin"), "runs in the notebook's folder");
    }

    #[test]
    fn a_two_megabyte_print_is_capped() {
        let d = crate::test_dir::temp("nbrun-cap");
        if !python_here(&d) {
            return;
        }
        let nb = notebook(&d, "a.ipynb", json!([code("print('x' * (2 * 1024 * 1024))\nimport sys\nprint('y' * (2 * 1024 * 1024), file=sys.stderr)\nsys.exit(3)")]));
        let r = run_cell_in(&nb, 0, &|_| true, &setup(FAST, OUT_CAP)).unwrap();
        let out = r.outputs[0]["text"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().len()).sum::<usize>();
        assert!(out < OUT_CAP + 200, "stdout kept {out} bytes");
        assert!(r.outputs[0]["text"].to_string().contains("Output cut"));
        let trace = r.outputs[1]["traceback"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().len()).sum::<usize>();
        assert!(trace < OUT_CAP + 200, "stderr kept {trace} bytes");
        assert_eq!(r.outputs[1]["output_type"], "error");
    }

    #[test]
    fn the_capture_stops_reading_at_its_cap() {
        let (tx, rx) = mpsc::channel();
        let sink = Arc::new(Mutex::new(Capture::default()));
        drain(std::io::Cursor::new(vec![b'z'; 100_000]), 1000, sink.clone(), tx);
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let s = sink.lock().unwrap();
        assert_eq!((s.bytes.len(), s.cut), (1000, true));
    }

    #[test]
    fn a_cell_that_sleeps_past_the_ceiling_is_killed() {
        let d = crate::test_dir::temp("nbrun-sleep");
        if !python_here(&d) {
            return;
        }
        // The cell leaves a marker right after its print, so a try can tell "Python had not printed yet" from
        // "Python printed and the text was lost".
        let marker = d.join("printed");
        let cell = format!(
            "import time, pathlib\nprint('before', flush=True)\npathlib.Path(r'{}').touch()\ntime.sleep(120)",
            marker.display()
        );
        let nb = notebook(&d, "a.ipynb", json!([code(&cell)]));
        // T-700 (K1): a loaded CI runner can take longer than the ceiling just to start Python, and then the cell
        // is stopped before its first print. Every try must still be stopped at its own ceiling; only a try that
        // ended before the marker existed (Python had not printed) moves on to a ceiling twice as long.
        for ceiling in [5, 10, 20, 40].map(Duration::from_secs) {
            let _ = std::fs::remove_file(&marker);
            let began = Instant::now();
            let r = run_cell_in(&nb, 0, &|_| true, &setup(ceiling, OUT_CAP)).unwrap();
            let took = began.elapsed();
            assert!(took >= ceiling && took < ceiling + Duration::from_secs(20), "a {ceiling:?} ceiling took {took:?}");
            let stopped = r.outputs.last().unwrap();
            assert_eq!(stopped["output_type"], "error", "{:?}", r.outputs);
            assert!(stopped["evalue"].as_str().unwrap().contains("was stopped"), "{stopped}");
            if r.outputs.len() == 2 {
                assert_eq!(r.outputs[0]["text"], json!(["before\n"]), "what it printed first is kept");
                eprintln!("notebook_run: Python printed within the {ceiling:?} ceiling (marker {})", marker.exists());
                return;
            }
            assert_eq!(r.outputs.len(), 1, "{:?}", r.outputs);
            assert!(!marker.exists(), "Python printed within {ceiling:?} but the text was lost: {:?}", r.outputs);
            eprintln!("notebook_run: Python had not printed within {ceiling:?}, so the next try waits longer");
        }
        panic!("Python never printed within a 40 s ceiling");
    }
}
