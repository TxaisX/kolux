// APP-070: nothing about the user's work leaves this computer on the app's behalf. This is the whole
// list of connections the app itself makes; privacy.test.ts checks the source for any other network
// client. T-235-b: kept apart from privacy.ts because only the General settings page shows it, and
// privacy.ts loads with the window (the error and recovery paths use it), where every byte counts
// against the first-load budget (scripts/bundle-budget.mjs).

export const OUTBOUND: ReadonlyArray<{ to: string; when: string }> = [
  { to: "GitHub Releases (TxaisX/kolux)", when: "checking for a newer version, downloading it and reading its release notes" },
  { to: "the git remotes and the GitHub account you set up", when: "fetch, pull, push and ship, through git on this computer" },
  { to: "the AI providers you connected", when: "each agent's own command-line tool talks to its company with your account; the app neither relays nor records that traffic" },
  { to: "the sites your projects name (for a workspace's icon)", when: "fetching the site icon a project's page names, which may be on another site such as a CDN; the app fetches it itself, sends no cookies, and never from this computer or your local network unless the page itself is open at such an address" },
  { to: "GitHub's picture host (avatars.githubusercontent.com)", when: "showing a GitHub project's owner picture as its icon; the window asks github.com for it, which hands it on from this host" },
  { to: "winget, the Windows package manager, and the package hosts it uses", when: "only when you press Install on the Claude or Codex card in Settings > Accounts & keys: Kolux runs winget on this computer, which downloads that agent's official package" },
  { to: "the agent's own pane, as an environment variable (CLAUDE_CODE_OAUTH_TOKEN)", when: "a Claude 1-year token you saved is handed to new Claude Code panes only, which send it to Anthropic; Kolux keeps it sealed on this computer and sends it nowhere else" },
  { to: "an OpenCode server that Kolux runs on this computer only (127.0.0.1)", when: "the chat screen talks to it and nothing else on your network can reach it; OpenCode then sends the conversation to the model provider you picked, such as OpenRouter" },
  { to: "OpenRouter (openrouter.ai)", when: "models paid per use, only when you add an OpenRouter key: Claude Code is pointed at openrouter.ai, so your prompts go to OpenRouter and the model you picked; the key stays sealed on this computer" },
  { to: "Microsoft, from the WebView2 runtime", when: "the Edge engine that Windows lends the app's window keeps its own startup checks; they carry nothing of yours and the app neither uses nor can switch them off" },
  { to: "Microsoft Defender SmartScreen, from the app's own window", when: "the addresses of pages you open from the app are checked against Microsoft's list of phishing and malware sites, and for files you download, their address and details such as name, size and fingerprint, as in Edge (T-634)" },
];
