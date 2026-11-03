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
    Ok(saved.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_else(|| serde_json::json!({})))
}

/// Shows the alerts, then saves the record (T-716): an alert that fails to show is not marked sent, so the
/// page tries it again on the next reading. A save that fails after the show may repeat it once; a missed alert
/// would be worse.
#[tauri::command]
pub fn usage_alert_send(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, fired: serde_json::Value, alerts: Vec<Alert>) -> Result<(), String> {
    // USAGE-009: while the window is hidden the tray dot lights, even when the toast itself is held back.
    crate::tray::ping(&app, crate::tray::Ping::UsageAlert);
    for a in alerts {
        app.notification().builder().title(a.title).body(a.body).show().map_err(|e| e.to_string())?;
    }
    store.lock().map_err(|e| e.to_string())?.set(KEY, &fired.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}
