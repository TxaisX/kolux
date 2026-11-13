# Trying a change locally, in minutes

Txais waits 30-45 minutes for an installer build before he can try a change. None of that wait is
needed for a local try: the installer, the signature and GitHub are for releases, and the slowest
part of a release build (fat LTO, one codegen unit) only matters for a binary other people run.

Pick the command for what you changed:

| You changed | Command | How long |
|---|---|---|
| CSS, a `.tsx`, a bit of front-end logic | `pnpm dev` then the harness launch below, or a lane's own dev launch | about 2 s per save (vite HMR); the first window about 15-20 s |
| Rust (`src-tauri/**`) | the same dev launch; the Rust side rebuilds and restarts | 2-3 min (measured 2 m 42 s, the whole crate) |
| Anything, and you want the real release-speed app with no installer | `pnpm local` | see the numbers below (minutes, not tens of minutes) |
| An installer for release | `pnpm release` | 30-45 min, unchanged: that is the price of what ships |

`pnpm local` builds and starts Kolux beside your installed copy:

- no installer, no signing, no GitHub;
- the identifier is `com.txaisxiong.kolux.local`, so its settings, sessions and window state are a
  folder of its own and the Kolux you have installed is untouched;
- the Rust build is the release profile with the expensive parts off: thin LTO, 16 codegen units,
  opt-level 2, not stripped, incremental. That is 7x cheaper than the shipped build and nobody can
  tell the difference while trying a change;
- it prints where its settings live and which build it started.

Flags: `--no-build` starts the last build (skips cargo), `--no-launch` builds and stops,
`--profile` prints what the build turns off.

## Measured on this PC (Windows, 2026-11-12)

| Step | Command | Time |
|---|---|---|
| Warm dependency install | `pnpm install --prefer-offline` | 0.8 s (`Done in 24ms`) |
| Front end alone | `pnpm build` (tsc + vite) | 31 s (`✓ built in 5.12s`) |
| Rust, debug profile, deps warm | `cargo build --manifest-path src-tauri/Cargo.toml` | 2 m 42 s |
| Rust, **release profile as shipped** (fat LTO, 1 codegen unit), deps warm | `cargo build --release` | **19 m 55 s** |
| `pnpm local`, cold (empty target) | whole app, release speed, no installer | **9 m 54 s** |
| `pnpm local`, warm (one `.tsx` edited) | the same | **3 m 35 s** |

The 19 m 55 s is what the installer pays too: `[profile.release]` is `lto = true` +
`codegen-units = 1` on one 168k-line crate, which is about 19 of the 30-45 minutes.

## The one folder that keeps builds warm

Cargo writes its build into `src-tauri/target` (56 GB on the main checkout). Every worktree and lane
has its own, so each starts cold. Set one folder and every checkout on this PC shares it:

```
setx KOLUX_TARGET_DIR G:\Dev\kolux-build\local
```

`pnpm local` then builds into that folder. Two things to know: cargo holds a lock, so two builds at
once wait for each other rather than running in parallel, and a folder shared across checkouts
rebuilds everything whenever the Rust or the Cargo.toml differs between them.

## What is still slow, and why

The app's Rust is one crate of 210 files and 168k lines, so the smallest Rust change recompiles the
whole binary. No profile setting changes that; splitting it into crates would (days of work, not this
wave). That is why the table says minutes for a Rust change and seconds only for the front end.

## Rules of the road

- Never `pnpm tauri dev` on the wave's lanes: it pins port 1420 and six lanes would collide. Each lane
  launches through `scripts/evidence/app-launch.mjs` with its own ports and identifier.
- Never `pnpm tauri build`, installers or releases from a lane: `pnpm local` exists so nobody has to.
- One cargo build per lane at a time; close the app you started when you are done with it.
