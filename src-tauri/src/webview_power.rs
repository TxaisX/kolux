//! APP-017 (DT-C236): the main web view is told when the window is out of sight. wry never passes a
//! minimise on to the engine (wry-0.57.1 webview2/mod.rs:1333 skips SIZE_MINIMIZED) and Tauri's hide
//! and show touch the window only (tauri-runtime-wry lib.rs:3380), so until now `document.hidden`
//! never turned true while Kolux sat minimised or in the tray: APP-017's hold (src/recovery/hidden.ts),
//! the off-screen trickle (src/terminal/frame.ts) and the beat skip never engaged. Microsoft's own
//! guidance is to set the controller's IsVisible false on minimise and true on restore.
//!
//! Second step (perf): a view that has been out of sight for `MEMORY_LOW_AFTER` is asked to give
//! memory back (ICoreWebView2_19::SetMemoryUsageTargetLevel LOW); scripts keep running, so the 2 s
//! heartbeat and the status timers are untouched. NORMAL again the moment the window is back.
//!
//! The white flash Tauri met when it synced controller visibility (tauri PR #9246, reverted in #9465)
//! comes from the engine's default background, which is white until the page paints: the page sends
//! its own background (`window_background`) and the controller's default background takes it, so a
//! frame the page has not painted yet shows the theme colour. Not TrySuspend: that would stop the
//! page's scripts, which the heartbeat and the status timers need (and the two must not mix).
//!
//! The model (`Sight`) is pure, so the order of calls under minimise, tray hide, restore and focus
//! is tested without a window. Every call is idempotent: a show while shown and a hide while hidden
//! do nothing, so the resize events Windows sends during a drag cost nothing.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long the window stays out of sight before the view is asked to give memory back.
pub const MEMORY_LOW_AFTER: Duration = Duration::from_secs(60);

/// What the engine is told.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Step {
    /// ICoreWebView2Controller::IsVisible.
    Visible(bool),
    /// ICoreWebView2_19::MemoryUsageTargetLevel LOW.
    MemoryLow,
    /// ICoreWebView2_19::MemoryUsageTargetLevel NORMAL.
    MemoryNormal,
}

/// Whether the main window is in sight, and what the engine has been told so far.
#[derive(Debug, Default)]
pub struct Sight {
    hidden_since: Option<Instant>,
    low: bool,
    /// Counts hides, so a memory timer started by an older hide does nothing after a show.
    generation: u64,
}

impl Sight {
    /// The window went out of sight (minimised, or hidden to the tray).
    pub fn hide(&mut self, now: Instant) -> Vec<Step> {
        if self.hidden_since.is_some() {
            return Vec::new();
        }
        self.hidden_since = Some(now);
        self.generation += 1;
        vec![Step::Visible(false)]
    }

    /// The window is back (restored, shown or focused).
    pub fn show(&mut self) -> Vec<Step> {
        if self.hidden_since.take().is_none() {
            return Vec::new();
        }
        self.generation += 1;
        let mut steps = vec![Step::Visible(true)];
        if std::mem::take(&mut self.low) {
            steps.push(Step::MemoryNormal);
        }
        steps
    }

    /// The memory timer fired: LOW once the window has been out of sight for `MEMORY_LOW_AFTER`,
    /// and only for the hide that started the timer.
    pub fn tick(&mut self, generation: u64, now: Instant) -> Option<Step> {
        let since = self.hidden_since?;
        if generation != self.generation || self.low || now.duration_since(since) < MEMORY_LOW_AFTER {
            return None;
        }
        self.low = true;
        Some(Step::MemoryLow)
    }

    #[cfg(test)]
    pub fn hidden(&self) -> bool {
        self.hidden_since.is_some()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}

static SIGHT: Mutex<Sight> = Mutex::new(Sight { hidden_since: None, low: false, generation: 0 });

/// The main window went out of sight: the engine learns it now, and after `MEMORY_LOW_AFTER` the view
/// is asked to give memory back if the window is still away.
pub fn main_hidden(app: &AppHandle) {
    let (steps, generation) = match SIGHT.lock() {
        Ok(mut s) => (s.hide(Instant::now()), s.generation()),
        Err(_) => return,
    };
    if steps.is_empty() {
        return;
    }
    apply(app, &steps);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(MEMORY_LOW_AFTER);
        let step = SIGHT.lock().ok().and_then(|mut s| s.tick(generation, Instant::now()));
        if let Some(step) = step {
            apply(&app, &[step]);
        }
    });
}

/// The main window is back in sight: the engine learns it before the first frame, and memory is normal again.
pub fn main_shown(app: &AppHandle) {
    let steps = match SIGHT.lock() {
        Ok(mut s) => s.show(),
        Err(_) => return,
    };
    if !steps.is_empty() {
        apply(app, &steps);
    }
}

fn apply(app: &AppHandle, steps: &[Step]) {
    let Some(w) = app.get_webview_window("main") else { return };
    let steps = steps.to_vec();
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| {
        for step in steps {
            imp::apply(&pw.controller(), step);
        }
    });
    #[cfg(not(windows))]
    let _ = (w, steps);
}

/// The page's own background, as the page reports it (`window_background`): the engine's default
/// background takes it, so a frame the page has not painted yet (right after a restore) shows the
/// theme colour and never white. None keeps the view transparent, for the blurred-window look.
#[tauri::command]
pub fn window_background(app: AppHandle, rgb: Option<[u8; 3]>) {
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::background(&pw.controller(), rgb));
    #[cfg(not(windows))]
    let _ = (w, rgb);
}

#[cfg(windows)]
mod imp {
    use super::Step;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;

    pub fn apply(controller: &ICoreWebView2Controller, step: Step) {
        match step {
            Step::Visible(on) => {
                // SAFETY: SetIsVisible takes a plain bool; the controller lives as long as the view.
                let _ = unsafe { controller.SetIsVisible(on) };
            }
            Step::MemoryLow | Step::MemoryNormal => {
                // SAFETY: CoreWebView2 hands back the page's engine; the level is a plain enum.
                let Ok(core) = (unsafe { controller.CoreWebView2() }).and_then(|c| c.cast::<ICoreWebView2_19>()) else { return };
                let level = if step == Step::MemoryLow { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                let _ = unsafe { core.SetMemoryUsageTargetLevel(level) };
            }
        }
    }

    /// As wry's own set_background_color (wry-0.57.1 webview2/mod.rs:1984): opaque for a colour,
    /// alpha 0 for none (the transparent window's default).
    pub fn background(controller: &ICoreWebView2Controller, rgb: Option<[u8; 3]>) {
        let Ok(c2) = controller.cast::<ICoreWebView2Controller2>() else { return };
        let colour = match rgb {
            Some([r, g, b]) => COREWEBVIEW2_COLOR { A: 255, R: r, G: g, B: b },
            None => COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 },
        };
        // SAFETY: the colour is passed by value.
        let _ = unsafe { c2.SetDefaultBackgroundColor(colour) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_perf_webview_hide_tells_the_engine_once_and_show_undoes_it() {
        let t0 = Instant::now();
        let mut s = Sight::default();
        assert_eq!(s.show(), vec![], "a show while shown is nothing");
        assert_eq!(s.hide(t0), vec![Step::Visible(false)]);
        assert_eq!(s.hide(t0 + Duration::from_secs(1)), vec![], "a second hide (tray after minimise) is nothing");
        assert!(s.hidden());
        assert_eq!(s.show(), vec![Step::Visible(true)]);
        assert!(!s.hidden());
        assert_eq!(s.show(), vec![], "the resize events of a drag cost nothing");
    }

    #[test]
    fn t_perf_webview_memory_goes_low_after_a_minute_away_and_normal_on_show() {
        let t0 = Instant::now();
        let mut s = Sight::default();
        s.hide(t0);
        let g = s.generation();
        assert_eq!(s.tick(g, t0 + Duration::from_secs(59)), None, "not yet");
        assert_eq!(s.tick(g, t0 + MEMORY_LOW_AFTER), Some(Step::MemoryLow));
        assert_eq!(s.tick(g, t0 + Duration::from_secs(120)), None, "low once");
        assert_eq!(s.show(), vec![Step::Visible(true), Step::MemoryNormal]);
    }

    #[test]
    fn t_perf_webview_a_timer_from_an_older_hide_does_nothing() {
        let t0 = Instant::now();
        let mut s = Sight::default();
        s.hide(t0);
        let old = s.generation();
        s.show();
        assert_eq!(s.tick(old, t0 + MEMORY_LOW_AFTER), None, "shown again: nothing");
        s.hide(t0 + Duration::from_secs(5));
        assert_eq!(s.tick(old, t0 + Duration::from_secs(120)), None, "the old hide's timer is stale");
        assert_eq!(s.tick(s.generation(), t0 + Duration::from_secs(120)), Some(Step::MemoryLow));
        assert_eq!(s.show(), vec![Step::Visible(true), Step::MemoryNormal]);
        assert_eq!(s.show(), vec![]);
    }
}
