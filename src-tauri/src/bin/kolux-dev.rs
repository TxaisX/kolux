//! `kolux-dev`: the command line of a development build (PROJ-077). Everything lives in the
//! library so the app and this program share one parser and one wire format.

fn main() {
    std::process::exit(kolux_lib::cli::main(std::env::args().skip(1).collect()));
}
