// T-811: the Rust commands the window calls through a name held in a variable. A literal
// `invoke` call with the name written out is checked by scripts/invoke-contract.mjs against generate_handler!; a name that
// travels through a variable used to escape that check. These sites take a CommandName, so the type
// checker keeps their names inside this list, and the contract check reads this list too.
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

export const NAMED_COMMANDS = [
  "agents_install_many", "claude_accounts", "claude_key_cancel", "claude_key_connect", "claude_key_disconnect", "claude_usage", "claude_usage_of", "cli_register", "cli_unregister",
  "graphics_choose", "graphics_keep_running", "graphics_restart_safe", "prompt_scan", "prompt_scan_pruned", "prompt_scan_restored", "repo_setup_mode_set", "repo_setup_policy_set",
  "repo_setup_remove", "repo_setup_wait_set", "setup_suggestion_dismiss", "setup_suggestion_save", "skills_update_clear", "skills_update_status",
  "claude_account_activate", "codex_account_activate", "scm_base_changes", "fs_trash", "fs_rename", "fs_restore", "fs_move", "fs_copy", "scm_base_sides", "diff_sides", "session_reveal", "session_open", "session_delete",
] as const;

export type CommandName = (typeof NAMED_COMMANDS)[number];

/** `invoke` for a name that is not written at the call site; same result, but the name is a CommandName. */
export const invokeNamed = <T = unknown>(name: CommandName, args?: InvokeArgs): Promise<T> => invoke<T>(name, args);
