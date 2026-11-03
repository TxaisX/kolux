// USAGE-009: the usage alerts the window decides on go out as system notifications. The record of
// which threshold already fired, tied to each window's reset time, lives in state.db so a restart
// does not repeat an alert.
use crate::state::Store;
use std::sync::Mutex;
use tauri_plugin_notification::NotificationExt;

const KEY: &str = "usage_alerts_fired";

#[derive(serde::Deserialize)]
pub struct Alert {
    title: String,
    body: String,
}

#[tauri::command]
pub fn usage_alerts_fired(store: tauri::State<'_, Mutex<Store>>) -> Result<serde_json::Value, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let saved = store.get(KEY).map_err(|e| e.to_string())?;
    // Always an object, so the page can use it as is (T-716).
    Ok(saved.and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok()).filter(|v| v.is_object()).unwrap_or_else(|| serde_json::json!({})))
}

/// Hands the alerts to the system, then saves the record (T-716). An error before that (a toast that cannot be
/// built) comes back to the page, which keeps the alert due and sends it again on the next reading. Once the
/// toasts are handed off the send counts as done: a toast the system then drops is not seen here, and a failed save
/// is only logged (reporting it would make the page show the toast again at every reading); the page keeps the
/// alert as sent, so at worst it shows once more after a restart.
#[tauri::command]
pub fn usage_alert_send(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, fired: serde_json::Value, alerts: Vec<Alert>) -> Result<(), String> {
    // USAGE-009: while the window is hidden the tray dot lights, even when the toast itself is held back.
    crate::tray::ping(&app, crate::tray::Ping::UsageAlert);
    for a in alerts {
        app.notification().builder().title(a.title).body(a.body).show().map_err(|e| e.to_string())?;
    }
    if let Err(e) = store.lock().map_err(|e| e.to_string()).and_then(|s| s.set(KEY, &fired.to_string()).map_err(|e| e.to_string())) {
        eprintln!("usage alerts: the record was not saved: {e}");
    }
    Ok(())
}
