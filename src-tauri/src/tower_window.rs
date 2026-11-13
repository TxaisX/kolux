//! Rows 955 / 959: the Tower's own window (T-546-c) is built here, in Rust, with the browser
//! arguments the main window and the tabs carry. Built from the page (`new WebviewWindow`), it
//! passed none, WebView2 got wry's defaults for a second environment on the default data folder
//! and refused it (0x8007139F).

use serde::Deserialize;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// The window's label; capabilities/tower.json grants its permissions by this name.
pub const LABEL: &str = "tower";
/// The app's own page, with the hash main.tsx draws only the Tower for.
const PAGE: &str = "index.html#tower-window";
const TITLE: &str = "Kolux Tower";

/// Where the page wants the window, in logical pixels (what ownWindow.ts works out from the monitors).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub center: bool,
    #[serde(default)]
    pub maximized: bool,
}

/// What the builder is told: a corner only when both coordinates came, centred when asked and no corner.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Layout {
    corner: Option<(f64, f64)>,
    center: bool,
    size: (f64, f64),
    maximized: bool,
}

fn layout(p: Place) -> Layout {
    let corner = p.x.zip(p.y);
    Layout { corner, center: p.center && corner.is_none(), size: (p.width.clamp(200.0, 16000.0), p.height.clamp(150.0, 16000.0)), maximized: p.maximized }
}

/// Opens the Tower window; an error when one is already open or the toolkit refuses.
#[tauri::command]
pub async fn tower_window_open(app: AppHandle, place: Place) -> Result<(), String> {
    let l = layout(place);
    let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App(PAGE.into()))
        .title(TITLE)
        .focused(true)
        .inner_size(l.size.0, l.size.1)
        // Same string as the main window and the tabs, or the engine refuses this one.
        .additional_browser_args(&crate::resources::recovery::browser_args_now());
    if let Some((x, y)) = l.corner {
        b = b.position(x, y);
    }
    if l.center {
        b = b.center();
    }
    if l.maximized {
        b = b.maximized(true);
    }
    b.build().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(x: Option<f64>, y: Option<f64>, center: bool, maximized: bool) -> Place {
        Place { x, y, width: 1920.0, height: 1080.0, center, maximized }
    }

    #[test]
    fn row959_a_second_screen_places_the_window_at_its_corner_maximised() {
        let l = layout(place(Some(-1920.0), Some(0.0), false, true));
        assert_eq!((l.corner, l.center, l.maximized, l.size), (Some((-1920.0, 0.0)), false, true, (1920.0, 1080.0)));
    }

    #[test]
    fn row959_one_screen_centres_it_and_a_lone_coordinate_is_no_corner() {
        let l = layout(Place { width: 1200.0, height: 800.0, ..place(None, None, true, false) });
        assert_eq!((l.corner, l.center, l.maximized), (None, true, false));
        assert_eq!(layout(place(Some(5.0), None, false, false)).corner, None);
        assert!(!layout(place(Some(5.0), Some(6.0), true, false)).center, "a corner wins over centring");
    }

    #[test]
    fn row959_the_size_stays_sane() {
        let l = layout(Place { width: -5.0, height: f64::MAX, ..place(None, None, true, false) });
        assert_eq!(l.size, (200.0, 16000.0));
    }

    #[test]
    fn row959_the_label_and_page_match_the_capability_and_the_page_that_draws_the_tower() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let cap: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("capabilities/tower.json")).unwrap()).unwrap();
        assert_eq!(cap["windows"], serde_json::json!([LABEL]));
        let own = std::fs::read_to_string(root.join("../src/tower/ownWindow.ts")).unwrap();
        assert!(own.contains(&format!("TOWER_LABEL = \"{LABEL}\"")) && own.contains(&format!("TOWER_HASH = \"#{}\"", PAGE.split('#').nth(1).unwrap())));
        assert!(PAGE.starts_with("index.html#"));
    }
}
