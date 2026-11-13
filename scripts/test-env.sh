# Scratch homes for the Rust integration tests, as scripts/test-env.ps1 makes them, for macOS and Linux shells.
# It redirects exactly these into a fresh random root per shell: USERPROFILE, HOME, CLAUDE_CONFIG_DIR, CODEX_HOME,
# TMPDIR, and XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME and XDG_STATE_HOME inside the scratch home.
# KRS_SCRATCH_ROOT keeps the root, so sourcing it again reuses it; CARGO_HOME and RUSTUP_HOME stay the real ones.
# Source it in the shell that runs the tests:  . scripts/test-env.sh && cargo test
# The random part is lowercase hex: some tests (cli018) compare paths case-blind, as Windows does.
root="${KRS_SCRATCH_ROOT:-${TMPDIR:-/tmp}/krs-scratch.$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')}"
[ -n "$KRS_SCRATCH_ROOT" ] || mkdir -m 700 "$root" || return 1
export KRS_SCRATCH_ROOT="$root"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
mkdir -p "$root/home" "$root/claude-config" "$root/codex" "$root/tmp" && : > "$root/.kolux-scratch"
export USERPROFILE="$root/home" HOME="$root/home" CLAUDE_CONFIG_DIR="$root/claude-config" CODEX_HOME="$root/codex" TMPDIR="$root/tmp"
export XDG_CONFIG_HOME="$root/home/.config" XDG_DATA_HOME="$root/home/.local/share" XDG_CACHE_HOME="$root/home/.cache" XDG_STATE_HOME="$root/home/.local/state"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
echo "scratch homes under $root"
