// POSIX `sh` probe listing every plausible remote Node binary, one per line.
// Kept out of the resolver so the shell text can grow without pushing that file
// past its line budget.

// Why the dotfile scrape: sshd's exec channel runs without the user's profile, so
// MISE_DATA_DIR / NVM_DIR set in ~/.zshrc are not in this environment. Reading the
// assignment out of the dotfiles is the only way to see a relocated data dir.
export const REMOTE_NODE_PATH_PROBE_SCRIPT = `
command -v node 2>/dev/null
kolux_dotfile_dirs() {
  kolux_var_name=$1
  kolux_dirs=$2
  for kolux_file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zprofile" "$HOME/.zshrc"
  do
    [ -r "$kolux_file" ] || continue
    kolux_dir_from_file=$(sed -n "s/^[[:space:]]*export[[:space:]][[:space:]]*$kolux_var_name[[:space:]]*=[[:space:]]*//p; s/^[[:space:]]*$kolux_var_name[[:space:]]*=[[:space:]]*//p" "$kolux_file" | tail -n 1)
    case "$kolux_dir_from_file" in
      \\"*\\") kolux_dir_from_file=\${kolux_dir_from_file#\\"}; kolux_dir_from_file=\${kolux_dir_from_file%%\\"*} ;;
      \\'*\\') kolux_dir_from_file=\${kolux_dir_from_file#\\'}; kolux_dir_from_file=\${kolux_dir_from_file%%\\'*} ;;
      *) kolux_dir_from_file=\${kolux_dir_from_file%%[[:space:]]*} ;;
    esac
    case "$kolux_dir_from_file" in
      '$XDG_DATA_HOME'*) kolux_dir_from_file="\${XDG_DATA_HOME:-$HOME/.local/share}\${kolux_dir_from_file#'$XDG_DATA_HOME'}" ;;
      '$HOME'*) kolux_dir_from_file="$HOME\${kolux_dir_from_file#'$HOME'}" ;;
      "~/"*) kolux_dir_from_file="$HOME/\${kolux_dir_from_file#\\~/}" ;;
    esac
    [ -n "$kolux_dir_from_file" ] && kolux_dirs="$kolux_dirs
$kolux_dir_from_file"
  done
  printf '%s\\n' "$kolux_dirs"
}
nvm_dirs=\${NVM_DIR:-"$HOME/.nvm"}
nvm_dirs=$(kolux_dotfile_dirs NVM_DIR "$nvm_dirs")
printf '%s\\n' "$nvm_dirs" | while IFS= read -r nvm_dir
do
  [ -n "$nvm_dir" ] || continue
  for candidate in "$nvm_dir"/versions/node/*/bin/node
  do
    [ -x "$candidate" ] && printf '%s\\n' "$candidate"
  done
done
mise_dirs=\${MISE_DATA_DIR:-\${XDG_DATA_HOME:-$HOME/.local/share}/mise}
mise_dirs=$(kolux_dotfile_dirs MISE_DATA_DIR "$mise_dirs")
printf '%s\\n' "$mise_dirs" | while IFS= read -r mise_dir
do
  [ -n "$mise_dir" ] || continue
  [ -x "$mise_dir/shims/node" ] && printf '%s\\n' "$mise_dir/shims/node"
  for candidate in "$mise_dir"/installs/node/*/bin/node
  do
    [ -x "$candidate" ] && printf '%s\\n' "$candidate"
  done
done
for candidate in \\
  /usr/local/bin/node \\
  /opt/homebrew/bin/node \\
  "$HOME/.local/bin/node" \\
  "$HOME/.fnm/aliases/default/bin/node" \\
  "$HOME/.fnm/node-versions"/*/installation/bin/node \\
  "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node \\
  "$HOME/.local/share/mise/shims/node" \\
  "$HOME/.local/share/mise/installs/node"/*/bin/node \\
  "$HOME/.asdf/shims/node" \\
  "$HOME/.asdf/installs/nodejs"/*/bin/node \\
  "$HOME/.volta/bin/node" \\
  /usr/local/n/versions/node/*/bin/node
do
  [ -x "$candidate" ] && printf '%s\\n' "$candidate"
done
true
`
