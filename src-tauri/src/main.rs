// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // T-075-b: the same program runs the background terminal service, with no window.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--terminal-service") {
        std::process::exit(kolux_lib::terminal_service_main(&args));
    }
    // T-594: the uninstaller's run takes <install>\bin off the user PATH at any length, with no window.
    if let Some(code) = kolux_lib::cli::cli_register::uninstall_main(&args) {
        std::process::exit(code);
    }
    // T-573: the installer's run installs the agents and never opens the window.
    if let Some(code) = kolux_lib::agents::agent_install::cli_main(&args) {
        std::process::exit(code);
    }
    kolux_lib::run()
}
