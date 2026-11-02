// APP-070: nothing about the user's work leaves this computer on the app's behalf. This is the whole
// list of connections the app itself makes; privacy.test.ts checks the source for any other network
// client. T-235-b: kept apart from privacy.ts because only the General settings page shows it, and
// privacy.ts loads with the window (the error and recovery paths use it), where every byte counts
// against the first-load budget (scripts/bundle-budget.mjs).

export const OUTBOUND: ReadonlyArray<{ to: string; when: string }> = [
  { to: "GitHub Releases (TxaisX/kolux-rs)", when: "checking for a newer version, downloading it and reading its release notes" },
  { to: "the git remotes and the GitHub account you set up", when: "fetch, pull, push and ship, through git on this computer" },
  { to: "the AI providers you connected", when: "each agent's own command-line tool talks to its company with your account; the app neither relays nor records that traffic" },
  { to: "the sites you open in the browser pane", when: "browsing, as in any browser, and fetching the site icon each open page names, which may be on another site such as a CDN; the app fetches it itself, sends no cookies, and never from this computer or your local network unless the page itself is open at such an address" },
  { to: "script CDNs (cdnjs, jsdelivr, unpkg, tailwindcss, jquery)", when: "saving an artifact for offline use, to fetch the scripts its page names" },
  { to: "Kimi (api.moonshot.ai) and MiniMax (www.minimax.io)", when: "only when you press Check now in Settings > AI connections with a key you added" },
  { to: "Microsoft, from the WebView2 runtime", when: "the Edge engine that Windows lends the app's window keeps its own startup checks; they carry nothing of yours and the app neither uses nor can switch them off" },
  { to: "Microsoft Defender SmartScreen, from Kolux's windows (chiefly the browser pane)", when: "the addresses of pages you open are checked against Microsoft's list of phishing and malware sites, and for files you download, their address and details such as name, size and fingerprint, as in Edge (T-634)" },
];
