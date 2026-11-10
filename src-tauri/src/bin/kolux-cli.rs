//! `kolux`: the command line an installed copy ships in its bin folder (CLI-006), next to the
//! `kolux.cmd` shim. It is the same program as `kolux-dev` under the name users type.

fn main() {
    std::process::exit(kolux_lib::cli::main(std::env::args().skip(1).collect()));
}
