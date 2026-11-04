// Every command a shortcut can name (COMPAT.md section 4.3, SET-013): its id (the key in the
// user's keybindings file, so it never changes), title, scope, conflict group and default chords
// per platform. "Mod" is Ctrl on Windows and Linux and Cmd on macOS. Linux takes the Windows
// column unless a row says otherwise. Two ids in the old table are not carried
// (`tab.newSimulator`, `tab.openQuickCommandsMenu`, see DECISIONS.md): they are not registered
// here, so a file naming them gets a warning, as any unknown id does. T-611: nor is
// `sidebar.ports.toggle`, whose Ports tab went with remote hosts (VIEW-079, dropped).

export type Platform = "win32" | "linux" | "darwin";
export type Scope = "global" | "tabs" | "browser" | "editor" | "explorer" | "settings" | "terminal";
export type Group = "menu" | "workspace-shell" | "editor";

export type Action = {
  id: string;
  title: string;
  scope: Scope;
  group?: Group;
  /** Windows (and Linux) defaults; empty means it ships unbound. */
  win32: string[];
  /** Only when macOS differs from the Windows column. */
  darwin?: string[];
  /** SET-008: more words the Shortcuts search finds the command by. */
  keywords?: string[];
  /** The chord's last key is a digit 1; the action covers 1 to 9. */
  index?: boolean;
  /** SET-014: still fires while a terminal has focus when the policy is Terminal first. */
  terminalSafe?: boolean;
};

/** Every agent's id and name (TERM-041's new-tab commands; the settings search finds agents by them). */
export const agents: Array<[string, string]> = [
  ["claude", "Claude"],
  ["claude-agent-teams", "Claude Agent Teams"],
  ["openclaude", "OpenClaude"],
  ["codex", "Codex"],
  ["devin", "Devin"],
  ["ante", "Ante"],
  ["trae", "Trae"],
  ["autohand", "Autohand Code"],
  ["mimo-code", "MiMo Code"],
  ["pi", "Pi"],
  ["omp", "OMP"],
  ["prime-agent", "Prime Agent"],
  ["gemini", "Gemini"],
  ["antigravity", "Antigravity"],
  ["aider", "Aider"],
  ["goose", "Goose"],
  ["amp", "Amp"],
  ["kilo", "Kilocode"],
  ["kiro", "Kiro"],
  ["crush", "Charm"],
  ["aug", "Auggie"],
  ["cline", "Cline"],
  ["codebuff", "Codebuff"],
  ["command-code", "Command Code"],
  ["continue", "Continue"],
  ["cursor", "Cursor"],
  ["droid", "Droid"],
  ["kimi", "Kimi"],
  ["mistral-vibe", "Mistral Vibe"],
  ["qwen-code", "Qwen Code"],
  ["rovo", "Rovo Dev"],
  ["hermes", "Hermes"],
  ["openclaw", "OpenClaw"],
  ["copilot", "GitHub Copilot"],
  ["grok", "Grok"],
  ["opencode", "OpenCode"],
];

const a = (id: string, title: string, scope: Scope, win32: string[], extra: Partial<Action> = {}): Action => ({ id, title, scope, win32, ...extra });

export const actions: Action[] = [
  a("worktree.quickOpen", "Go to File", "global", ["Mod+P"]),
  a("app.settings", "Open Settings", "global", ["Mod+Comma"], { group: "menu", keywords: ["preferences", "options"], terminalSafe: true }),
  a("app.forceReload", "Force Reload", "global", ["Mod+Shift+R"], { group: "menu" }),
  a("worktree.palette", "Switch worktree", "global", ["Mod+Shift+J"], { darwin: ["Mod+J"] }),
  a("worktree.navigateUp", "Previous worktree", "global", ["Mod+Shift+ArrowUp"]),
  a("worktree.navigateDown", "Next worktree", "global", ["Mod+Shift+ArrowDown"]),
  a("workspace.create", "Create worktree", "global", ["Mod+N", "Mod+Shift+N"], { darwin: ["Mod+N"] }),
  a("workspace.rename", "Rename worktree", "global", [], { darwin: ["Mod+Alt+R"], group: "workspace-shell" }),
  a("workspace.delete", "Delete Workspace", "global", ["Mod+Shift+Backspace"]),
  a("workspace.openBoard", "Show Workspace Statuses", "global", []), // T-610: not a second "Board" (VIEW-001's keeps the name)
  a("workspace.selectByIndex", "Select Workspace 1–9", "global", ["Mod+1"], { index: true }),
  a("view.tasks", "Open Tasks", "global", []),
  a("view.automations", "Open Automations", "global", [], { keywords: ["schedule", "cron", "recurring"] }), // UX lane C: reachable with the sidebar row hidden
  a("view.routing", "Model Routing", "global", []), // T-727: was only the icon on the projects panel; "route" finds it as a near miss of "routing"
  a("dashboard.toggle", "Toggle Agent Dashboard", "global", []),
  a("sidebar.left.toggle", "Toggle Sidebar", "global", ["Mod+B"]),
  a("sidebar.right.toggle", "Toggle Right Sidebar", "global", ["Mod+L"]),
  a("sidebar.explorer.toggle", "Show or hide Explorer", "global", ["Mod+Shift+E"]),
  a("sidebar.search.toggle", "Show Search", "global", ["Mod+Shift+F"]),
  a("sidebar.checks.toggle", "Show Checks", "global", []),
  a("sidebar.sleepingWorkspaces.toggle", "Toggle Sleeping Workspaces", "global", []),
  a("sidebar.focusWorktreeList", "Focus worktree list", "global", ["Mod+Shift+0"]),
  a("floatingTerminal.toggle", "Toggle Floating Terminal", "global", ["Mod+Alt+A"], { terminalSafe: true }),
  a("floatingWorkspace.maximize", "Maximize Floating Workspace Panel", "global", ["Mod+Shift+Backslash"], { darwin: ["Mod+Alt+Shift+A"] }),
  a("view.inbox", "Show Inbox", "global", []),
  a("view.tower", "Show Tower", "global", []),
  // T-548 (OD-11): one key moves new panes to the provider's next account; unbound until Txais picks a chord.
  a("account.switchClaude", "Switch Claude account", "global", [], { keywords: ["account", "sign in", "login"] }),
  a("account.switchCodex", "Switch Codex account", "global", [], { keywords: ["account", "sign in", "login"] }),
  a("sidebar.sleeping.toggle", "Show or Hide Sleeping Workspaces", "global", [], { keywords: ["sleep", "asleep", "wake"] }),
  a("view.floor", "Show Floor", "global", []),
  // UX lane C (keyboard F6): a way out of a terminal to the top bar; Tab moves on from there.
  a("focus.chrome", "Move Focus to the Top Bar", "global", ["Mod+Shift+P"], { terminalSafe: true, keywords: ["escape terminal", "leave terminal"] }),
  a("view.space", "Show Space", "global", [], { keywords: ["disk", "worktrees", "size", "reclaim"] }),
  a("view.code", "Show Code", "global", ["Mod+Shift+3"]),
  a("floatingWorkspace.minimize", "Minimize Floating Workspace Panel", "global", ["Mod+Shift+H"]),
  a("zoom.in", "Zoom In", "global", ["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"], { terminalSafe: true }),
  a("zoom.out", "Zoom Out", "global", ["Mod+Minus", "Mod+NumpadSubtract"], { terminalSafe: true }),
  a("zoom.reset", "Reset Size", "global", ["Mod+0"], { terminalSafe: true }),
  // SET-019 (T-246-c): the saved interface zoom has its own keys, since Mod+= / Mod+- / Mod+0 zoom the focused pane (TERM-078).
  a("ui.zoomIn", "Zoom Interface In", "global", ["Mod+Alt+Equal"], { group: "menu", terminalSafe: true, keywords: ["zoom", "bigger", "interface", "scale"] }),
  a("ui.zoomOut", "Zoom Interface Out", "global", ["Mod+Alt+Minus"], { group: "menu", terminalSafe: true, keywords: ["zoom", "smaller", "interface", "scale"] }),
  a("ui.zoomReset", "Reset Interface Zoom", "global", ["Mod+Alt+0"], { group: "menu", terminalSafe: true, keywords: ["zoom", "actual size", "interface", "scale"] }),
  a("worktree.history.back", "Worktree History Back", "global", ["Mod+Alt+ArrowLeft"]),
  a("worktree.history.forward", "Worktree History Forward", "global", ["Mod+Alt+ArrowRight"]),
  a("tab.newTerminal", "New terminal tab", "tabs", ["Mod+T"]),
  a("tab.newAgent", "New agent tab (default agent)", "tabs", [], { darwin: ["Mod+Alt+T"] }),
  a("tab.newBrowser", "New browser tab", "tabs", ["Mod+Shift+B"]),
  a("tab.newMarkdown", "New markdown tab", "tabs", ["Mod+Shift+M"]),
  a("tab.openMarkdown", "Open markdown tab", "tabs", ["Mod+Shift+O"]),
  a("tab.close", "Close active tab", "tabs", ["Mod+W"]),
  a("tab.closeAll", "Close all editor tabs", "tabs", ["Mod+Alt+W"]),
  a("tab.rename", "Rename active tab", "tabs", ["Mod+Shift+G"], { darwin: ["Mod+R"], group: "workspace-shell" }),
  // T-239 (BROW-019): bound again now that the window reopens a closed browser tab (browser/pages.ts;
  // T-164-b adds terminal tabs through src/terminal/closedTabs.ts). T-543-b had shipped it unbound.
  a("tab.reopenClosed", "Reopen closed tab", "tabs", ["Mod+Shift+T"]),
  // T-305 (TERM-053): the tab search box (src/shell/TabSearch.tsx).
  a("tab.search", "Search open tabs", "tabs", ["Mod+Shift+K"], { terminalSafe: true, keywords: ["find tab", "switch tab"] }),
  a("tab.nextSameType", "Next tab (same type)", "tabs", ["Mod+Alt+BracketRight"], { terminalSafe: true }),
  a("tab.previousSameType", "Previous tab (same type)", "tabs", ["Mod+Alt+BracketLeft"], { terminalSafe: true }),
  a("tab.nextAllTypes", "Next tab (all types)", "tabs", ["Mod+Shift+BracketRight"], { terminalSafe: true }),
  a("tab.previousAllTypes", "Previous tab (all types)", "tabs", ["Mod+Shift+BracketLeft"], { terminalSafe: true }),
  a("tab.previousRecent", "Previous recent tab", "tabs", ["Ctrl+Tab"], { terminalSafe: true }),
  a("tab.nextRecent", "Next recent tab", "tabs", ["Ctrl+Shift+Tab"], { terminalSafe: true }),
  a("tab.nextTerminal", "Next terminal tab", "tabs", ["Ctrl+PageDown"], { terminalSafe: true }),
  a("tab.previousTerminal", "Previous terminal tab", "tabs", ["Ctrl+PageUp"], { terminalSafe: true }),
  a("tab.selectByIndex", "Select Tab 1–9", "tabs", ["Alt+1"], { darwin: ["Ctrl+1"], index: true, terminalSafe: true }),
  a("browser.find", "Find in Browser", "browser", ["Mod+F"]),
  a("browser.back", "Go Back in Browser", "browser", ["Alt+ArrowLeft"]),
  a("browser.forward", "Go Forward in Browser", "browser", ["Alt+ArrowRight"]),
  a("browser.reload", "Reload Browser Page", "browser", ["Mod+R"]),
  a("browser.hardReload", "Reload Browser Page (second key)", "browser", ["Mod+Shift+R"]), // runs browser.reload (sameAs below), so it is not called Hard
  a("browser.focusAddressBar", "Focus Browser Address Bar", "browser", ["Mod+L"]),
  a("browser.grabElement", "Grab Page Element", "browser", ["Mod+C"]),
  a("editor.find", "Find in editor", "editor", ["Mod+F"]),
  a("editor.replace", "Replace in editor", "editor", ["Mod+H"], { darwin: ["Mod+Alt+F"] }),
  a("editor.save", "Save File", "editor", ["Mod+S"]),
  a("editor.markdownPreview", "Show Markdown Preview", "editor", ["Mod+Shift+V"]),
  a("editor.toggleWordWrap", "Toggle Word Wrap", "editor", ["Alt+Z"]),
  a("editor.copyContext", "Copy Context", "editor", ["Mod+Alt+C"]),
  a("editor.previousChange", "Go to Previous Change", "editor", ["Shift+F7"]),
  a("editor.nextChange", "Go to Next Change", "editor", ["F7"]),
  a("editor.addReviewNote", "Add Review Note", "editor", ["Mod+Shift+A"]),
  a("sourceControl.sendReviewNotes", "Send Review Notes to Agent", "editor", [], { group: "editor" }),
  a("fileExplorer.undo", "Undo file operation", "explorer", ["Mod+Z"]),
  a("fileExplorer.redo", "Redo file operation", "explorer", ["Mod+Shift+Z", "Ctrl+Y"], { darwin: ["Mod+Shift+Z"] }),
  a("fileExplorer.copyPath", "Copy file path", "explorer", ["Alt+Shift+C"]),
  a("fileExplorer.copyRelativePath", "Copy relative file path", "explorer", ["Mod+Alt+Shift+C"]),
  a("fileExplorer.delete", "Delete file", "explorer", ["Delete"], { darwin: ["Delete", "Mod+Backspace"] }),
  a("settings.search", "Search Settings", "settings", ["Mod+F"]),
  a("terminal.copySelection", "Copy terminal selection", "terminal", ["Ctrl+Shift+C", "Ctrl+C"], { terminalSafe: true }),
  a("terminal.selectAll", "Select all terminal text", "terminal", ["Ctrl+Shift+A"], { darwin: ["Mod+A"] }),
  a("terminal.paste", "Paste into terminal", "terminal", ["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert"], { terminalSafe: true }),
  a("terminal.search", "Search active pane", "terminal", ["Mod+F"]),
  a("terminal.clear", "Clear active pane", "terminal", ["Mod+K"], { keywords: ["cls", "clear screen"] }),
  a("terminal.focusNextPane", "Focus next pane", "terminal", ["Mod+BracketRight"]),
  a("terminal.focusPreviousPane", "Focus previous pane", "terminal", ["Mod+BracketLeft"]),
  a("terminal.equalizePaneSizes", "Equalize pane sizes", "terminal", []),
  a("terminal.expandPane", "Expand / collapse pane", "terminal", ["Mod+Shift+Enter"]),
  a("terminal.setTitle", "Set Title…", "terminal", []),
  a("terminal.clearPaneTitle", "Clear Pane Title", "terminal", []),
  // T-717 (DT-C153): Mod+W is tab.close's, which closes the focused pane on the terminals screen too (TERM-014);
  // this id stays for a user's own chord and runs the same close.
  a("terminal.closePane", "Close active pane", "terminal", []),
  a("terminal.splitRight", "Split terminal right", "terminal", ["Mod+Shift+D"], { darwin: ["Mod+D"], terminalSafe: true }),
  a("terminal.splitDown", "Split terminal down", "terminal", ["Alt+Shift+D"], { darwin: ["Mod+Shift+D"], terminalSafe: true }),
  a("terminal.switchInputSource", "Switch input source / language (native)", "terminal", []),
  a("view.cycleWorkspaceView", "Cycle Workspace View (Agents / Board / Terminals / Tower)", "global", ["Mod+Alt+V"]),
  a("sessions.add", "Add a Session", "global", []),
  a("sessions.remove", "Remove a Session", "global", []),
  a("terminals.focusNextNeedsYou", "Next That Needs You", "global", ["Mod+J"], { darwin: ["Mod+Shift+J"] }),
  ...agents.map(([id, name]) => a(`tab.newAgent.${id}`, `New ${name} tab`, "tabs", [])),
];

export const actionById: ReadonlyMap<string, Action> = new Map(actions.map((x) => [x.id, x]));

/** T-611: an id kept so a keybindings file that names it still works, and the command whose code it runs
 *  (keymap.ts matchEvent answers with that one). */
export const sameAs: Readonly<Record<string, string>> = {
  // PROJ-053 / VIEW-053: COMPAT's id for showing sleeping workspaces; VIEW-053 built the toggle as sidebar.sleeping.toggle.
  "sidebar.sleepingWorkspaces.toggle": "sidebar.sleeping.toggle",
  // VIEW-029 / HID-020: the Agent Dashboard drawer was skipped for the Tower, its always-on successor (OD-09, DT-C35).
  "dashboard.toggle": "view.tower",
  // BROW-005: the toolbar's Mod+Shift+R reloads, as the same chord already does inside a page (browser.rs chord script).
  // ponytail: WebView2's reload keeps the cache; a cache-skipping reload in browser.rs is the upgrade path.
  "browser.hardReload": "browser.reload",
};

/** The built-in chords for one platform. */
export function defaultsFor(action: Action, platform: Platform): string[] {
  return platform === "darwin" && action.darwin ? action.darwin : action.win32;
}
