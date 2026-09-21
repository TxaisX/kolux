export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__kolux_normalize_prompt_command_part() {
  local __kolux_value="$1" __kolux_output_name="$2" __kolux_character __kolux_chunk
  local __kolux_value_length=\${#1} __kolux_suffix_length=0 __kolux_backslash_length=0
  local __kolux_output_length __kolux_scan_start
  while (( __kolux_value_length - __kolux_suffix_length >= 1024 )); do
    __kolux_scan_start=$(( __kolux_value_length - __kolux_suffix_length - 1024 ))
    __kolux_chunk="\${__kolux_value:__kolux_scan_start:1024}"
    case "$__kolux_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __kolux_suffix_length=$(( __kolux_suffix_length + 1024 )) ;;
    esac
  done
  while (( __kolux_suffix_length < __kolux_value_length )); do
    __kolux_character="\${__kolux_value: -__kolux_suffix_length - 1:1}"
    case "$__kolux_character" in
      ' '|$'\\t'|$'\\n'|';') __kolux_suffix_length=$(( __kolux_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __kolux_output_length=$(( \${#__kolux_value} - __kolux_suffix_length ))
  while (( __kolux_output_length - __kolux_backslash_length >= 1024 )); do
    __kolux_scan_start=$(( __kolux_output_length - __kolux_backslash_length - 1024 ))
    __kolux_chunk="\${__kolux_value:__kolux_scan_start:1024}"
    case "$__kolux_chunk" in
      *[!\\\\]*) break ;;
      *) __kolux_backslash_length=$(( __kolux_backslash_length + 1024 )) ;;
    esac
  done
  while (( __kolux_backslash_length < __kolux_output_length )); do
    __kolux_character="\${__kolux_value:__kolux_output_length - __kolux_backslash_length - 1:1}"
    [[ "$__kolux_character" == '\\' ]] || break
    __kolux_backslash_length=$(( __kolux_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __kolux_suffix_length > 0 && __kolux_backslash_length % 2 == 1 )); then
    __kolux_suffix_length=$(( __kolux_suffix_length - 1 ))
    __kolux_backslash_length=0
  fi
  __kolux_output_length=$(( \${#__kolux_value} - __kolux_suffix_length ))
  __kolux_value="\${__kolux_value:0:__kolux_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __kolux_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __kolux_backslash_length % 2 == 1 )); then
    __kolux_value="$__kolux_value\\\\"
  fi
  printf -v "$__kolux_output_name" '%s' "$__kolux_value"
}
__kolux_restore_prompt_status() {
  return "$1"
}
__kolux_update_user_debug_trap() {
  local __kolux_debug_trap_spec="$1" __kolux_unchanged_debug_trap_spec="$2"
  local __kolux_debug_trap_command
  [[ "$__kolux_debug_trap_spec" != "$__kolux_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__kolux_debug_trap_spec" != "trap -- '__kolux_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__kolux_debug_trap_spec" ]]; then
    __kolux_user_debug_trap=""
    unset __kolux_chained_debug_trap
    return 0
  fi
  __kolux_debug_trap_command="\${__kolux_debug_trap_spec#trap -- }"
  __kolux_debug_trap_command="\${__kolux_debug_trap_command% DEBUG}"
  eval "__kolux_user_debug_trap=$__kolux_debug_trap_command"
  unset __kolux_chained_debug_trap
}
__kolux_run_user_debug_trap() {
  if [[ -n "\${__kolux_user_debug_trap:-}" ]]; then
    eval "$__kolux_user_debug_trap" || true
  fi
}
__kolux_adopt_outer_debug_trap() {
  local __kolux_debug_trap_spec="\${__kolux_outer_debug_trap_spec:-}"
  unset __kolux_outer_debug_trap_spec
  __kolux_update_user_debug_trap "$__kolux_debug_trap_spec" "trap -- '__kolux_osc133_preexec' DEBUG"
}
__kolux_run_prompt_command_array() {
  local __kolux_exit_code="\${__kolux_prompt_status:-$?}" __kolux_prompt_part __kolux_prompt_index __kolux_user_count
  local __kolux_suffix_part
  local __kolux_final_prompt_command
  local __kolux_in_prompt_dispatch=1 __kolux_dispatching_user_prompt_command=""
  unset __kolux_prompt_status
  __kolux_adopt_outer_debug_trap
  trap '__kolux_osc133_preexec' DEBUG
  for __kolux_prompt_part in "\${__kolux_prompt_command_prefix[@]+"\${__kolux_prompt_command_prefix[@]}"}"; do
    if (( __kolux_exit_code == 0 )); then
      eval "$__kolux_prompt_part"
    else
      __kolux_restore_prompt_status "$__kolux_exit_code" || eval "$__kolux_prompt_part"
    fi
  done
  __kolux_user_count=0
  for __kolux_prompt_part in "\${__kolux_prompt_command_array[@]+"\${__kolux_prompt_command_array[@]}"}"; do
    __kolux_user_count=$(( __kolux_user_count + 1 ))
  done
  for (( __kolux_prompt_index = 0; __kolux_prompt_index + 1 < __kolux_user_count; __kolux_prompt_index++ )); do
    __kolux_prompt_part="\${__kolux_prompt_command_array[__kolux_prompt_index]}"
    __kolux_dispatching_user_prompt_command=1
    if (( __kolux_exit_code == 0 )); then
      eval "$__kolux_prompt_part"
    else
      __kolux_restore_prompt_status "$__kolux_exit_code" || eval "$__kolux_prompt_part"
    fi
    __kolux_dispatching_user_prompt_command=""
  done
  if (( __kolux_user_count > 0 )); then
    __kolux_prompt_part="\${__kolux_prompt_command_array[__kolux_user_count - 1]}"
    # Why: keep the final user hook and Kolux suffixes in one status-preserving eval.
    __kolux_final_prompt_command='eval "$__kolux_prompt_part"'
    for __kolux_suffix_part in "\${__kolux_prompt_command_suffix[@]+"\${__kolux_prompt_command_suffix[@]}"}"; do
      __kolux_final_prompt_command+=$'\\n'"$__kolux_suffix_part"
    done
    __kolux_dispatching_user_prompt_command=1
    if (( __kolux_exit_code == 0 )); then
      eval "$__kolux_final_prompt_command"
    else
      __kolux_restore_prompt_status "$__kolux_exit_code" || eval "$__kolux_final_prompt_command"
    fi
    __kolux_dispatching_user_prompt_command=""
  else
    for __kolux_prompt_part in "\${__kolux_prompt_command_suffix[@]+"\${__kolux_prompt_command_suffix[@]}"}"; do
      if (( __kolux_exit_code == 0 )); then
        eval "$__kolux_prompt_part"
      else
        __kolux_restore_prompt_status "$__kolux_exit_code" || eval "$__kolux_prompt_part"
      fi
    done
  fi
  return "$__kolux_exit_code"
}
__kolux_finish_legacy_prompt_dispatch() {
  local __kolux_suffix_part
  if [[ -n "\${__kolux_in_prompt_command:-}" ]]; then
    for __kolux_suffix_part in "\${__kolux_prompt_command_suffix[@]+"\${__kolux_prompt_command_suffix[@]}"}"; do
      eval "$__kolux_suffix_part"
    done
  fi
  trap '__kolux_osc133_preexec' DEBUG
  unset __kolux_in_legacy_prompt_wrapper
}
__kolux_normalize_prompt_command() {
  [[ -z "\${__kolux_prompt_command_normalized:-}" ]] || return 0
  local __kolux_prompt_part
  local -a __kolux_normalized=()
  for __kolux_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __kolux_normalize_prompt_command_part "$__kolux_prompt_part" __kolux_prompt_part
    [[ -n "$__kolux_prompt_part" ]] && __kolux_normalized+=("$__kolux_prompt_part")
  done
  __kolux_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__kolux_normalized[@]+"\${__kolux_normalized[@]}"}")
  else
    __kolux_prompt_command_array=("\${__kolux_normalized[@]+"\${__kolux_normalized[@]}"}")
    __kolux_prompt_command_prefix=()
    __kolux_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __kolux_prompt_status_variable="__kolux_prompt_status_$$"
    __kolux_prompt_status_capture_command="$__kolux_prompt_status_variable=\\$?"
    __kolux_prompt_status_value="\\\${$__kolux_prompt_status_variable}"
    PROMPT_COMMAND="$__kolux_prompt_status_capture_command; __kolux_prompt_status=$__kolux_prompt_status_value"'; __kolux_prompt_had_functrace=""; if [[ -o functrace ]]; then __kolux_prompt_had_functrace=1; set +T; fi; __kolux_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__kolux_prompt_had_functrace" ]] || set -T; unset __kolux_prompt_had_functrace; __kolux_run_prompt_command_array; __kolux_finish_legacy_prompt_dispatch'
  fi
}
__kolux_prepend_prompt_command() {
  local command="$1"
  __kolux_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __kolux_prompt_command_prefix=("$command" "\${__kolux_prompt_command_prefix[@]+"\${__kolux_prompt_command_prefix[@]}"}")
  fi
}
__kolux_append_prompt_command() {
  local command="$1"
  __kolux_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __kolux_prompt_command_suffix+=("$command")
  fi
}`
