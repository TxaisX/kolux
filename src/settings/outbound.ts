// APP-070: nothing about the user's work leaves this computer on the app's behalf. This is the whole
// list of connections the app itself makes; privacy.test.ts checks the source for any other network
// client. T-235-b: kept apart from privacy.ts because only the General settings page shows it, and
// privacy.ts loads with the window (the error and recovery paths use it), where every byte counts
// against the first-load budget (scripts/bundle-budget.mjs).

export const OUTBOUND: ReadonlyArray<{ to: string; when: string }> = [
  { to: "GitHub Releases (TxaisX/kolux)", when: "checking for a newer version, downloading it and reading its release notes" },
  { to: "the git remotes and the GitHub account you set up", when: "fetch, pull, push and ship, through git on this computer" },
  { to: "the AI providers you connected", when: "each agent's own command-line tool talks to its company with your account; the app neither relays nor records that traffic" },
  { to: "the sites your projects name (for a workspace's icon), and GitHub for the profile pictures of the people a repository lists", when: "fetching the site icon a project's page names, which may be on another site such as a CDN; the app fetches it itself, sends no cookies, and never from this computer or your local network unless the page itself is open at such an address" },
  { to: "GitHub's picture host (avatars.githubusercontent.com, or avatars.<your host> on GitHub Enterprise)", when: "showing the profile pictures of the people a repository lists; the window loads each picture straight from that host and shows initials for any other address" },
  {
    to: "each agent's own install host (claude.ai, chatgpt.com, cursor.com, x.ai, antigravity.google, aider.chat, app.factory.ai, app.primeintellect.ai, cli.kiro.dev, code.kimi.com, hermes-agent.nousresearch.com, mimo.xiaomi.com, omp.sh, openclaw.ai, static.devin.ai, raw.githubusercontent.com), the npm registry, winget and PyPI",
    when: "only when you press Install on an agent in the picker: Kolux runs that agent's published installer script, or its npm, winget or uv package, on this computer, and the download comes from the host in this row",
  },
  { to: "the npm registry and GitHub (TxaisX/kolux-skills), through npx", when: "only when you press Install or Update on the Kolux skills: Kolux runs npx --yes skills, which downloads the skill files" },
  { to: "script CDNs (cdnjs, jsdelivr, unpkg, tailwindcss, jquery)", when: "saving an artifact for offline use, to fetch the scripts its page names; these five hosts only. While the Artifacts page is open it also looks in the workspace's artifacts/ folder every 3 seconds and imports a new or changed page by itself, so a page an agent saves there fetches its scripts from these hosts with no click from you" },
  { to: "the agent's own pane, as an environment variable (CLAUDE_CODE_OAUTH_TOKEN, XAI_API_KEY)", when: "a Claude 1-year token or an xAI key you saved is handed to new panes of that one agent only, which sends it to its own company; Kolux keeps it sealed on this computer and sends it nowhere else" },
  { to: "Kimi (api.moonshot.ai) and MiniMax (www.minimax.io)", when: "only when you press Check now in Settings > Accounts & keys with a key you added" },
  { to: "Microsoft, from the WebView2 runtime", when: "the Edge engine that Windows lends the app's window keeps its own startup checks; they carry nothing of yours and the app neither uses nor can switch them off" },
  { to: "Microsoft Defender SmartScreen, from the app's own window", when: "the addresses of pages you open from the app are checked against Microsoft's list of phishing and malware sites, and for files you download, their address and details such as name, size and fingerprint, as in Edge (T-634)" },
];
