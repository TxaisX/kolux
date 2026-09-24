import { getPosixOmpShellWrapper } from '../pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from '../pty/codex-shell-launch-preflight'
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../bash-prompt-command-composition'
import { BASH_FEATURE_CHANNEL_BLOCK, SHELL_STARTUP_IDENTITY_MARKER_BLOCK } from '../shell-templates'

export function getDaemonBashShellReadyRcfileContent(): string {
  return `# Kolux daemon bash shell-ready wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Why a plain variable: the channel is consumed and destroyed in these first
# lines, so nothing this shell later spawns can see or inherit the selection.
__kolux_ready_marker=""
__kolux_has_feature ready && __kolux_ready_marker=1
unset _kolux_shell_features
unset -f __kolux_has_feature
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Why: enable bracketed paste so Kolux can deliver a multiline startup prompt as
# a single literal paste (ESC[200~…ESC[201~); without it, older readline builds
# treat each embedded newline as Enter and mangle the prompt into PS2
# continuation. Modern readline defaults this on; force it for the rest.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
__kolux_restore_agent_teams_path() {
  [[ -n "\${KOLUX_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${KOLUX_AGENT_TEAMS_SHIM_DIR}"|"\${KOLUX_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${KOLUX_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__kolux_restore_agent_teams_path
[[ -n "\${KOLUX_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${KOLUX_MIMOCODE_HOME}"
${getPosixOmpShellWrapper()}
# Why: Codex must keep using Kolux's runtime CODEX_HOME after profile scripts.
[[ -n "\${KOLUX_CODEX_HOME:-}" ]] && export CODEX_HOME="\${KOLUX_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight()}
# Why: emit OSC 133 C/D so terminal-command-lifecycle can drop stale agent
# status when the foreground command exits — mirrors the zsh daemon wrapper.
# Without this, bash users (default on most Linux distros) keep a stuck
# 'working' spinner after the CLI exits without a Stop/SessionEnd hook.
__kolux_initializing_wrapper=1
__kolux_osc133_precmd() {
  local exit_code=$?
  __kolux_in_prompt_command=1
  if [[ -n "\${__kolux_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __kolux_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__kolux_osc133_preexec() {
  if [[ -n "\${__kolux_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__kolux_prompt_status_capture_command" ]]; then
    unset __kolux_initial_prompt
    __kolux_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__kolux_initializing_wrapper:-}\${__kolux_in_debug_capture:-}\${__kolux_initial_prompt:-}\${__kolux_in_prompt_dispatch:-}\${__kolux_in_legacy_prompt_wrapper:-}\${__kolux_in_prompt_command:-}" ]]; then
    [[ -z "\${__kolux_initializing_wrapper:-}\${__kolux_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__kolux_initial_prompt:-}" && "$BASH_COMMAND" == "__kolux_osc133_precmd" ]]; then
      unset __kolux_initial_prompt; return 0
    fi
    if [[ -n "\${__kolux_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__kolux_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__kolux_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __kolux_exit_code == 0 ))'|'__kolux_restore_prompt_status "$__kolux_exit_code"'|'eval "$__kolux_prompt_part"'|'eval "$__kolux_final_prompt_command"'|__kolux_dispatching_user_prompt_command=*|__kolux_osc133_precmd|__kolux_osc133_epilogue) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__kolux_run_prompt_command_array" || "$BASH_COMMAND" == "__kolux_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__kolux_in_legacy_prompt_wrapper:-}" || -n "\${__kolux_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__kolux_in_prompt_command:-}" && "$BASH_COMMAND" == "__kolux_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in
    __kolux_osc133_*|__kolux_restore_prompt_status|__bp_*) return 0 ;;
  esac
  case "$BASH_COMMAND" in
    __kolux_osc133_precmd|__kolux_osc133_epilogue) return 0 ;;
    # The prefix is only special while bash-preexec prompt hooks run.
    __bp_*) [[ -n "\${__kolux_in_prompt_command:-}" ]] && return 0 ;;
  esac
  __kolux_run_user_debug_trap
  # Why: a framework (bash-preexec/starship) may replace our DEBUG trap at the
  # first prompt; __kolux_osc133_epilogue re-takes it each prompt and stores the
  # framework's trap here, so the framework's own preexec still runs while our
  # command-start C survives its re-arm.
  if [[ -n "\${__kolux_chained_debug_trap:-}" ]]; then
    eval "$__kolux_chained_debug_trap" || true
  fi
  [[ -z "\${__kolux_in_prompt_command:-}" ]] || return 0
  # Why: a chained trap can invoke us more than once for a single command, so
  # emit C only on the first fire (the __kolux_in_command gate), and never for a
  # prompt-time hook — ours or bash-preexec's __bp_* helpers.
  [[ -z "\${__kolux_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __kolux_in_command=1
}
# Why: adopt the latest user trap before Kolux retakes lifecycle ownership.
__kolux_osc133_epilogue() {
  unset __kolux_in_prompt_command
  __kolux_adopt_outer_debug_trap
  trap '__kolux_osc133_preexec' DEBUG
  # Readline renders PS1 after entering raw mode; prompt hooks still run in cooked mode.
  if [[ -n "$__kolux_ready_marker" ]]; then
    PS1="\${PS1-}"'\\[\\e]777;kolux-shell-ready\\a\\]'
    __kolux_ready_marker=""
  fi
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__kolux_prepend_prompt_command "__kolux_osc133_precmd"
__kolux_append_prompt_command '__kolux_in_debug_capture=1; __kolux_prompt_had_functrace=""; if [[ -o functrace ]]; then __kolux_prompt_had_functrace=1; set +T; fi; __kolux_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__kolux_prompt_had_functrace" ]] || set -T; unset __kolux_prompt_had_functrace __kolux_in_debug_capture'
__kolux_append_prompt_command "__kolux_osc133_epilogue"
__kolux_had_functrace=""
[[ -o functrace ]] && __kolux_had_functrace=1
set +T
__kolux_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__kolux_had_functrace" ]] || set -T
if [[ -n "$__kolux_debug_trap_spec" && "$__kolux_debug_trap_spec" != "trap -- '__kolux_osc133_preexec' DEBUG" ]]; then
  __kolux_debug_trap_command="\${__kolux_debug_trap_spec#trap -- }"
  __kolux_debug_trap_command="\${__kolux_debug_trap_command% DEBUG}"
  eval "__kolux_user_debug_trap=$__kolux_debug_trap_command"
fi
unset __kolux_debug_trap_spec __kolux_debug_trap_command __kolux_had_functrace
unset -f __kolux_normalize_prompt_command_part __kolux_normalize_prompt_command __kolux_prepend_prompt_command __kolux_append_prompt_command
unset __kolux_prompt_command_normalized
# Why: arm DEBUG after wrapper setup; otherwise bash treats our own rcfile
# commands as a foreground command and emits a fake C/D before the first prompt.
__kolux_initial_prompt=1
trap '__kolux_osc133_preexec' DEBUG
unset __kolux_initializing_wrapper
`
}
