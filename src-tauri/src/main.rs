// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // T-075-b: the same program runs the background terminal service, with no window.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--terminal-service") {
        std::process::exit(kolux_lib::terminal_service_main(&args));
    }
    kolux_lib::run()
}
