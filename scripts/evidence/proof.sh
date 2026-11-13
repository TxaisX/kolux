#!/usr/bin/env bash
# T-152-c (6): the hooks on/off text proof on a COPY of a Claude Code settings file, run with a
# kolux-dev exe (`kolux-dev agent hooks on|off`, the same sync()/clear() the app's switch runs).
#
#   bash scripts/evidence/proof.sh <kolux-dev.exe> <settings copy> [scratch root]
#
# The scratch root (default G:/Temp/hooks-t152c/proof, refused outside G:/Temp/) is wiped and gets:
#   tmp/                 TEMP and TMP for the exe (a temp folder that holds the home is refused as scratch)
#   tmp/claude-config/   CLAUDE_CONFIG_DIR, with the .kolux-scratch marker and the copy as settings.json
#   tmp/codex/           CODEX_HOME, seeded with {"hooks":{}}
#   home/                USERPROFILE and HOME (APPDATA and LOCALAPPDATA below it)
#   profile/             KOLUX_APP_DIR, the Kolux profile the CLI saves the switch in
# Nothing outside the root is read or written except the exe and the input copy (read only). Only
# hashes, byte counts, key names and group counts are printed, never the settings text.
set -u
EXE=${1:?usage: proof.sh <kolux-dev.exe> <settings copy> [scratch root]}
INPUT=${2:?usage: proof.sh <kolux-dev.exe> <settings copy> [scratch root]}
ROOT=${3:-G:/Temp/hooks-t152c/proof}
case "$ROOT" in G:/Temp/?*) ;; *) echo "refusing scratch root $ROOT (it must be under G:/Temp/)"; exit 2 ;; esac

rm -rf "$ROOT"
mkdir -p "$ROOT/tmp/claude-config" "$ROOT/tmp/codex" "$ROOT/home/AppData/Roaming" "$ROOT/home/AppData/Local" "$ROOT/profile"
: > "$ROOT/tmp/claude-config/.kolux-scratch"
cp "$INPUT" "$ROOT/tmp/claude-config/settings.json"
printf '{"hooks":{}}' > "$ROOT/tmp/codex/hooks.json"
FILE="$ROOT/tmp/claude-config/settings.json"
HOOKS="$ROOT/home/.kolux/agent-hooks"

W=$(cygpath -w "$ROOT")
export TEMP="$W\\tmp" TMP="$W\\tmp" CLAUDE_CONFIG_DIR="$W\\tmp\\claude-config" CODEX_HOME="$W\\tmp\\codex"
export USERPROFILE="$W\\home" HOME="$W\\home" APPDATA="$W\\home\\AppData\\Roaming" LOCALAPPDATA="$W\\home\\AppData\\Local"
export KOLUX_APP_DIR="$W\\profile"
unset KOLUX_USER_DATA_PATH

# The counter: shape of one settings file, compared with the input copy.
cat > "$ROOT/count.js" <<'JS'
const fs = require("fs"), crypto = require("crypto");
const [, , file, input, mode] = process.argv;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const mine = (s) => typeof s === "string" && /\.kolux(-rs)?\/agent-hooks/.test(s.replace(/\\/g, "/"));
if (mode === "target") {
  // The folder name Kolux keys this settings file's slot to: sha256 of the resolved path, 16 hex.
  console.log(sha("\\\\?\\" + fs.realpathSync.native(file)).slice(0, 16));
  process.exit(0);
}
const bytes = fs.readFileSync(file), v = JSON.parse(bytes), u = JSON.parse(fs.readFileSync(input));
const hooks = v.hooks || {}, events = Object.keys(hooks);
const groups = events.flatMap((e) => hooks[e]);
const cmds = groups.flatMap((g) => g.hooks || []);
const isMine = (g) => (g.hooks || []).some((h) => mine(h.command) || [].concat(h.args || []).some(mine));
console.log(`${file}: sha256 ${sha(bytes)} bytes ${bytes.length} top-level keys ${Object.keys(v).length} events ${events.length} (${events.join(",")}) groups ${groups.length} hook commands ${cmds.length} .kolux entries ${cmds.filter((h) => mine(h.command)).length} skillOverrides ${Object.keys(v.skillOverrides || {}).length} statusLine is Kolux's ${mine(v.statusLine && v.statusLine.command)}`);
const theirs = Object.entries(u.hooks || {}).flatMap(([e, gs]) => gs.map((g) => [e, JSON.stringify(g)]));
const kept = theirs.filter(([e, g]) => (hooks[e] || []).some((h) => JSON.stringify(h) === g));
console.log(`pre-existing hook groups still in place, unchanged: ${kept.length} of ${theirs.length} (events: ${[...new Set(theirs.map(([e]) => e))].join(",")})`);
const other = Object.keys(u).filter((k) => k !== "hooks" && k !== "statusLine");
console.log(`other top-level keys unchanged: ${other.filter((k) => JSON.stringify(u[k]) === JSON.stringify(v[k])).length} of ${other.length}`);
const strip = (x) => {
  const c = JSON.parse(JSON.stringify(x));
  delete c.statusLine;
  for (const e of Object.keys(c.hooks || {})) {
    c.hooks[e] = c.hooks[e].filter((g) => !isMine(g));
    if (!c.hooks[e].length) delete c.hooks[e];
  }
  if (c.hooks && !Object.keys(c.hooks).length && !(u.hooks && !Object.keys(u.hooks).length)) delete c.hooks;
  return JSON.stringify(c);
};
console.log(`parsed-equal once Kolux entries and statusLine are set aside: ${strip(v) === strip(u)}`);
console.log(`statusLine slot equal to the copy's: ${JSON.stringify(v.statusLine) === JSON.stringify(u.statusLine)}`);
JS

count() { node "$ROOT/count.js" "$FILE" "$INPUT" | sed 's/^/    /'; }
files() { (cd "$HOOKS" 2>/dev/null && find . -type f | sort | while read -r f; do echo "    $f $(wc -c < "$f") B"; done); }
run() {
  echo "  --- kolux-dev agent hooks $1"
  "$EXE" agent hooks "$1" --json > "$ROOT/out.json" 2> "$ROOT/err.txt"
  echo "    exit $?"
  grep -aE "kolux(-rs)?:" "$ROOT/err.txt" | sed 's/^/    /'
  echo "    reply: $(tr -d '\r\n' < "$ROOT/out.json")"
}

echo "  exe: $EXE"
echo "  exe sha256 $(sha256sum "$EXE" | cut -d' ' -f1) bytes $(wc -c < "$EXE")"
echo "  input copy: $INPUT"
echo "  input sha256 $(sha256sum "$INPUT" | cut -d' ' -f1) bytes $(wc -c < "$INPUT")"
echo "  env: TEMP=$TEMP CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR CODEX_HOME=$CODEX_HOME USERPROFILE=$USERPROFILE KOLUX_APP_DIR=$KOLUX_APP_DIR"
KEY=$(node "$ROOT/count.js" "$FILE" "$INPUT" target)
echo "  expected slot folder for this settings file: targets/$KEY"
echo "  --- before on"
count
run on
echo "  --- after on"
count
echo "    Kolux's hook folder:"
files
for f in claude-status-prev.sh claude-status-prev.json claude-settings.sha256; do
  [ -e "$HOOKS/$f" ] && echo "    UNEXPECTED: $f at the hook folder's top (a slot shared by every target)"
done
T="$HOOKS/targets/$KEY"
[ -d "$T" ] && echo "    slot folder targets/$KEY present: true" || echo "    slot folder targets/$KEY present: FALSE"
echo "    record targets/$KEY/claude-settings.sha256:"
sed 's/^\([0-9a-f]\{64\}\)  .*[\\/]\(settings[^\\/]*\)$/      \1  \2/' "$T/claude-settings.sha256"
node -e '
const fs = require("fs"), [, slot, sh, input] = process.argv, u = JSON.parse(fs.readFileSync(input));
console.log(`    claude-status-prev.json equals the copy statusLine slot: ${fs.readFileSync(slot, "utf8") === JSON.stringify(u.statusLine ?? null)}`);
const c = u.statusLine && u.statusLine.command;
console.log(`    claude-status-prev.sh equals its command: ${c ? fs.readFileSync(sh, "utf8") === c + "\n" : !fs.existsSync(sh)}`);
' "$T/claude-status-prev.json" "$T/claude-status-prev.sh" "$INPUT"
grep -q "targets/$KEY/claude-status-prev.sh" "$FILE" && echo "    the installed status line runs targets/$KEY/claude-status-prev.sh: true" || echo "    the installed status line runs targets/$KEY/claude-status-prev.sh: FALSE"

run off
echo "  --- after off"
sha256sum "$INPUT" "$FILE" "$FILE.bak-kolux" | sed 's/^/    /'
cmp -s "$INPUT" "$FILE" && echo "    cmp: post-off file byte-identical to the copy" || echo "    cmp: post-off file DIFFERS from the copy"
count
echo "    prev files left in targets/$KEY: $(find "$T" -name 'claude-status-prev*' | wc -l)"
echo "    codex/hooks.json after: $(sha256sum "$ROOT/tmp/codex/hooks.json" | cut -d' ' -f1) bytes $(wc -c < "$ROOT/tmp/codex/hooks.json") text $(cat "$ROOT/tmp/codex/hooks.json")"

# Another spelling of the same config folder (`..`, upper case, forward slashes) keys the same slot.
export CLAUDE_CONFIG_DIR="$(cygpath -m "$ROOT" | tr '[:lower:]' '[:upper:]')/TMP/codex/../CLAUDE-CONFIG"
echo "  --- again with CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"
run on
echo "    slot folders under targets: $(ls "$HOOKS/targets" | tr '\n' ' ')"
run off
cmp -s "$INPUT" "$FILE" && echo "    cmp: post-off file byte-identical to the copy" || echo "    cmp: post-off file DIFFERS from the copy"
echo "    Kolux's hook folder at the end:"
files
