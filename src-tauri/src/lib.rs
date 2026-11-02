mod folder_projects;
mod floating_trust;
mod repo_scan;
mod activity;
pub mod agents;
mod app_look;
pub mod artifacts;
pub mod automations;
mod badge;
mod awake;
mod capture;
mod chat;
mod chat_tools;
mod clipboard;
mod browser;
mod cleanup;
mod cap;
pub mod cli;
mod cli_accounts;
pub mod claude_accounts;
pub mod claude_key;
pub mod codex_accounts;
pub mod codex_usage;
mod creatures;
pub mod diag;
mod editor_drafts;
mod editor_search;
pub mod fence;
pub mod files;
pub mod final_save;
pub mod fsops;
mod fonts;
pub mod git;
mod github;
mod groups;
pub mod hooks;
mod include;
mod import;
// T-043-e: the macOS keychain rule table; the Mac wiring that calls it is T-043-f.
#[cfg_attr(not(test), allow(dead_code))]
mod keychain;
mod agent_creds;
pub mod grok;
mod grok_status;
pub mod install;
mod keybindings;
mod edit_menu;
pub mod links;
mod login_env;
mod lifecycle;
mod menu;
mod bulk;
mod models;
mod names;
mod newproject;
mod notifications;
mod onboarding;
pub mod orchestration;
mod foreground;
pub mod procs;
pub mod protected;
#[cfg(test)]
mod s9_fuzz_tests;
pub mod protected_custom;
mod ports;
mod labels;
mod tidy;
mod resources;
pub mod projects;
mod prompt_answer;
mod prompt_scan;
pub mod scm;
mod scm_open;
mod scm_recipe;
mod scm_stack;
mod pr_review;
mod skills;
mod star;
mod pasted_image;
mod pr_checkout;
pub mod pty;
mod setup;
pub mod routing;
pub mod schedule;
mod resume;
pub mod secrets;
mod settings_sync;
mod session_rows;
mod sessions;
mod shell_marks;
mod shell_history;
mod skill_delete;
pub mod state;
pub mod status;
mod sub_work;
mod term_import;
mod sysmem;
pub mod terminal;
#[cfg(test)]
mod test_dir;
mod tools;
mod token_usage;
mod tray;
pub mod trust;
mod update;
mod visibility;
mod web_icon;
mod usage_alerts;

use state::Store;
use std::sync::Mutex;
use tauri::Manager;
use terminal::Terminals;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    profile_dir: String,
    start_count: u64,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>) -> Result<AppInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let start_count = store.get("start_count").map_err(|e| e.to_string())?.and_then(|v| v.parse().ok()).unwrap_or(0);
    let profile_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(AppInfo { version: app.package_info().version.to_string(), profile_dir: profile_dir.display().to_string(), start_count })
}

#[tauri::command]
fn get_settings(store: tauri::State<'_, Mutex<Store>>) -> Result<serde_json::Value, String> {
    // Secrets stay in the backend: the window never receives them (ACCT-009, ACCT-011).
    Ok(secrets::without_secrets(store.lock().map_err(|e| e.to_string())?.settings()))
}

/// Writes only the settings the window changed (`set`, and `remove` for ones it cleared) over what
/// is on disk, so a key Kolux itself wrote meanwhile (a printed pull request link) is kept.
/// T-075 (APP-048): `async`, so the synced write (two files, fsync each) runs off the window's
/// thread; typing never waits on the profile drive.
#[tauri::command(async)]
fn settings_patch(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, set: serde_json::Map<String, serde_json::Value>, remove: Vec<String>) -> Result<(), String> {
    // SET-035 (T-181): updates aimed at retired or secret settings are ignored; every window gets the redacted change.
    let (set, remove) = settings_sync::accepted(&set, &remove);
    let payload = settings_sync::broadcast(&set, &remove);
    write_settings(&app, &store, |old| state::patched(old, &set, &remove), payload)
}

/// The settings `change` makes of what is on disk, written under one lock.
fn write_settings(app: &tauri::AppHandle, store: &Mutex<Store>, change: impl FnOnce(serde_json::Value) -> serde_json::Value, payload: serde_json::Value) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let old = store.settings();
    // The window cannot write a secret field; the sealed values on disk are kept as they are.
    let value = secrets::keep_stored_secrets(&old, change(old.clone()));
    let before = old.get(resume::FIELD) == Some(&serde_json::Value::Bool(true));
    store.save_settings(&value).map_err(|e| e.to_string())?;
    drop(store);
    // USAGE-007: off discards the waits, on picks up the panes already stopped on a limit.
    let after = value.get(resume::FIELD) == Some(&serde_json::Value::Bool(true));
    if before != after {
        resume::switched(app, after);
    }
    // Views that depend on a setting (the lapsed sign-in notice, ACCT-012) read again.
    let _ = tauri::Emitter::emit(app, "settings-saved", payload);
    Ok(())
}

/// A desktop notification (STAT-041). The window decides when one is due and with which words, and
/// (STAT-043) whether the system's own sound plays with it: `sound` is false when Kolux plays its
/// own tone or file instead, or the volume is 0.
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String, sound: Option<bool>) -> Result<(), String> {
    notifications::show(&app, title, body, sound.unwrap_or(true))
}

/// The minutes of silence before a working agent is reported quiet; 10 by default, 0 is off
/// (STAT-045, settings key `quietMinutes`).
fn quiet_minutes(store: &Mutex<Store>) -> u64 {
    let settings = store.lock().map(|s| s.settings()).unwrap_or_default();
    settings.get("quietMinutes").and_then(|v| v.as_f64()).map(|m| m.max(0.0) as u64).unwrap_or(10)
}

/// APP-003 proof, dev builds only: KOLUX_DEV_INJECT=startup fails the launch before the window
/// opens, =background panics a background thread a few seconds in.
#[cfg(debug_assertions)]
fn dev_inject() -> Result<(), String> {
    match std::env::var("KOLUX_DEV_INJECT").as_deref() {
        Ok("startup") => Err("KOLUX_DEV_INJECT=startup: a failure injected before the window opens".into()),
        Ok("background") => {
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(3));
                panic!("KOLUX_DEV_INJECT=background: a failure injected into background work");
            });
            Ok(())
        }
        _ => Ok(()),
    }
}

/// T-075-b: the background terminal service process (`kolux-rs --terminal-service <identifier> <data folder>`).
pub fn terminal_service_main(args: &[String]) -> i32 {
    pty::service::main(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diag::catch_panics();
    // T-552: the config's windows are opened by tools::guarded_setup instead, which waits out a
    // quitting Kolux whose WebView2 processes still hold the profile folder, and turns any setup
    // failure into a plain native message instead of a panic.
    let mut context = tauri::generate_context!();
    let windows: Vec<String> = context.config().app.windows.iter().filter(|w| w.create).map(|w| w.label.clone()).collect();
    // T-183 (APP-043): after repeated graphics crashes a saved flag puts every window in safe graphics.
    // T-286-b (APP-017): every window is excused from background throttling (WebView2 browser
    // arguments; later webviews on the same data folder reuse the same string).
    let safe = resources::recovery::safe_graphics_on(&context.config().identifier, &context.package_info().version.to_string());
    // Row 939: the window's browser arguments carry the proxy saved in the profile, like its tabs'.
    let identifier = context.config().identifier.clone();
    for w in &mut context.config_mut().app.windows {
        w.create = false;
        w.additional_browser_args = Some(resources::recovery::launch_browser_args_for(w.additional_browser_args.as_deref(), safe, &identifier));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            // T-182 (APP-001): one copy at a time. A second launch hands its request to the running
            // copy, brings its window forward and exits before any window (or WebView2 profile) is touched.
            lifecycle::claim_or_forward(app);
            tools::guarded_setup(app, &windows, |app| {
            // APP-053: everything the app starts from here on ends with it; outside its own job (a job the
            // launcher owns without breakaway, say) the children would outlive a crash, so that is logged.
            let job_ok = procs::app_job_start();
            let dir = app.path().app_data_dir()?;
            diag::set_dir(&dir);
            // T-182 (APP-020, macOS and Linux): the login shell's environment, read in the background.
            login_env::start();
            // T-283 (BROW-043): an earlier run's leftover browser helpers are closed, on a thread of
            // its own so a hanging listing never holds up start-up.
            browser::helpers::sweep_at_start(&dir);
            // T-594: a user PATH too long for the installer gets <install>\bin added here, once per install.
            cli::cli_register::path_at_start_now(&dir);
            if !job_ok {
                diag::write(&dir, "kolux-rs: the app could not be put in its own job object; child processes would survive a crash (APP-053)");
            }
            // The config homes this process resolved (defaults included), so a launch that inherited another
            // app's environment shows up in the log.
            diag::write(&dir, &format!("kolux-rs: config: CLAUDE_CONFIG_DIR={} CODEX_HOME={}", hooks::claude_settings_file().parent().map(|d| d.display().to_string()).unwrap_or_default(), trust::codex_config_file().parent().map(|d| d.display().to_string()).unwrap_or_default()));
            // T-183 (APP-039): a previous run that left no clean exit becomes a crash record.
            resources::recovery::startup_scan(&dir);
            // T-183 (APP-021): the profile folder must take a write and every install file must read; a
            // per-user install is repaired with icacls, anything else is only named.
            let perms = resources::recovery::startup_check_here(&dir);
            for p in &perms.repaired {
                diag::write(&dir, &format!("permissions repaired: {} (APP-021)", p.display()));
            }
            let perm_problem = perms.problem();
            if let Some(p) = &perm_problem {
                diag::write(&dir, &format!("{p} (APP-021)"));
            }
            app.manage(resources::recovery::Perms(perms));
            app.manage(resources::recovery::Graphics(Mutex::new(resources::recovery::Burst::default())));
            // T-183 (APP-049): a damaged state.db is set aside and the last good copy restored before the
            // store opens; one that cannot be set aside leaves saving frozen on a scratch store.
            let prep = resources::recovery::prepare_state(&dir, &resources::recovery::frozen_dir());
            for n in &prep.notes {
                diag::write(&dir, n);
            }
            // After-list row 789: what was set aside or repaired is also told to the user, once, by the page.
            let told = resources::recovery::startup_notes(&prep, &app.state::<resources::recovery::Perms>().0);
            app.manage(resources::recovery::StartupNotes(Mutex::new(told)));
            if prep.backup_worthwhile() {
                if let Err(e) = resources::recovery::backup_state(&dir) {
                    diag::write(&dir, &format!("the last good copy of state.db could not be refreshed: {e} (APP-049)"));
                }
            }
            #[cfg(debug_assertions)]
            dev_inject()?;
            let store = Store::open(&prep.open_dir)?;
            store.stamp_look(); // row 785: the look and mode are written now, not left to a page read that may time out
            // SKILL-023: an interrupted skill delete is undone or completed under the skill lock (a busy
            // lock or a lock that cannot be opened is logged; the latter still recovers).
            skill_delete::startup_recover(&dir);
            let starts = onboarding::count_start(&store)?; // a failed count write is logged inside, never fatal
            if let Err(e) = onboarding::first_start(&store, starts) {
                eprintln!("kolux-rs: onboarding start failed ({e}); startup goes on");
            }
            // USAGE-011: last run's activity counts, before any pane reports.
            activity::start(&store);
            // ACCT-010: a key this computer can no longer open is cleared before the window asks.
            secrets::drop_unreadable(&store, &dir);
            app.manage(Mutex::new(store));
            // APP-004 (T-213): settings saved under the former product name carry over once, through the
            // importer's allow-list, in the background after the window shows; the page re-reads them.
            {
                let (h, profile) = (app.handle().clone(), dir.clone());
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    let Some(store) = h.try_state::<Mutex<Store>>() else { return };
                    if import::first_launch(&profile, &store).is_some_and(|p| !p.add.is_empty()) {
                        let _ = tauri::Emitter::emit(&h, "settings-saved", ());
                    }
                });
            }
            // T-183 (APP-042): the interface watch; RecoveryMount's heartbeat feeds it.
            resources::recovery::watch_start(app.handle().clone(), perm_problem);
            // TERM-122: the keep-awake watcher reads the saved choice every tick, and counts a
            // working pane only while its terminal is still running.
            {
                let (h, t) = (app.handle().clone(), app.handle().clone());
                awake::start(
                    move || h.state::<Mutex<Store>>().lock().map(|s| s.settings()).unwrap_or_default(),
                    move |id| t.try_state::<Terminals>().is_some_and(|ts| ts.started(id).is_some()),
                );
            }
            // T-301 (APP-012): the saved app icon variant and window blur, before the window shows.
            app_look::apply_saved(app.handle());
            app.manage(links::Grants::default());
            // APP-041: the app's own start-and-stop record, next to what the terminals report.
            diag::write(&dir, &format!("app start {starts}, Kolux RS {}", app.package_info().version));
            // SET-004: the window starts hidden and the page shows it once its first frame has the saved
            // look; this is the backstop for a page that never gets that far.
            // T-286-b (APP-040): the app's own view reports its engine's process failures.
            if let Some(w) = app.get_webview_window("main") {
                browser::engine::watch_app_failures(&w, dir.clone());
            }
            // APP-014: spelling suggestions for the text-field menu (Windows).
            edit_menu::install(app.handle());
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let _ = w.show();
                });
            }
            app.manage(Terminals::default());
            // T-184-b (TERM-105): panes run in the background terminal service and outlive the window.
            app.state::<Terminals>().use_service(app.handle());
            // APP-008 / T-248-d: the tray icon with Open Kolux, Quit and the dot. Optional: a failure is logged and the app goes on.
            if let Err(e) = tray::install(app.handle()) {
                diag::write(&dir, &format!("tray: the icon could not be installed: {e}"));
            }
            notifications::first_run_welcome(app.handle()); // VIEW-111: a Mac's one welcome notification
            app.manage(resources::Sampler::default());
            app.manage(resume::Registry::default());
            app.manage(claude_key::KeySetup::default());
            app.manage(claude_accounts::SignIns::default());
            app.manage(codex_accounts::SignIns::default());
            app.manage(install::Installs::default());
            app.manage(grok::GrokSignIn::default());
            app.manage(artifacts::Library::new(dir.join("artifacts")));
            // Pages Claude sessions publish are kept in the library as they happen (SKILL-035).
            capture::start(app.handle().clone());
            app.manage(update::Updates::default());
            // Git is checked once here; every project and workspace action runs through it. Without
            // Git the app still opens, and the landing screen says so (APP-023).
            app.manage(git::Git::detect().unwrap_or(git::Git { version: String::new() }));
            projects::forget_gone_at_start(app.handle().clone()); // APP-051
            app.manage(tools::Cache::default());
            // ACCT-055: picked-file grants saved by the last run come back.
            let fence = fence::Fence::load(&app.state::<Mutex<Store>>());
            app.manage(fence);
            app.manage(token_usage::Flights::default());
            // ORCH-034: the orchestration store is brought up to today's layout before anything reads it.
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                orchestration::upgrade::at_start(&store);
            }
            // The command line reaches the app through a loopback port (PROJ-077).
            cli::serve(app.handle().clone(), &dir)?;
            // AUTO-001: the automations clock.
            automations::start_clock(app.handle().clone());
            // Agents report their status through hooks (STAT-001): the listener, then the scripts
            // and each found, switched-on agent's entries (STAT-004), off the launch path.
            // STAT-006 / STAT-030: the last run's statuses, with what hooks held while Kolux was
            // closed, are read before the listener opens.
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                hooks::agent_hooks::saved::startup(&store, &dir);
            }
            let hooks = hooks::serve(app.handle().clone(), &dir)?;
            app.manage(hooks);
            let settings = app.state::<Mutex<Store>>().lock().map(|s| s.settings()).unwrap_or_default();
            let profile = dir.clone();
            std::thread::spawn(move || {
                hooks::agent_hooks::sync(&settings, &profile);
            });
            // Shortly after the first window: seal anything older still in the clear and limit
            // the profile folder to this user (ACCT-009). Never delays or stops the launch.
            let handle = app.handle().clone();
            let log_dir = dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                secrets::sealing_pass(&handle.state::<Mutex<Store>>(), &dir);
                // Row 144: old pasted images go at start-up, not only at the next paste.
                pasted_image::sweep_profile(&dir);
            });
            // USAGE-007: the resumes the previous run left waiting, then the timer that types them.
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                resume::restore_from(app.handle(), &store);
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15));
                resume::tick(&handle, &log_dir);
            });
            // PROJ-069: quiet repositories get Git's own housekeeping (prune + gc, nothing deleted);
            // PROJ-088: the workspace label addresses follow their setting (off by default).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let resolver = handle.clone();
                let resolve: labels::Resolve = std::sync::Arc::new(move |label: &str| labels::resolve_in(&resolver, label));
                let mut tidy_at = std::time::Instant::now() + tidy::POLL;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let on = handle.state::<Mutex<Store>>().lock().map(|s| labels::enabled(&s.settings())).unwrap_or(false);
                    labels::apply(on, &resolve);
                    if std::time::Instant::now() >= tidy_at {
                        tidy_at = std::time::Instant::now() + tidy::POLL;
                        tidy::pass(&handle);
                    }
                }
            });
            // ACCT-050: an agent started by hand in a shell pane is recognised within a few seconds.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                foreground::poll(&handle);
                // STAT-028: a cancelled turn that never sends its Stop reads interrupted.
                for status in status::settle_cancels() {
                    let _ = tauri::Emitter::emit(&handle, hooks::EVENT, status);
                }
                // STAT-032: a working reading with no signal for 30 minutes is marked unverified.
                for quiet in status::settle_unverified() {
                    let _ = tauri::Emitter::emit(&handle, "agent-unverified", quiet);
                }
            });
            // USAGE-011: changed activity counts are saved in batches.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                // T-075 (APP-050): nothing queues behind the final save.
                if !final_save::quitting() {
                    activity::save(&handle.state::<Mutex<Store>>(), false);
                }
            });
            // STAT-045: a working agent that prints nothing for the chosen minutes is reported once
            // per silent spell. Silence is the terminal's own output, never the hooks.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15));
                let minutes = quiet_minutes(&handle.state::<Mutex<Store>>());
                let threshold = (minutes > 0).then(|| std::time::Duration::from_secs(minutes * 60));
                let terminals = handle.state::<Terminals>();
                for pane_key in status::quiet_check(threshold, |id| terminals.silence(id)) {
                    let _ = tauri::Emitter::emit(&handle, "agent-quiet", status::Quiet { pane_key, minutes });
                }
            });
            Ok(())
        })
        })
        // The Artifacts viewer (SKILL-036) loads stored pages through this scheme, one entry at a time.
        // T-500: only the app's own web view may read artifacts; a Browser pane page gets nothing.
        .register_uri_scheme_protocol(artifacts::SCHEME, |ctx, req| {
            if ctx.webview_label() != "main" {
                return tauri::http::Response::builder().status(403).body(b"not for this page".to_vec()).unwrap_or_default();
            }
            artifacts::serve(&ctx.app_handle().state::<artifacts::Library>(), &req)
        })
        // T-033-e (FIX-1): a reload of the main page (F5 / Ctrl+R) destroys no window, and the old
        // page never gets to release its git watches, so they are all let go as the new page starts
        // loading (the new page subscribes afresh); at the first load there is nothing to let go.
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                scm::watch::unwatch_all();
                browser::preview::clear_grants();
            }
        })
        .on_window_event(|window, event| {
            // The window is gone: no shell may outlive it.
            // T-546-c: only the main window holds shells, so the Tower's own window closing changes nothing;
            // the Tower window goes with the main one, so it never keeps the app running on its own.
            // T-182 (APP-006): the page decides whether closing needs a question; a page that never
            // answers (frozen or crashed) is closed for after lifecycle::ASK_LIMIT.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    lifecycle::close_requested(window);
                }
            }
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    // T-182 (APP-006): quitting always finishes; a final save or exit wait that hangs
                    // past lifecycle::quit_deadline() is cut short.
                    lifecycle::quit_watchdog(window.app_handle());
                    window.state::<Terminals>().kill_all();
                    // T-033-e: no git watch outlives the window either (nothing is waited for here).
                    scm::watch::unwatch_all();
                    if let Some(t) = window.app_handle().get_webview_window("tower") {
                        let _ = t.close();
                    }
                }
            }
            // APP-008 / T-248-d: the window is back on screen, so the tray's attention dot clears.
            if let tauri::WindowEvent::Focused(true) = event {
                if window.label() == "main" {
                    tray::window_shown(window.app_handle());
                }
            }
            // STAT-047 / T-248-c: a minimised window is out of sight, so the tray's dot may light.
            if let tauri::WindowEvent::Resized(_) = event {
                if window.label() == "main" && window.is_minimized().unwrap_or(false) {
                    tray::window_minimised(window.app_handle());
                }
            }
            // ACCT-055: files dropped in from outside may be copied into the Explorer, nothing else.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<fence::Fence>().dropped(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            edit_menu::edit_menu_ready,
            get_settings,
            settings_patch,
            notify,
            notifications::notification_test,
            badge::badge_set,
            notifications::notification_sound_load,
            notifications::open_notification_settings,
            notifications::notify_event, // STAT-044
            hooks::agent_hooks::agent_hooks_sync,
            hooks::agent_hooks::agent_hooks_file,
            hooks::agent_hooks::saved::agent_status_saved,
            tray::tray_close_requested, // APP-007 (tray FIX-1): the page asks before the main window closes
            tray::tray_ping, // STAT-047: the tray dot lights before any toast switch is consulted
            protected::protected_rules,
            protected_custom::protected_rule_check,
            protected_custom::protected_attempts,
            protected_custom::protected_attempts_clear,
            hooks::claude_usage,
            sysmem::process_memory,
            fonts::list_fonts,
            term_import::term_import_ghostty,
            term_import::term_import_ghostty_theme,
            term_import::term_import_warp,
            resources::resources,
            sessions::list::sessions_list,
            sessions::list::session_resume_plan,
            sessions::files::session_delete, sessions::files::session_reveal, sessions::files::session_open,
            session_rows::session_row_detail,
            session_rows::session_name,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_service_info,
            terminal::terminal_attach,
            chat::chat_support,
            chat::chat_read,
            chat::chat_close,
            terminal::terminal_screen_reply,
            terminal::terminal_resize,
            terminal::terminal_ack,
            terminal::terminal_memory_profile,
            terminal::terminal_kill,
            terminal::terminal_next_input_source,
            terminal::terminal_layout,
            terminal::terminal_busy,
            terminal::terminal_host_sessions,
            terminal::terminal_host_end,
            terminal::terminal_diagnostics,
            terminal::terminal_history,
            terminal::terminal_forget_history,
            terminal::terminal_listed_session,
            terminal::terminal_prune_history,
            terminal::terminal_history_append,
            status::agent_history,
            status::agent_answer,
            status::status_inband,
            activity::activity_counts,
            activity::activity_get,
            activity::activity_timeline,
            activity::activity_touch,
            projects::git_version,
            projects::project_list,
            projects::project_add,
            folder_projects::project_add_folder, folder_projects::project_remove,
            repo_scan::repo_scan_start, repo_scan::repo_scan_stop, repo_scan::repo_scan_labels, repo_scan::repo_import,
            projects::workspace_list,
            projects::workspace_preview,
            projects::workspace_create,
            projects::workspace_create_cancel,
            projects::workspace_prs,
            projects::workspace_open_pr,
            projects::workspace_from_item,
            projects::workspace_items,
            projects::workspace_item,
            projects::workspace_set_parent,
            projects::workspace_branches,
            projects::workspace_open_branch,
            projects::workspace_scan,
            projects::workspace_seen,
            projects::workspace_hide,
            projects::workspace_rename, projects::workspace_details_get, projects::workspace_details_save,
            projects::workspace_sleep,
            projects::visibility_get,
            projects::visibility_set,
            projects::visibility_root_add,
            projects::visibility_root_remove,
            projects::workspace_note_get,
            projects::workspace_note_save,
            projects::branch_prefix_check,
            projects::workspace_create_fresh,
            projects::workspace_suggest_name,
            projects::project_icons_list,
            projects::project_icon_set,
            projects::project_auto_icon,
            setup::setup_suggestion,
            setup::setup_suggestion_save,
            setup::setup_suggestion_dismiss,
            setup::repo_setup_get,
            setup::repo_setup_save,
            setup::repo_setup_remove,
            setup::repo_setup_policy_set,
            setup::repo_setup_wait_set,
            setup::repo_setup_mode_set,
            projects::handoff_note_prepare,
            projects::workspace_remove,
            cleanup::cleanup_remove,
            cleanup::cleanup_scan,
            cleanup::branch_delete_kept,
            cleanup::cleanup_sizes,
            projects::workspace_remove_check,
            projects::project_set,
            projects::project_display_name_set,
            projects::workspaces_place_get,
            projects::workspaces_place_set,
            projects::git_first_commit_preview,
            projects::git_start,
            setup::workspace_setup,
            setup::workspace_issue_command,
            setup::workspace_default_tabs,
            setup::script_trust_needed,
            setup::script_trust_grant,
            setup::setup_imports_list,
            setup::setup_import,
            agents::list_command::agent_list,
            models::agent_models,
            agents::agent_start_line,
            agents::agent_prompt_send,
            agents::agent_install::agents_install,
            agents::agent_install::agents_install_many,
            agents::open_install_page,
            agents::inventory::session_tabs,
            orchestration::worker_labels,
            orchestration::setup_gate::worker_setup_settled,
            prompt_answer::prompt_read,
            prompt_answer::prompt_answer,
            prompt_scan::prompt_scan,
            prompt_scan::prompt_scan_restored,
            prompt_scan::prompt_scan_pruned,
            pty::shell_list,
            tools::tools_check,
            tools::tools_dismiss,
            tools::editors_list,
            tools::teams_host,
            awake::keep_awake_state,
            app_look::app_look_apply,
            token_usage::token_usage,
            token_usage::token_usage_scan,
            token_usage::token_tracking_set,
            trust::trust_folders_cmd,
            scm::scm_status, scm::scm_count, scm::scm_reveal,
            scm::scm_ignore_heavy,
            scm::scm_watch, scm::scm_unwatch,
            scm::scm_base_changes, scm::scm_base_sides,
            scm::scm_pushed, scm::scm_head, scm::scm_summary, scm::scm_abort,
            scm::scm_merge_info,
            scm::scm_merge,
            scm::scm_gh_budget,
            scm::scm_tasks_search,
            scm::scm_gh_account,
            scm::scm_prs_poll,
            scm::scm_commit_message,
            scm::scm_commit_message_stop,
            scm::writers::scm_writer_options,
            scm::writers::scm_name_branch,
            projects::workspace_rename_on_first_prompt,
            projects::workspace_move_folder,
            scm::scm_task_detail,
            scm::scm_repo_labels,
            github::github_repo_parent,
            github::github_repo_lineage,
            github::github_people,
            github::github_project,
            github::github_projects,
            github::github_project_set,
            github::github_issue_state,
            github::github_issue_comment,
            github::github_issue_create,
            github::github_issue_types,
            github::github_issue_type_set,
            github::pull_requests::pr_page,
            github::pull_requests::pr_files,
            github::pull_requests::pr_file_patch,
            github::pull_requests::pr_checks,
            github::pull_requests::pr_threads,
            github::pull_requests::pr_set_state,
            github::pull_requests::pr_viewed,
            github::pull_requests::pr_set_viewed,
            github::pull_requests::pr_editors,
            github::pull_requests::pr_rerun,
            github::pull_requests::pr_reviewers,
            github::pull_requests::pr_assignees,
            github::pull_requests::pr_react,
            github::pull_requests::pr_reply,
            github::pull_requests::pr_merge,
            pr_checkout::scm_push_target,
            scm_open::scm_open_with,
            scm_recipe::scm_recipe_commit,
            scm_recipe::scm_recipe_fix,
            scm_stack::scm_stack_create,
            scm_stack::scm_stack_record,
            pr_review::scm_stack_prs,
            scm::scm_task_labels,
            scm::scm_task_body,
            scm::scm_stage,
            scm::scm_discard,
            scm::scm_commit, scm::scm_remote,
            scm::scm_pr, scm::scm_pr_checks, scm::scm_pr_create, scm::scm_open_pr,
            pr_review::scm_pr_find, pr_review::scm_check_rerun, pr_review::scm_check_log, pr_review::scm_pr_text,
            pr_review::scm_review_read, pr_review::scm_review_act, pr_review::scm_review_send, pr_review::scm_pr_conflicts,
            scm::scm_history, scm::scm_commit_files, scm::scm_github_repo, scm::repo_id::scm_repo_id, scm::repo_id::scm_repo_id_of,
            bulk::workspace_remove_many, bulk::workspace_forget, bulk::workspace_forget_check,
            bulk::workspace_statuses, bulk::workspace_statuses_set, bulk::workspace_status_set,
            bulk::space_scan, bulk::space_saved,
            ports::ports_list, ports::ports_stop,
            keybindings::keybindings_read,
            menu::menu_sync, menu::menu_popup,
            keybindings::keybindings_write,
            keybindings::keybindings_reload,
            keybindings::keybindings_show,
            browser::browser_open,
            browser::preview::browser_preview_grant,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_go,
            browser::history::browser_suggest,
            browser::browser_close,
            browser::notices::browser_pane_ready,
            browser::picture::browser_capture, // after-list 151 (BROW-038), 320 (BROW-035)
            browser::picture::browser_save_picture,
            browser::drag::browser_drag_through, // after-list 746 (T-319-c, BROW-052)
            browser::pdf::browser_export_pdf, // T-316-b (EDIT-018)
            browser::pdf::browser_pick_pdf_path,
            browser::tower::tower_window_open, // rows 955 / 959: the Tower's own window, built in Rust
            browser::browser_viewport,
            browser::browser_cookies_import,
            browser::cookies::browser_import_sources, // T-319-b (BROW-030)
            browser::handler::browser_external_handler, // after-list 21 (BROW-008)
            browser::browser_probe,
            browser::browser_diagnose,
            browser::certs::browser_cert,
            browser::browser_tab,
            browser::browser_annotate,
            browser::preview::browser_preview,
            browser::preview::browser_preview_of,
            browser::ports::browser_dev_ports,
            automations::automations_list,
            automations::automation_set_enabled,
            automations::automation_delete,
            automations::automation_run_now,
            automations::automation_preview,
            automations::automation_save,
            automations::carry::session_carry_context,
            automations::carry::agent_dir_ready,
            routing::routing_catalog,
            secrets::secret_status,
            secrets::secrets_dropped,
            secrets::secrets_dropped_dismiss,
            secrets::secret_set,
            secrets::secret_clear,
            codex_usage::codex_usage,
            codex_usage::codex_usage_of,
            claude_key::claude_key_status,
            claude_key::claude_key_connect,
            claude_key::claude_key_cancel,
            claude_key::claude_key_disconnect,
            claude_accounts::claude_accounts,
            claude_accounts::claude_account_sign_in,
            claude_accounts::claude_account_cancel,
            claude_accounts::claude_account_activate,
            claude_accounts::claude_account_check,
            claude_accounts::claude_own_sign_in,
            claude_accounts::claude_account_remove,
            install::agent_installs,
            install::agent_can_install,
            install::agent_install,
            install::agent_install_cancel,
            grok::grok_status,
            grok::grok_sign_in,
            grok::grok_cancel,
            grok::grok_key_set,
            agent_creds::agent_creds_view,
            agent_creds::codex_sessions_home_set,
            agent_creds::minimax_credential_set,
            agent_creds::minimax_credential_forget,
            agent_creds::minimax_options_set,
            agent_creds::gemini_cli_credentials_set,
            resources::provider_usage::provider_keys,
            resources::provider_usage::provider_key_set,
            resources::provider_usage::provider_key_forget,
            resources::provider_usage::provider_usage_check,
            codex_accounts::codex_accounts,
            codex_accounts::codex_account_sign_in,
            codex_accounts::codex_account_cancel,
            codex_accounts::codex_account_activate,
            codex_accounts::codex_account_remove,
            codex_accounts::codex_account_label,
            codex_accounts::codex_account_sign_in_printed,
            groups::groups_get,
            groups::group_create,
            groups::group_rename,
            groups::group_nest,
            groups::group_put,
            groups::group_delete,
            newproject::clone_suggest,
            newproject::project_clone,
            newproject::clone_cancel,
            newproject::project_new_defaults,
            newproject::project_create,
            onboarding::onboarding_get,
            onboarding::onboarding_step,
            onboarding::onboarding_close,
            onboarding::guide_get,
            onboarding::guide_mark,
            onboarding::cli_status,
            onboarding::tours_get,
            onboarding::onboarding_reopen,
            onboarding::onboarding_milestone,
            star::star_info,
            star::star_put,
            files::file_read,
            files::file_write,
            files::file_bytes,
            files::file_write_picture,
            files::file_stamps,
            files::file_pick,
            floating_trust::floating_pick,
            floating_trust::floating_start,
            files::md_list,
            editor_drafts::editor_draft_set,
            editor_drafts::editor_draft_clear,
            editor_drafts::editor_drafts_get,
            editor_drafts::editor_drafts_drop,
            editor_drafts::editor_draft_rename,
            editor_drafts::editor_flush_ack,
            editor_search::editor_search,
            editor_search::editor_search_cancel,
            skills::skills_scan,
            skill_delete::skills_delete_plan,
            skill_delete::skills_delete,
            skills::update::skills_update_check,
            skills::update::skills_update_dismiss,
            skills::update::skills_update_start,
            skills::update::skills_update_stop,
            skills::update::skills_update_status,
            skills::update::skills_update_clear,
            skills::installer::skills_install_command,
            skills::skills_reveal,
            files::open_in,
            files::worktree_branches,
            files::file_list,
            files::md_new,
            files::md_templates,
            files::diff_sides,
            files::git_changes,
            files::change_entries,
            files::diff_image,
            files::dir_list,
            files::dir_ignored,
            files::path_kind,
            artifacts::artifacts_list,
            artifacts::artifact_add,
            artifacts::artifact_remove,
            artifacts::open_external,
            links::open_path, links::file_grant, links::editor_open,
            fsops::fs_create,
            fsops::fs_rename,
            fsops::fs_trash,
            fsops::fs_restore,
            fsops::fs_copy,
            fsops::fs_bytes,
            fsops::fs_move,
            clipboard::clip_copy_text,
            clipboard::clip_copy_files,
            clipboard::feedback_facts,
            pasted_image::paste_image_save,
            cli::cli_register::cli_register_state,
            cli::cli_register::cli_register,
            cli::cli_register::cli_unregister,
            cli::file_cli::cli_file_window,
            cli::file_cli::cli_file_result,
            diag::diag_bundle,
            resources::recovery::ui_heartbeat,
            resources::recovery::startup_recovery_notes,
            resources::recovery::graphics_crash_noted,
            resources::recovery::graphics_keep_running,
            resources::recovery::graphics_restart_safe,
            resources::recovery::graphics_launch_choice,
            resources::recovery::graphics_choose,
            resources::recovery::crash_pending,
            resources::recovery::crash_latest,
            resources::recovery::crash_dismiss,
            resources::recovery::crash_details,
            diag::diag_review,
            diag::diag_review_discard,
            update::update_status,
            update::update_mark,
            update::update_check,
            update::update_download,
            update::update_restart,
            update::update_last_attempt,
            update::update_compat,
            lifecycle::close_alive,
            lifecycle::open_files_take, // APP-019: the page drains the markdown files the system handed over
            tray::tray_close_switch_available, // APP-007: Settings hides the close-to-tray switch where it cannot work
            usage_alerts::usage_alerts_fired,
            usage_alerts::usage_alert_send
        ])
        .build(context)
        .unwrap_or_else(|e| tools::startup_failed(&e.to_string()))
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                use std::sync::atomic::Ordering::SeqCst;
                // T-324-b-rest: an exit reached without this was Windows ending the session.
                lifecycle::EXIT_ASKED.store(true, SeqCst);
                // T-182-e (APP-006): "a quit under way" is any exit the app asked for (quit, restart, the
                // unanswered-close fallback); remembered, so windows closing on the way out never hold it open.
                if code.is_some() {
                    lifecycle::QUIT_UNDER_WAY.store(true, SeqCst);
                }
                if lifecycle::keeps_running(cfg!(target_os = "macos"), *code, lifecycle::QUIT_UNDER_WAY.load(SeqCst)) {
                    api.prevent_exit();
                } else {
                    // T-286-b (APP-040): engine exits once the app is quitting are not crashes.
                    browser::crash::quitting();
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = &event {
                tools::reopen_main(app);
            }
            if let tauri::RunEvent::Exit = event {
                // APP-050 b2: exit paths that never destroy the main window (tray Quit, recovery exit, session end) get the kill-switch too; a stall past it skips install_on_quit.
                lifecycle::quit_watchdog(app);
                // T-324-b-rest: a sign-out, shutdown or restart is logged before anything that may be cut short.
                lifecycle::note_session_end(app);
                // T-075 (APP-050): the final save is one barrier with a deadline: begin() stops the
                // batched savers, each step runs on its own thread and is waited for only as long as
                // the deadline leaves, so a stalled profile drive caps the wait and never freezes the
                // quit. Settings need no step: every change is already on disk (APP-048).
                final_save::begin();
                // T-283 (BROW-043): this run's browser helpers end with it.
                browser::helpers::stop_all();
                // T-122 (STAT-018): Grok's Kolux-written hook file goes, unless another running
                // Kolux owns it; the removal is cut short after grok::QUIT_LIMIT.
                if let Ok(dir) = app.path().app_data_dir() {
                    hooks::agent_hooks::more::grok::at_quit(&dir);
                }
                // T-182 (APP-011): the same steps make the save point a restart waits for.
                let report = final_save::run(final_save::QUIT_DEADLINE, lifecycle::quit_steps(app));
                if let Ok(dir) = app.path().app_data_dir() {
                    diag::write(&dir, &report.line());
                }
                app.state::<Terminals>().kill_all();
                // T-552: the window's WebView2 processes let go of the profile folder before the app
                // ends (up to 3 s), so a relaunch right after finds it free.
                let webviews_left = tools::wait_webviews_closed();
                if let Ok(dir) = app.path().app_data_dir() {
                    if webviews_left > 0 {
                        diag::write(&dir, &format!("app exit: {webviews_left} WebView2 process(es) still running after 3 s (T-552)"));
                    }
                    diag::write(&dir, "app exit");
                    let _ = std::fs::remove_file(dir.join(cli::FILE));
                    let _ = std::fs::remove_file(dir.join(hooks::ENDPOINT_FILE));
                }
                // APP-025: an update that finished downloading installs as the app quits.
                update::install_on_quit(app);
            }
        });
}
