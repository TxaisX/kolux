// T-301 (APP-012, SET-041): the app icon variant and the window background blur. The title-bar app
// name is SET-020's switch (src/chrome/chromeItems.ts), so it is not repeated here.
//
// Icons: the owner's three pictures (Classic, Watercolor, Blue) are not in the repository yet, so the
// variants are drawn at run time from the Kolux mark itself (the app's own window icon): Classic is
// the mark untouched, Blue maps its brightness onto a blue ramp, Watercolor softens it towards a
// paper white with a gentle wash. When the owner's files land they replace `variant` (after-list).
// The window icon is also the taskbar icon on Windows, so a pick changes it without a restart.
use serde_json::Value;
use tauri::image::Image;
use tauri::window::{Effect, EffectsBuilder};
use tauri::{Manager, Runtime};

/// Settings key of the icon choice: "classic", "watercolor" or "blue".
pub const ICON_FIELD: &str = "appIcon";
/// Settings key of the window background blur switch.
pub const BLUR_FIELD: &str = "windowBlur";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconChoice {
    Classic,
    Watercolor,
    Blue,
}

/// SET-041: an unknown or missing value means Classic.
pub fn icon_choice(settings: &Value) -> IconChoice {
    match settings.get(ICON_FIELD).and_then(Value::as_str) {
        Some("watercolor") => IconChoice::Watercolor,
        Some("blue") => IconChoice::Blue,
        _ => IconChoice::Classic,
    }
}

/// APP-012 / SET-041: blur is off by default; only a saved `true` turns it on.
pub fn blur_on(settings: &Value) -> bool {
    settings.get(BLUR_FIELD) == Some(&Value::Bool(true))
}

fn lerp(a: u8, b: u8, t: f32) -> u8 {
    (a as f32 + (b as f32 - a as f32) * t).round().clamp(0.0, 255.0) as u8
}

/// Rec. 601 brightness of one pixel, 0..=1.
fn luma(r: u8, g: u8, b: u8) -> f32 {
    (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32) / 255.0
}

/// The icon pixels (RGBA, row-major, `width` wide) for `choice`. Alpha is never changed, so the
/// outline of the mark stays exactly the same; Classic returns the pixels as they are.
pub fn variant(choice: IconChoice, rgba: &[u8], width: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if choice == IconChoice::Classic {
        return out;
    }
    let w = width.max(1) as usize;
    for (i, px) in out.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let l = luma(px[0], px[1], px[2]);
        match choice {
            IconChoice::Blue => {
                // Dark navy for the shadows up to a pale sky blue for the highlights.
                px[0] = lerp(0x0b, 0x9c, l);
                px[1] = lerp(0x2a, 0xd0, l);
                px[2] = lerp(0x6e, 0xff, l);
            }
            IconChoice::Watercolor => {
                // Half way to a warm paper white, then a soft diagonal wash between rose and teal.
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                let t = ((x + y) / (2.0 * w as f32)).clamp(0.0, 1.0);
                let wash = [lerp(0xe8, 0x7c, t), lerp(0x9a, 0xc4, t), lerp(0xb0, 0xc8, t)];
                for c in 0..3 {
                    let soft = lerp(px[c], 0xf6, 0.45);
                    px[c] = lerp(soft, wash[c], 0.35);
                }
            }
            IconChoice::Classic => {}
        }
    }
    out
}

/// Puts the saved choices on every window: the icon variant and, when on, the Acrylic blur
/// (cleared when off). A window that cannot take an effect (older Windows, Linux) keeps going.
pub fn apply<R: Runtime>(app: &tauri::AppHandle<R>, settings: &Value) -> Result<(), String> {
    let choice = icon_choice(settings);
    let icon = app.default_window_icon().map(|base| {
        let px = variant(choice, base.rgba(), base.width());
        Image::new_owned(px, base.width(), base.height())
    });
    let blur = blur_on(settings);
    // T-300: the tray icon follows the pick at once, its attention dot kept. Done before the
    // windows, so a window that refuses its icon or effect cannot leave the tray on the old colour.
    crate::tray::repaint(app);
    for window in app.webview_windows().values() {
        if let Some(icon) = &icon {
            window.set_icon(icon.clone()).map_err(|e| e.to_string())?;
        }
        let effects = blur.then(|| EffectsBuilder::new().effect(Effect::Acrylic).build());
        window.set_effects(effects).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// At start-up, from the saved settings (before the window is shown).
pub fn apply_saved<R: Runtime>(app: &tauri::AppHandle<R>) {
    let settings = app
        .try_state::<std::sync::Mutex<crate::state::Store>>()
        .and_then(|s| s.lock().ok().map(|s| s.settings()))
        .unwrap_or_default();
    let _ = apply(app, &settings);
}

/// The Appearance page calls this after saving either choice, so the change shows at once.
#[tauri::command]
pub fn app_look_apply(app: tauri::AppHandle) -> Result<(), String> {
    let settings = app
        .try_state::<std::sync::Mutex<crate::state::Store>>()
        .ok_or("settings are not open yet")?
        .lock()
        .map_err(|e| e.to_string())?
        .settings();
    apply(&app, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_or_missing_icon_reads_classic() {
        assert_eq!(icon_choice(&json!({})), IconChoice::Classic);
        assert_eq!(icon_choice(&json!({ "appIcon": "purple" })), IconChoice::Classic);
        assert_eq!(icon_choice(&json!({ "appIcon": 3 })), IconChoice::Classic);
        assert_eq!(icon_choice(&json!({ "appIcon": "Blue" })), IconChoice::Classic, "case matters: only the saved spelling counts");
        assert_eq!(icon_choice(&json!({ "appIcon": "classic" })), IconChoice::Classic);
        assert_eq!(icon_choice(&json!({ "appIcon": "blue" })), IconChoice::Blue);
        assert_eq!(icon_choice(&json!({ "appIcon": "watercolor" })), IconChoice::Watercolor);
    }

    #[test]
    fn blur_is_off_unless_saved_true() {
        assert!(!blur_on(&json!({})));
        assert!(!blur_on(&json!({ "windowBlur": "true" })));
        assert!(!blur_on(&json!({ "windowBlur": 1 })));
        assert!(!blur_on(&json!({ "windowBlur": false })));
        assert!(blur_on(&json!({ "windowBlur": true })));
    }

    fn sample() -> Vec<u8> {
        // 2x2: black opaque, white opaque, mid grey half transparent, red fully transparent.
        vec![0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 128, 255, 0, 0, 0]
    }

    #[test]
    fn classic_is_the_mark_untouched() {
        assert_eq!(variant(IconChoice::Classic, &sample(), 2), sample());
    }

    #[test]
    fn variants_keep_alpha_and_size() {
        for c in [IconChoice::Blue, IconChoice::Watercolor] {
            let out = variant(c, &sample(), 2);
            assert_eq!(out.len(), sample().len());
            let alpha: Vec<u8> = out.chunks(4).map(|p| p[3]).collect();
            assert_eq!(alpha, vec![255, 255, 128, 0], "{c:?} must keep the mark's outline");
            assert_ne!(out, sample(), "{c:?} must change the colours");
        }
    }

    #[test]
    fn blue_is_blue_from_shadow_to_highlight() {
        let out = variant(IconChoice::Blue, &sample(), 2);
        for p in out.chunks(4).take(3) {
            assert!(p[2] > p[0] && p[2] > p[1], "blue dominates in {p:?}");
        }
        assert!(out[4..7].iter().zip(&out[0..3]).all(|(hi, lo)| hi > lo), "highlights stay lighter than shadows");
    }

    #[test]
    fn watercolor_softens_towards_paper() {
        let out = variant(IconChoice::Watercolor, &sample(), 2);
        assert!(out[0] > 80 && out[1] > 80 && out[2] > 80, "pure black is lifted: {:?}", &out[0..3]);
        assert!(out[4] < 255 || out[5] < 255 || out[6] < 255, "pure white takes the wash");
    }

    #[test]
    fn odd_lengths_and_zero_width_do_not_panic() {
        assert_eq!(variant(IconChoice::Blue, &[1, 2, 3], 0), vec![1, 2, 3]);
        assert!(variant(IconChoice::Watercolor, &[], 0).is_empty());
    }
}
