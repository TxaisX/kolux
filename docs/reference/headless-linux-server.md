# Headless Linux Server

Use this guide when you want to run `kolux serve` on a Linux machine without a
desktop session, such as an Ubuntu VPS or a remote build box.

`kolux serve` starts the Kolux runtime without opening the desktop window. On
Linux, the packaged AppImage still needs the libraries that Electron expects at
startup. Current Kolux builds start Xvfb automatically for `kolux serve` when no
`DISPLAY` is set, but Xvfb must be installed first. A separate D-Bus session is
not required. When `DISPLAY` is set, Kolux uses that display instead of starting
a competing Xvfb process, provided the display is usable: its socket must exist,
and if an X lock file is present it must name a running process. A `DISPLAY`
whose lock names a dead process is refused rather than replaced, and `kolux serve`
exits — unset `DISPLAY` to let Kolux start its own Xvfb. A socket published with
no lock at all (a container bind-mounting `/tmp/.X11-unix`, or WSLg) is accepted.

The supported deployment matrix covers Ubuntu 20.04, 22.04, and 24.04 and
current Debian stable — anything with glibc 2.31 or newer (see
[Linux glibc compatibility](./linux-glibc-compatibility.md)). Package names can
differ on other Debian-derived releases.

## Ubuntu and Debian prerequisites

Install the CLI tools, Xvfb, and the shared libraries Electron links against.
A minimal server or container image ships none of the Electron libraries, and
`kolux serve` then fails before Electron starts:

```bash
sudo apt-get update
sudo apt-get install -y \
  curl file jq xvfb zlib1g-dev ca-certificates git \
  libgtk-3-0t64 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 \
  libxtst6 libcups2t64 libdrm2 libxkbcommon0 libpango-1.0-0 libcairo2 libatspi2.0-0t64 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxrender1 libx11-xcb1 \
  libxcb-dri3-0 libxss1
```

That command is for Ubuntu 24.04 and newer and Debian 13 and newer. Those
releases carried out the 64-bit `time_t` transition, which renamed six of the
packages with a `t64` suffix. On Ubuntu 20.04, Ubuntu 22.04, and Debian 12,
substitute the unsuffixed names:

- `libgtk-3-0t64` becomes `libgtk-3-0`
- `libatk1.0-0t64` becomes `libatk1.0-0`
- `libatk-bridge2.0-0t64` becomes `libatk-bridge2.0-0`
- `libasound2t64` becomes `libasound2`
- `libcups2t64` becomes `libcups2`
- `libatspi2.0-0t64` becomes `libatspi2.0-0`

The other names are identical on every supported release. The substitution is not
symmetric, so use the list that matches the release. A `t64` name on Ubuntu 20.04,
Ubuntu 22.04, or Debian 12 fails immediately with `E: Unable to locate package
libgtk-3-0t64`. In the other direction the old names mostly still resolve, because
each renamed package declares `Provides:` its unsuffixed name — except `libasound2`
on Ubuntu 24.04, where `liboss4-salsa-asound2` in `universe` claims that name too.
apt will not choose between two providers and exits with `E: Package 'libasound2'
has no installation candidate`, which aborts the entire install line and leaves none
of the libraries installed.

On Ubuntu 20.04 and 22.04, install `libfuse2` to execute the AppImage through
FUSE. On Ubuntu 24.04 and Debian 13 the package is `libfuse2t64`, though the plain
`libfuse2` name also resolves there because nothing else provides it. FUSE is
optional: without it, use the AppImage's supported extraction path. CLI
registration does this once automatically, so registered commands do not need
FUSE.

Download and make the AppImage executable:

```bash
sudo mkdir -p /opt/kolux
sudo curl -L https://github.com/TxaisX/nightshift/releases/latest/download/kolux-linux.AppImage \
  -o /opt/kolux/kolux-linux.AppImage
sudo chmod +x /opt/kolux/kolux-linux.AppImage
```

To extract it without FUSE, run the extraction as root because the installation
directory is root-owned:

```bash
cd /opt/kolux
sudo ./kolux-linux.AppImage --appimage-extract
sudo chmod -R a+rX /opt/kolux/squashfs-root
/opt/kolux/squashfs-root/AppRun serve --port 6768
```

The `chmod` is required whenever the extraction runs as a different user than
the server: `--appimage-extract` creates `squashfs-root` as `drwx------` owned by
the extracting user, so anyone else — including a dedicated service user — cannot
even traverse it, and the run fails before Electron starts.

Docker commonly has no FUSE device. Use `--appimage-extract` once or
`--appimage-extract-and-run`; neither requires a privileged container. The
extract-and-run wrapper can print extracted paths before Kolux starts, so
automation that requires stdout to contain only the ready JSON should extract
once and invoke `squashfs-root/AppRun`.

If `Xvfb` was installed somewhere other than `/usr/bin`, confirm systemd can
find it later:

```bash
command -v Xvfb
```

## Run In The Foreground

Start with a foreground run before creating a service:

```bash
LIBGL_ALWAYS_SOFTWARE=1 /opt/kolux/kolux-linux.AppImage serve --port 6768
```

For remote clients, pass the address they should use to reach this server. A
Tailscale address is usually the safest option for private servers:

```bash
LIBGL_ALWAYS_SOFTWARE=1 /opt/kolux/kolux-linux.AppImage serve \
  --port 6768 \
  --pairing-address 100.64.1.20
```

`--pairing-address` is only the address advertised to clients. It does not
change the listener bind address. Kolux binds its WebSocket listener, then
combines the actual bound port with the advertised host when the address omits
a port. Use a reachable LAN/Tailscale hostname or IP, or a complete reverse
proxy URL such as `https://kolux.example.com/runtime` (`http(s)` is normalized
to `ws(s)`). Wildcard addresses such as `*`, `0.0.0.0`, and `::` cannot be
advertised.

The command writes one ready block to stdout after the listener bind and
pairing initialization complete:

```text
Kolux server ready
Bound endpoint: ws://0.0.0.0:6768
Advertised endpoint: ws://100.64.1.20:6768
Pairing URL: kolux://pair?code=...
```

For supervisors, request the versioned single-line JSON contract:

```bash
/opt/kolux/kolux-linux.AppImage serve --port 6768 \
  --pairing-address 100.64.1.20 --json
```

The actual output is one compact line; this example is pretty-printed for
readability:

```json
{
  "type": "kolux_server_ready",
  "schemaVersion": 1,
  "runtimeId": "...",
  "endpoint": "ws://0.0.0.0:6768",
  "boundEndpoint": "ws://0.0.0.0:6768",
  "advertisedEndpoint": "ws://100.64.1.20:6768",
  "managedWslCliReconciliation": "settled",
  "pairing": {
    "available": true,
    "url": "kolux://pair?code=...",
    "endpoint": "ws://100.64.1.20:6768",
    "deviceId": "...",
    "webClientUrl": "...",
    "scope": "runtime",
    "qr": null
  }
}
```

`endpoint` remains a compatibility alias for `boundEndpoint`; new automation
should use the explicit bound and advertised fields.

When the server remains usable but cannot mint an offer, `pairing` remains an
object with `available:false`, a stable `reason`, and operator `guidance`; it is
never silently omitted. `--recipe-json` is stricter and exits with that reason
because its contract requires a pairing URL. Stop a foreground server with
`Ctrl+C`. Stable reasons are `disabled_by_operator`, `websocket_unavailable`,
`device_registry_unavailable`, `e2ee_key_unavailable`, and
`invalid_advertised_endpoint`.

## Systemd Service

Create a dedicated service user and install directory. Run the service as this
user instead of root so the AppImage can keep Chromium's sandbox enabled. Keep
the install directory root-owned: the service needs to read and execute the
AppImage, but must not be able to replace it or the rollback artifacts.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kolux
sudo chown root:root /opt/kolux /opt/kolux/kolux-linux.AppImage
sudo chmod 755 /opt/kolux /opt/kolux/kolux-linux.AppImage
# Only if you ran --appimage-extract: extraction leaves squashfs-root root-only.
sudo chmod -R a+rX /opt/kolux/squashfs-root
```

The last line matters because the two halves of this guide combine badly without
it. `--appimage-extract` writes `squashfs-root` as `drwx------ root root`, so the
`kolux` service user cannot read or traverse the extracted tree and the unit fails
at startup. `chmod 755 /opt/kolux` alone does not reach into it.

For most hosts, one `kolux serve` service is enough because Kolux starts Xvfb on
display `:99` when no display exists:

```ini
# /etc/systemd/system/kolux-serve.service
[Unit]
Description=Kolux runtime server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=kolux
WorkingDirectory=/home/kolux
Environment=LIBGL_ALWAYS_SOFTWARE=1
ExecStart=/opt/kolux/kolux-linux.AppImage serve --port 6768 --pairing-address 100.64.1.20
StandardOutput=journal
StandardError=journal
KillMode=mixed
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `100.64.1.20` with the LAN, Tailscale, tunnel, or public hostname that
clients should use.

`KillMode=mixed` sends the graceful stop signal only to Kolux's main process,
then retains systemd's cgroup-wide `SIGKILL` fallback if shutdown times out.
This lets Kolux keep its owned Xvfb alive until Electron disconnects cleanly.
It does **not** preserve the detached terminal daemon: the daemon and its PTYs
remain in `kolux-serve.service`'s cgroup and are killed when the stop completes.
Every `systemctl stop` or `restart` therefore ends live terminals and agent
processes, even though their persisted layout and terminal history remain.

Exit status `3` means another process already owns this userData profile, so
`RestartPreventExitStatus=3` stops the unit instead of retrying a launch that
cannot succeed. Any other permanent startup fault is capped at 5 starts per
5 minutes; systemd's defaults (10s window, 5 starts) can never trip at
`RestartSec=5`, which is how one bad launch could restart thousands of times.
The start limit counts operator-initiated starts too, so once it trips systemd
refuses a plain `systemctl start` until the 5-minute window rolls over. Run
`sudo systemctl reset-failed kolux-serve.service` first to clear it — the
[Upgrade](#upgrade-steps) and [Roll back](#roll-back) scripts already do.
On systemd older than 230 those two directives are spelled
`StartLimitInterval=`/`StartLimitBurst=` and belong in `[Service]`; Ubuntu
20.04, Kolux's oldest supported base, ships systemd 245.

Enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kolux-serve.service
sudo journalctl -u kolux-serve.service -f
```

`journalctl -o cat` removes journal metadata but still mixes the service's
stdout and stderr. Parse each line as JSON and require the readiness type and
schema before treating the service as ready:

```bash
sudo journalctl -u kolux-serve.service -o cat \
  | jq -Rrc 'fromjson? | select(.type == "kolux_server_ready" and .schemaVersion == 1)'
```

A bounded health check should require that contract within its startup timeout;
otherwise inspect earlier diagnostics for the precise pairing reason, listener
error, or missing library.

## Managed Xvfb Service

If you prefer to own the virtual display lifecycle in systemd, run Xvfb as a
separate service and set `DISPLAY=:99` for Kolux.

```ini
# /etc/systemd/system/kolux-xvfb.service
[Unit]
Description=Virtual X display for Kolux
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

If `command -v Xvfb` returned a different path, update `ExecStart` to that
absolute path.

Then add the display dependency to the Kolux service:

```ini
# /etc/systemd/system/kolux-serve.service
[Unit]
Description=Kolux runtime server
After=network-online.target kolux-xvfb.service
Wants=network-online.target kolux-xvfb.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=kolux
WorkingDirectory=/home/kolux
Environment=DISPLAY=:99
Environment=LIBGL_ALWAYS_SOFTWARE=1
ExecStart=/opt/kolux/kolux-linux.AppImage serve --port 6768 --pairing-address 100.64.1.20
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable both units:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kolux-xvfb.service kolux-serve.service
```

## CLI Install Note

The registered Linux CLI command is `kolux-ide`, not `kolux`, to avoid shadowing
the GNOME Orca screen reader. Desktop-managed terminals receive a
terminal-scoped bare-`kolux` shim. A packaged headless `kolux serve` also makes a
best-effort dispatcher at `$HOME/.local/bin/kolux` for the service user's own
shell, so the Claude Teams launcher can resolve its bare command; it does not
replace another user's `kolux`. From an ordinary shell outside that service
user's managed environment, substitute `kolux-ide` for `kolux` in commands below.

On a headless host, you do not need to open the desktop UI just to run the
server. Invoke the AppImage directly:

```bash
/opt/kolux/kolux-linux.AppImage serve --help
```

Running an AppImage as root requires Chromium's `--no-sandbox` switch before
the command:

```bash
/opt/kolux/kolux-linux.AppImage --no-sandbox serve --port 6768
```

This disables a security boundary. Prefer a dedicated unprivileged service
user, especially when the listener is reachable beyond localhost.

The Linux CLI is named `kolux-ide`, not `kolux`, so it never shadows the GNOME
Orca screen reader at `/usr/bin/orca`. The `.deb` and `.rpm` packages put
`kolux-ide` on `PATH` themselves at install time; with the AppImage it arrives
as `~/.local/bin/kolux-ide` when the CLI is registered.

A packaged `kolux serve` start also writes a bare `kolux` into `~/.local/bin`
that execs the same launcher, which is why the skills commands below can be
typed as `kolux`. It writes it while starting, so it is never the command that
starts the server — the first launch is `kolux-ide serve`, or the AppImage
invoked directly as above. The write is best-effort: it is gated on a packaged
build, it is skipped when no bundled launcher resolves, and it is skipped when
a file Kolux does not own already holds that name (ownership is a marker on the
second line of the file). A host that really does run the screen reader keeps
its own `kolux`.

## Pairing troubleshooting

- A pairing offer is a capability containing a device credential and E2EE
  material. Share it only with the intended client and do not put it in proxy
  access logs.
- `boundEndpoint` is where the process listens; `advertisedEndpoint` is what a
  client dials. A valid-looking offer still cannot connect if DNS, firewall,
  Docker port publishing, Tailscale policy, or a reverse proxy does not route
  the advertised endpoint to the bound port.
- An omitted advertised port uses the actual bound port, including a fallback
  port selected after a collision. An explicit proxy port is preserved. A port
  mismatch therefore means the supplied external routing is wrong, not that
  Kolux changes it.
- Reverse proxies must support WebSocket upgrade and route the advertised path.
  Use `wss://` or `https://` when TLS terminates at the proxy; do not advertise
  `ws://` through an HTTPS-only endpoint.
- Hostnames, IPv4, bracketed IPv6, and raw IPv6 literals are supported. IPv6
  still requires an IPv6-reachable listener/network path.
- `xvfb-run` and `dbus-run-session -- xvfb-run` remain valid diagnostic launch
  shapes, but neither should be needed when `Xvfb` is installed and no display
  is configured. Repeated D-Bus messages without a ready block indicate startup
  did not reach serve mode; confirm the AppImage version and exact argument
  order, especially `--no-sandbox serve`.

If you later install the desktop CLI from Kolux settings, use that CLI for normal
shell workflows. Keep the AppImage path in systemd so service restarts do not
depend on an interactive shell profile.

## Upgrade

`kolux serve` never updates itself. In headless mode Kolux wires up no auto-updater
at all — the built-in updater only runs in the desktop GUI, and no paired mobile
or web client can trigger it remotely. Upgrading is always a deliberate step:
replace the AppImage and restart the service.

Two facts make the persisted-state transition predictable:

- **State lives in the service user's home, not next to the binary.** Persisted
  data is under `/home/kolux/.config/` (Kolux uses both an `kolux` and an `Kolux`
  directory there), fully independent of `/opt/kolux/kolux-linux.AppImage`.
  Replacing the binary never touches projects, worktree metadata, terminal
  history, orchestration state, or paired-device keys — so mobile and web
  clients reconnect after an upgrade without re-pairing.
- **New builds migrate old state on load.** Kolux loads older `kolux-data.json`
  state into the current schema and writes it back in the current shape, so a
  forward upgrade needs no manual data step.

These guarantees do not preserve live processes. The service restart kills
every terminal and agent in its cgroup; an agent conversation may be resumable,
but its current process and any in-flight command are gone.

Immediately before stopping the service, obtain a fresh census as the service's
OS account and home. Use the installer's absolute launcher path so `sudo`'s
`secure_path` cannot hide a per-user registration:
`sudo -Hu kolux /home/kolux/.local/bin/kolux-ide terminal list --json`.
Replace both `kolux` and `/home/kolux` with the service account and home used by
your unit; for an extracted deployment, use its absolute `resources/bin/kolux-ide`
launcher instead. Proceed only when the result is
untruncated, has an explicit `hostScope`, covers every execution host affected
by this service stop, and lists no terminals on those hosts. Every
`omittedHostIds` entry must be explicitly accounted for outside this service's
execution boundary. A separately paired runtime is outside that boundary; local
execution and SSH hosts reached through this runtime are not. An affected or
unknown omission, missing scope, failed request or lost connection is
`unverifiable`, so defer the restart. Do not allow new work between that census
and the stop; Kolux does not yet provide an atomic census-and-stop fence.

Rolling back is the case that needs care — see [Roll back](#roll-back).

### Record the version you deploy

The bundled CLI launcher prints the Kolux build with `kolux-ide --version`. For an
extracted deployment, that launcher is
`squashfs-root/resources/bin/kolux-ide`; deb/rpm installs and CLI registration put
it on `PATH`. Do not use `kolux-linux.AppImage --version` for this audit because
Electron owns the direct binary's version flags and may report its own runtime
version. For an AppImage service, choose a release tag explicitly and record it
next to the binary. The steps below keep that record in `/opt/kolux/VERSION`.

### Upgrade steps

Never download straight onto `/opt/kolux/kolux-linux.AppImage`. The AppImage is
FUSE-mounted, so overwriting it in place while the service runs can crash or
corrupt the live process — and even with the service stopped, a failed or partial
download would clobber the working binary. Instead download to a temporary name
on the same filesystem, verify it, then swap it in with an atomic rename.

Check capacity before starting:

```bash
sudo chown root:root /opt/kolux
sudo chmod 755 /opt/kolux
sudo test ! -L /opt/kolux/kolux-linux.AppImage
sudo chown root:root /opt/kolux/kolux-linux.AppImage
sudo chmod 755 /opt/kolux/kolux-linux.AppImage
# Clear predictable staging names left by an older attempt after locking the directory
sudo rm -f /opt/kolux/kolux-linux.AppImage.new /opt/kolux/VERSION.new \
  /opt/kolux/kolux-linux.AppImage.recovering /opt/kolux/VERSION.recovering
sudo du -sh /home/kolux/.config
df -h /opt/kolux /home/kolux
```

`/opt/kolux` needs room for the compressed Kolux profile archive, the staged
build, and the rollback binary. A rollback extracts the old profile and preserves
the post-upgrade Kolux profile directories, so `/home` needs room for both copies.

Run the following block as one Bash script so its fail-fast and recovery traps
remain active for the whole operation:

```bash
set -euo pipefail

# Replace this example with the release tag you intend to deploy
KOLUX_VERSION=v1.4.147

# Select the release asset on the server where Kolux runs
case "$(uname -m)" in
  x86_64)
    KOLUX_ASSET=kolux-linux.AppImage
    KOLUX_FILE_MACHINE=x86-64
    ;;
  aarch64 | arm64)
    KOLUX_ASSET=kolux-linux-arm64.AppImage
    KOLUX_FILE_MACHINE='ARM aarch64'
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

KOLUX_ROLLBACK_NEW=
KOLUX_ROLLBACK=
KOLUX_SERVICE_STOPPED=0
KOLUX_BINARY_PROMOTED=0
recover_failed_upgrade() {
  exit_status=$?
  trap - EXIT
  set +e
  if ((exit_status != 0)); then
    sudo rm -f /opt/kolux/kolux-linux.AppImage.new /opt/kolux/VERSION.new \
      /opt/kolux/kolux-linux.AppImage.recovering /opt/kolux/VERSION.recovering
  fi
  if ((exit_status != 0)) && [[ -n "$KOLUX_ROLLBACK_NEW" ]] && \
    sudo test -d "$KOLUX_ROLLBACK_NEW"; then
    sudo rm -rf -- "$KOLUX_ROLLBACK_NEW"
  fi
  if ((exit_status != 0 && KOLUX_SERVICE_STOPPED)); then
    recovery_ok=1
    if ((KOLUX_BINARY_PROMOTED)); then
      if ! sudo cp -a "$KOLUX_ROLLBACK/kolux-linux.AppImage" \
        /opt/kolux/kolux-linux.AppImage.recovering || \
        ! sudo mv -f /opt/kolux/kolux-linux.AppImage.recovering \
          /opt/kolux/kolux-linux.AppImage; then
        recovery_ok=0
      fi
      if sudo test -f "$KOLUX_ROLLBACK/VERSION"; then
        if ! sudo cp -a "$KOLUX_ROLLBACK/VERSION" /opt/kolux/VERSION.recovering || \
          ! sudo mv -f /opt/kolux/VERSION.recovering /opt/kolux/VERSION; then
          recovery_ok=0
        fi
      elif ! sudo rm -f /opt/kolux/VERSION; then
        recovery_ok=0
      fi
    fi
    sudo rm -f /opt/kolux/kolux-linux.AppImage.recovering \
      /opt/kolux/VERSION.recovering
    if ((recovery_ok)); then
      # A tripped StartLimitBurst refuses a plain start
      sudo systemctl reset-failed kolux-serve.service || true
      sudo systemctl start kolux-serve.service || true
    else
      echo 'Upgrade recovery failed; service remains stopped' >&2
    fi
  fi
  exit "$exit_status"
}
trap recover_failed_upgrade EXIT

# 1. Stage and verify the new build while the server stays online
sudo curl -fL --retry 3 "https://github.com/TxaisX/nightshift/releases/download/${KOLUX_VERSION}/${KOLUX_ASSET}" \
  -o /opt/kolux/kolux-linux.AppImage.new
sudo chown root:root /opt/kolux/kolux-linux.AppImage.new
sudo chmod 755 /opt/kolux/kolux-linux.AppImage.new

# Both checks must match; either grep stops this fail-fast block otherwise
KOLUX_FILE_INFO=$(LC_ALL=C file /opt/kolux/kolux-linux.AppImage.new)
grep 'ELF .* executable' <<<"$KOLUX_FILE_INFO"
grep -F "$KOLUX_FILE_MACHINE" <<<"$KOLUX_FILE_INFO"

# 2. Assemble the prior binary and version in a root-only rollback bundle
KOLUX_ROLLBACK_BASE=/opt/kolux/kolux-rollback-$(date +%F-%H%M%S-%N)
KOLUX_ROLLBACK_NEW=${KOLUX_ROLLBACK_BASE}.new
KOLUX_ROLLBACK=${KOLUX_ROLLBACK_BASE}.ready
sudo install -d -m 700 "$KOLUX_ROLLBACK_NEW"
sudo cp -a /opt/kolux/kolux-linux.AppImage "$KOLUX_ROLLBACK_NEW/kolux-linux.AppImage"
if sudo test -f /opt/kolux/VERSION; then
  sudo cp -a /opt/kolux/VERSION "$KOLUX_ROLLBACK_NEW/VERSION"
fi

# Stage the new version record before the stop window
printf '%s\n' "$KOLUX_VERSION" | sudo tee /opt/kolux/VERSION.new >/dev/null
sudo chown root:root /opt/kolux/VERSION.new
sudo chmod 644 /opt/kolux/VERSION.new

# 3. Stop the server so the profile backup is consistent
KOLUX_SERVICE_STOPPED=1
sudo systemctl stop kolux-serve.service

# Add only Kolux-owned profile directories, then publish the complete bundle
KOLUX_PROFILE_DIRS=()
for profile_dir in kolux Kolux; do
  if sudo test -L "/home/kolux/.config/$profile_dir"; then
    echo "Refusing symlinked Kolux profile: /home/kolux/.config/$profile_dir" >&2
    exit 1
  fi
  if sudo test -d "/home/kolux/.config/$profile_dir"; then
    if [[ "$profile_dir" == Kolux ]] && \
      sudo test /home/kolux/.config/kolux -ef /home/kolux/.config/Kolux; then
      continue
    fi
    KOLUX_PROFILE_DIRS+=("$profile_dir")
  fi
done
if ((${#KOLUX_PROFILE_DIRS[@]} == 0)); then
  echo 'No Kolux profile directory found under /home/kolux/.config' >&2
  exit 1
fi
sudo tar czf "$KOLUX_ROLLBACK_NEW/profile.tgz" \
  -C /home/kolux/.config "${KOLUX_PROFILE_DIRS[@]}"
sudo chmod 600 "$KOLUX_ROLLBACK_NEW/profile.tgz"
sudo mv "$KOLUX_ROLLBACK_NEW" "$KOLUX_ROLLBACK"

# 4. Atomically replace the binary and version record, then start
KOLUX_BINARY_PROMOTED=1
sudo mv -f /opt/kolux/kolux-linux.AppImage.new /opt/kolux/kolux-linux.AppImage
sudo mv -f /opt/kolux/VERSION.new /opt/kolux/VERSION
# Clears a start-limit hit left by the version being replaced
sudo systemctl reset-failed kolux-serve.service
sudo systemctl start kolux-serve.service
KOLUX_SERVICE_STOPPED=0
trap - EXIT
```

The profile archive created in step 3 captures both Kolux profile directory names
when present without rewinding unrelated tools under `/home/kolux/.config`. The
`.ready` suffix is published only after the prior binary, version record, and
profile archive are complete. If you run the managed Xvfb unit, only
`kolux-serve.service` needs restarting — leave `kolux-xvfb.service` running.

### Verify

```bash
sudo journalctl -u kolux-serve.service -f
```

A healthy start prints one `Kolux server ready` block with the actual bound and
advertised endpoints. Verify those values rather than assuming the configured
port, because a collision can select a fallback port.
Confirm a client reconnects before you discard the backup. The timestamped
rollback bundles are not pruned automatically. After the new version satisfies
your retention policy, select and inspect the newest complete bundle before
removing it:

```bash
shopt -s nullglob
KOLUX_ROLLBACK_SETS=(/opt/kolux/kolux-rollback-*.ready)
((${#KOLUX_ROLLBACK_SETS[@]} > 0))
KOLUX_ROLLBACK=${KOLUX_ROLLBACK_SETS[${#KOLUX_ROLLBACK_SETS[@]} - 1]}
printf 'Removing rollback bundle: %s\n' "$KOLUX_ROLLBACK"
sudo test -d "$KOLUX_ROLLBACK"
sudo rm -rf -- "$KOLUX_ROLLBACK"
```

Each `.ready` directory is a self-contained rollback generation; never combine
files from different bundles.

### Roll back

A rollback is **not** binary-only safe. Once a newer build has started, it can
rewrite `kolux-data.json` in the current schema. If an older build then writes
that file, it can discard fields it does not recognize. The rolling
`kolux-data.json.bak.*` files are corruption-recovery snapshots, not a dedicated
pre-upgrade copy, and normal writes can rotate them away. To roll back cleanly,
restore the backup from step 3 **and** swap the binary back. Run this block as one
Bash script:

```bash
set -euo pipefail

# Select and validate one complete generation before taking the service offline
shopt -s nullglob
KOLUX_ROLLBACK_SETS=(/opt/kolux/kolux-rollback-*.ready)
((${#KOLUX_ROLLBACK_SETS[@]} > 0))
KOLUX_ROLLBACK=${KOLUX_ROLLBACK_SETS[${#KOLUX_ROLLBACK_SETS[@]} - 1]}
sudo test -f "$KOLUX_ROLLBACK/kolux-linux.AppImage"
sudo tar tzf "$KOLUX_ROLLBACK/profile.tgz" >/dev/null

# Extract and validate the old profile while the current server stays online
sudo test ! -L /home
KOLUX_HOME_OWNER=$(sudo stat -c %u /home)
KOLUX_HOME_MODE=$(sudo stat -c %a /home)
if [[ "$KOLUX_HOME_OWNER" != 0 ]] || ((8#$KOLUX_HOME_MODE & 0022)) || \
  sudo -u kolux test -w /home; then
  echo 'Refusing rollback because /home is not root-controlled' >&2
  exit 1
fi
KOLUX_RESTORE=$(sudo mktemp -d /home/.kolux-restore.XXXXXX)
KOLUX_SERVICE_STOPPED=0
KOLUX_MOVED_CURRENT_DIRS=()
KOLUX_INSTALLED_RESTORE_DIRS=()
KOLUX_CURRENT_BINARY_MOVED=0
KOLUX_CURRENT_VERSION_MOVED=0
KOLUX_VERSION_REPLACEMENT_STARTED=0
KOLUX_POST_UPGRADE=
KOLUX_ROLLBACK_BINARY_STAGED=
KOLUX_ROLLBACK_VERSION_STAGED=
KOLUX_ROLLBACK_HAS_VERSION=0
restart_after_rollback_error() {
  exit_status=$?
  trap - EXIT
  set +e
  if ((exit_status != 0 && KOLUX_SERVICE_STOPPED)); then
    recovery_ok=1
    if ((${#KOLUX_INSTALLED_RESTORE_DIRS[@]})); then
      for profile_dir in "${KOLUX_INSTALLED_RESTORE_DIRS[@]}"; do
        if sudo test -d "/home/kolux/.config/$profile_dir"; then
          if ! sudo mv "/home/kolux/.config/$profile_dir" \
            "$KOLUX_RESTORE/$profile_dir.failed"; then
            recovery_ok=0
          fi
        fi
      done
    fi
    if ((${#KOLUX_MOVED_CURRENT_DIRS[@]})); then
      for profile_dir in "${KOLUX_MOVED_CURRENT_DIRS[@]}"; do
        if sudo test -d "$KOLUX_POST_UPGRADE/$profile_dir"; then
          if ! sudo mv "$KOLUX_POST_UPGRADE/$profile_dir" /home/kolux/.config/; then
            recovery_ok=0
          fi
        elif ! sudo test -d "/home/kolux/.config/$profile_dir"; then
          recovery_ok=0
        fi
      done
    fi
    if [[ -n "$KOLUX_POST_UPGRADE" ]]; then
      sudo rmdir "$KOLUX_POST_UPGRADE" 2>/dev/null || true
    fi
    if ((KOLUX_CURRENT_BINARY_MOVED)); then
      if sudo test -f "$KOLUX_CURRENT_BINARY"; then
        if ! sudo mv -f "$KOLUX_CURRENT_BINARY" /opt/kolux/kolux-linux.AppImage; then
          recovery_ok=0
        fi
      elif ! sudo test -f /opt/kolux/kolux-linux.AppImage; then
        recovery_ok=0
      fi
    fi
    if ((KOLUX_CURRENT_VERSION_MOVED)); then
      if sudo test -f "$KOLUX_CURRENT_VERSION"; then
        if ! sudo mv -f "$KOLUX_CURRENT_VERSION" /opt/kolux/VERSION; then
          recovery_ok=0
        fi
      elif ! sudo test -f /opt/kolux/VERSION; then
        recovery_ok=0
      fi
    elif ((KOLUX_VERSION_REPLACEMENT_STARTED)); then
      if ! sudo rm -f /opt/kolux/VERSION; then
        recovery_ok=0
      fi
    fi
    if ((recovery_ok)); then
      # A tripped StartLimitBurst refuses a plain start
      sudo systemctl reset-failed kolux-serve.service || true
      sudo systemctl start kolux-serve.service || true
    else
      echo 'Rollback recovery failed; service remains stopped' >&2
    fi
  fi
  if [[ -n "$KOLUX_ROLLBACK_BINARY_STAGED" ]]; then
    sudo rm -f -- "$KOLUX_ROLLBACK_BINARY_STAGED"
  fi
  if [[ -n "$KOLUX_ROLLBACK_VERSION_STAGED" ]]; then
    sudo rm -f -- "$KOLUX_ROLLBACK_VERSION_STAGED"
  fi
  sudo rm -rf -- "$KOLUX_RESTORE"
  exit "$exit_status"
}
trap restart_after_rollback_error EXIT

if [[ "$(sudo stat -c %d "$KOLUX_RESTORE")" != \
  "$(sudo stat -c %d /home/kolux/.config)" ]]; then
  echo 'Refusing rollback because staging and the Kolux profile are on different filesystems' >&2
  exit 1
fi
sudo tar xzf "$KOLUX_ROLLBACK/profile.tgz" -C "$KOLUX_RESTORE"
KOLUX_RESTORE_DIRS=()
for profile_dir in kolux Kolux; do
  if sudo test -L "$KOLUX_RESTORE/$profile_dir"; then
    echo "Rollback bundle contains a symlinked profile: $profile_dir" >&2
    exit 1
  fi
  if sudo test -d "$KOLUX_RESTORE/$profile_dir"; then
    if [[ "$profile_dir" == Kolux ]] && \
      sudo test "$KOLUX_RESTORE/kolux" -ef "$KOLUX_RESTORE/Kolux"; then
      continue
    fi
    KOLUX_RESTORE_DIRS+=("$profile_dir")
  fi
done
if ((${#KOLUX_RESTORE_DIRS[@]} == 0)); then
  echo "Rollback bundle has no Kolux profile directories: $KOLUX_ROLLBACK" >&2
  exit 1
fi
for profile_dir in "${KOLUX_RESTORE_DIRS[@]}"; do
  sudo chown -R kolux:kolux "$KOLUX_RESTORE/$profile_dir"
done

KOLUX_ROLLBACK_STAMP=$(date +%F-%H%M%S-%N)
KOLUX_ROLLBACK_BINARY_STAGED=/opt/kolux/kolux-linux.AppImage.rollback-staged-$KOLUX_ROLLBACK_STAMP
sudo cp -a "$KOLUX_ROLLBACK/kolux-linux.AppImage" "$KOLUX_ROLLBACK_BINARY_STAGED"
if sudo test -f "$KOLUX_ROLLBACK/VERSION"; then
  KOLUX_ROLLBACK_HAS_VERSION=1
  KOLUX_ROLLBACK_VERSION_STAGED=/opt/kolux/VERSION.rollback-staged-$KOLUX_ROLLBACK_STAMP
  sudo cp -a "$KOLUX_ROLLBACK/VERSION" "$KOLUX_ROLLBACK_VERSION_STAGED"
fi

KOLUX_SERVICE_STOPPED=1
sudo systemctl stop kolux-serve.service

# Preserve and replace only Kolux-owned profile directories
KOLUX_CURRENT_DIRS=()
for profile_dir in kolux Kolux; do
  if sudo test -L "/home/kolux/.config/$profile_dir"; then
    echo "Refusing symlinked Kolux profile: /home/kolux/.config/$profile_dir" >&2
    exit 1
  fi
  if sudo test -d "/home/kolux/.config/$profile_dir"; then
    if [[ "$profile_dir" == Kolux ]] && \
      sudo test /home/kolux/.config/kolux -ef /home/kolux/.config/Kolux; then
      continue
    fi
    KOLUX_CURRENT_DIRS+=("$profile_dir")
  fi
done
KOLUX_POST_UPGRADE=/home/kolux/.config/kolux-rollback-$KOLUX_ROLLBACK_STAMP
sudo install -d -o kolux -g kolux -m 700 "$KOLUX_POST_UPGRADE"
if ((${#KOLUX_CURRENT_DIRS[@]})); then
  for profile_dir in "${KOLUX_CURRENT_DIRS[@]}"; do
    KOLUX_MOVED_CURRENT_DIRS+=("$profile_dir")
    sudo mv "/home/kolux/.config/$profile_dir" "$KOLUX_POST_UPGRADE/"
  done
fi
for profile_dir in "${KOLUX_RESTORE_DIRS[@]}"; do
  KOLUX_INSTALLED_RESTORE_DIRS+=("$profile_dir")
  sudo mv "$KOLUX_RESTORE/$profile_dir" /home/kolux/.config/
done

KOLUX_CURRENT_BINARY=/opt/kolux/kolux-linux.AppImage.rollback-current-$KOLUX_ROLLBACK_STAMP
KOLUX_CURRENT_BINARY_MOVED=1
sudo mv /opt/kolux/kolux-linux.AppImage "$KOLUX_CURRENT_BINARY"
sudo mv -f "$KOLUX_ROLLBACK_BINARY_STAGED" /opt/kolux/kolux-linux.AppImage

KOLUX_CURRENT_VERSION=/opt/kolux/VERSION.rollback-current-$KOLUX_ROLLBACK_STAMP
if sudo test -f /opt/kolux/VERSION; then
  KOLUX_CURRENT_VERSION_MOVED=1
  sudo mv /opt/kolux/VERSION "$KOLUX_CURRENT_VERSION"
fi
KOLUX_VERSION_REPLACEMENT_STARTED=1
if ((KOLUX_ROLLBACK_HAS_VERSION)); then
  sudo mv -f "$KOLUX_ROLLBACK_VERSION_STAGED" /opt/kolux/VERSION
else
  sudo rm -f /opt/kolux/VERSION
fi
# The crash-looping build you are rolling back from tripped StartLimitBurst
sudo systemctl reset-failed kolux-serve.service
sudo systemctl start kolux-serve.service
KOLUX_SERVICE_STOPPED=0
sudo rm -rf -- "$KOLUX_RESTORE"
trap - EXIT
```

Restoring the backup is required, not optional: swapping only the binary leaves
the newer `kolux-data.json` in place, where an older build can discard state it
does not understand. Keep the pre-upgrade backup until the new version is proven
on your host. The `kolux-rollback-*` directory inside `.config` is also retained
deliberately. The post-upgrade binary and version record are retained in
`/opt/kolux` with the same `rollback-current-<timestamp>` suffix. Inspect these
artifacts and remove them according to your retention policy after the rollback
is resolved.

## Installing Agent Skills Without A Desktop

Kolux's agent skills (CLI usage, orchestration, computer use, etc.) are normally
installed from Kolux Settings, which pre-fills an `npx skills add ... --global`
command in a terminal for you to run. A headless host has no Settings UI, so
use `kolux skills install` instead:

```bash
kolux skills install                                      # list installable skills
kolux skills install --skill kolux-cli --skill orchestration # install globally (default)
kolux skills install --skill kolux-cli --local              # install into the current project only
kolux skills install --all                                 # install every bundled skill
kolux skills install --all --dry-run                       # print the npx command without running it
```

This resolves the same `npx skills add <repo> --skill <name> ...` command
Settings would show you (adding `--global` unless `--local` is passed), then
runs it and forwards its output and exit code. It requires `node`/`npx` on the
host; it does not need a running Kolux runtime.

Unlike the command Settings shows, the spawned one adds `npx --yes` and `-y`.
Without them the `skills` CLI opens an interactive agent picker and blocks
forever on any allocated TTY — which includes a normal `ssh` session. Use
`--dry-run` to see the exact command that will run.

Settings keeps that picker deliberately, because choosing which agents get a
skill is a real decision. A headless run cannot answer it, so instead of dropping
the choice Kolux makes it explicitly: it passes an `--agent` list built from the
coding agents it detects on the host, plus the shared `.agents/skills` directory
it reads itself. Left to decide on its own with no agent detected, the `skills`
CLI installs into all ~75 agents it knows and leaves a config directory for each.
Override the targets yourself, or narrow to the shared directory alone:

```bash
kolux skills install --skill kolux-cli --agent claude-code,codex
kolux skills install --skill kolux-cli --agent universal
```

If Kolux detects no agent at all, `kolux skills install` stops and asks for
`--agent` rather than guessing.

To refresh already-installed skills, `kolux skills update` mirrors the same
selection flags (`--skill`, `--all`, `--local`, `--dry-run`) and resolves to
`npx skills update <names...>` with a matching scope flag — `--global`, or
`--project` when you pass `--local`:

```bash
kolux skills update --all                                  # update every bundled skill globally
kolux skills update --skill kolux-cli --dry-run             # print the npx command without running it
```

`kolux skills update` only refreshes skills that are already installed — it exits
0 without doing anything for a skill that is missing, so install it first. More
generally, a 0 exit means the `skills` CLI ran without erroring, not that it
wrote anything; read its output to confirm what changed.

`--json` covers the skill listing and `--dry-run`. A real run streams the
`skills` CLI's own non-JSON output and rejects `--json`.

Both commands install onto the machine that runs them. In a Kolux SSH workspace
or the WSL bridge the `kolux` shim forwards commands to the Kolux host, so they
refuse to run there and print the command to run on the machine you want.

## Troubleshooting

- `dlopen(): error loading libfuse.so.2`: install `libfuse2`.
- `Missing X server or $DISPLAY`: install `xvfb`, or start the managed Xvfb
  service and set `DISPLAY=:99`.
- `[serve] Xvfb failed to start` or `[serve] Could not start Xvfb`: confirm
  `command -v Xvfb` and that it is on the service `PATH`.
- GPU or DRI warnings on a VPS: keep `LIBGL_ALWAYS_SOFTWARE=1` in the service
  environment.
- Chromium sandbox errors: confirm the service is running as the non-root
  `kolux` user and that `/opt/kolux` is readable by that user, including
  `/opt/kolux/squashfs-root` if you extracted the AppImage.
- Clients cannot connect: make sure `--pairing-address` is an address reachable
  from the client, and make sure firewalls allow the selected `--port`.
- Journal shows `Another Kolux instance is already running for this userData
profile` and the unit exits `3`: another process already owns the profile, so
  `RestartPreventExitStatus=3` leaves the unit `failed` on purpose. Find the
  owner with `systemctl status kolux-serve` and `pgrep -af kolux`. Stop it (or
  keep it and leave the unit down), then run
  `sudo systemctl reset-failed kolux-serve && sudo systemctl start kolux-serve` —
  `reset-failed` clears the failed state and any start-limit counter. If no owner
  exists, the lock is stale (Chromium recorded a pid that
  has since been reused): remove `SingletonLock` and `SingletonSocket` from the
  userData directory and start again. If an earlier crash-loop already leaked
  AppImage mounts, list them with `findmnt -rn -t fuse.kolux-linux.AppImage` and
  release only the ones with no live owner using `fusermount -uz <target>` (or
  `umount -l <target>`), leaving the running instance's mount alone.
- Service crash-loops right after an upgrade: use [Roll back](#roll-back) with
  the pre-upgrade `.ready` bundle. Do not rerun the upgrade first; doing so would
  make the crashing version the next rollback binary. The loop trips
  `StartLimitBurst`, so any manual `systemctl start` outside that script needs
  `sudo systemctl reset-failed kolux-serve.service` first.
- Diagnosing other missing libraries: extract the AppImage without launching it
  with `./kolux-linux.AppImage --appimage-extract`, then run
  `ldd squashfs-root/kolux-ide` to list any shared libraries the host is missing.
  The Electron binary is `kolux-ide`, not `kolux`; `ldd` on a path that does not
  exist prints nothing and exits cleanly, which reads as a clean result in
  exactly the situation where you are hunting a missing library.
