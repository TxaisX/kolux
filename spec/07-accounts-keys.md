# 07 · Accounts, sign-in & keys

This area covers how a user links Kolux to the AI services they already pay for, and how Kolux
keeps those links working. The accounts page in Settings, titled AI connections, opens with one
Connect card each for Claude, Codex and Grok: install the missing tool, sign in with the default
method or another one, read why a card needs attention and fix it with one click, or disconnect.
Claude connects by default with a key that lasts a year. Under the cards an advanced block keeps
several Claude and Codex accounts side by side, each with a private sign-in of its own, and Kolux
renews Claude sign-ins ahead of time unless the user leaves that to Claude Code. Every secret is
sealed on disk with the operating system's protection and kept out of logs, errors and the screen.
Also here: `kolux account add` and `kolux account list`, the model lists in the session picker,
per-provider routing tiers for workers, MiniMax and Gemini usage credentials, and a group of
terminal-start behaviours (shell choice, a clean environment, safe start folders, ending child
processes) whose checks were filed under this area. The switcher that suggested another account
lived in the status-bar usage menus, which stopped showing on 2026-10-05, so it is hidden; several
profiles per install is developer-only. Accounts inside WSL, account handling for remote hosts,
and files, git and terminals on SSH hosts went with area 18.

Tier counts: P0 12 · P1 27 · P2 16 · H 4 · X 0 · D 6
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes ·
04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits ·
08 Orchestration · 09 Automations · 10 Plan review & protected actions ·
11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use ·
16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) ·
19 App lifecycle & operations · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### ACCT-004 · Claude connects once with a key that lasts a year
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: clicks "Connect" on the Claude card, which uses this method by default, and approves the
  request in the browser.
User sees: the Claude card turns connected on the 1-year key plan and names the month in which the
  key must be renewed; nothing has to be pasted or signed in again before then.
Rules: Kolux runs Claude Code's own long-lived-token setup out of sight, picks the key out of what
  that setup prints, and keeps it together with the date it was made and a marker that Claude is in
  key mode; the key counts as good for twelve months; from 30 days before the end the card warns and
  offers "Renew"; every Claude pane opened in key mode is handed the key through Claude Code's
  published OAuth-token environment variable; Kolux gives up on the setup after 10 minutes, and a
  subscription-required line that turns up partway through its output is not taken as the final
  answer; on Windows the setup opens no console window and never goes through the classic command
  prompt; if the installed Claude launcher is a wrapper Kolux cannot start directly, the card goes
  to needs attention and never retries through the command prompt; while key mode is the Claude
  connection it wins over any managed-account choice for new Claude panes; only one key setup can be
  in progress; a second request during one is turned down.
Acceptance:
  - [x] On a fresh profile, connect Claude and approve in the browser → the card shows connected
        with a renewal month roughly a year ahead. (cards; evidence/cards-ACCT-004.txt)
  - [x] Backdate the stored key's creation to 340 days ago → the card shows the expiry warning and
        Renew. (cards; evidence/cards-ACCT-004.txt)
  - [x] Open a new Claude pane in key mode → it starts already signed in, with no browser prompt. (cards; evidence/cards-ACCT-004.txt)
Compat: Claude Code takes the key from its own published OAuth-token environment variable; the
  creation date and the connection mode carry over from an older profile, the key itself needs
  re-entry (COMPAT.md 5.4).
Source: D-07-004

### ACCT-005 · Sign a Claude account in through the browser and keep it as a managed account
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: chooses "Use my Claude account instead" on the Claude card, or "Add Account" in the
  Claude accounts section, then signs in in the browser.
User sees: a note asking them to finish in the browser, with Cancel; when that is done the account
  is listed with its email and organisation and can be made active.
Rules: every account gets a private Claude configuration folder of its own, Kolux runs Claude Code's
  login inside it, and then keeps the credentials that login produced; on Windows the login runs
  invisibly; sign-in links and codes are kept out of every error message; if the login quits early
  or leaves no credentials behind, the add fails and nothing partial is kept; a failed
  re-authentication puts the account's earlier credentials back instead of leaving it signed out; on
  macOS the credentials sit in the login keychain under an entry that belongs to that account, and
  the older shared entry can still be read; after the browser step the user's own keychain login for
  Claude is put back, and if that is impossible the add fails rather than leaving it replaced;
  credentials identical to those present before the sign-in are never taken as the new account's;
  when the per-account entry is absent, only a shared entry that has changed is accepted (this
  covers older Claude builds); when the keychain copy and the file copy disagree, the newer one
  wins.
  (Kolux, T-043-e: the macOS keychain rules are a rule table, proven against an invented
  keychain; calling it from the sign-in, and proving it live, waits for a Mac, task T-043-f in
  PLAN.md. Until then this build keeps the credentials file in the account's folder on every
  platform.)
Acceptance:
  - [x] Add a Claude account → the browser opens, and after sign-in the row shows email and
        organisation within a few seconds. (cards; evidence/cards-ACCT-005.txt)
  - [x] Cancel partway through sign-in → no row is added and the active account stays the same. (cards; evidence/cards-ACCT-005.txt)
  - [x] Make a re-authentication fail → the row keeps its earlier credentials and is not shown as
        signed out. (cards; evidence/cards-ACCT-005.txt)
Compat: Managed Claude accounts (email, organisation, where each runs, last sign-in time) and the
  choice of active account carry over from an older profile.
Source: D-07-005

### ACCT-006 · Claude sign-ins are renewed by default, with an opt-out
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: keeps the default, or switches on the setting that hands sign-in upkeep back to Claude
  Code.
User sees: by default a managed Claude sign-in never runs out in the middle of the day; with the
  opt-out on, Kolux neither renews sign-ins nor asks Anthropic for usage figures, and usage numbers
  come only from sessions that are running.
Rules: renewal happens early, inside the last 5 minutes before expiry, and also whenever an account
  is made active; no renewal is tried while a Claude terminal is open on that account, so a running
  session never loses its sign-in mid-way; if the provider rejects a renewal outright the account is
  flagged as needing re-auth; failures that look like network trouble are retried later; with the
  opt-out on, Kolux sends nothing to the token service and hides the stale-sign-in warnings; the
  opt-out starts off; renewal before a launch only ever touches managed accounts, never the
  system-default Claude login.
  (Kolux, T-043-d, DT-C16: the switch "Leave sign-in upkeep to Claude Code" sits under the
  managed accounts, settings field `claudeSignInUpkeepByClaudeCode`, absent = on. Kolux never
  renews a sign-in itself, in either position: the token service is not public documentation.
  Off means Kolux asks Claude Code whether the active account is still signed in, at start and
  when the switch is turned off, and shows the Needs sign-in chip and the main-window notice; on
  hides both and sends nothing.)
Acceptance:
  - [x] Default setting, no Claude pane open, a managed account's token close to expiry → Kolux does
        not renew it and sends nothing to the token service; Claude Code renews it in its own panes
        (DT-C16). (Reworded per Txais 2026-10-28 decisions file, A2.)
        (cards; evidence/cards-ACCT-006.txt)
  - [x] Switch the opt-out on → no traffic reaches the token service, and the account never shows
        Needs re-auth afterwards. (T-043-d: Kolux sends nothing in either position; on hides the chip and notice)
Compat: The opt-out choice (off unless the user turned it on) carries over.
Amended 2026-10-09 (DT-A2): ships with the opt-out on, per OD-01; the switch and Kolux-side renewal are T-043-d.
Source: D-07-006

### ACCT-007 · Codex connects with a ChatGPT sign-in or a device code
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: clicks "Connect" on the Codex card, or picks "Sign in with a code" from the other ways to
  connect.
User sees: either the browser opens on the ChatGPT sign-in, or the card shows a short code to type
  on another device; afterwards Codex reads connected.
Rules: the device-code route lets the browser part happen on a different machine; every Codex
  account Kolux adds lives in a private Codex home of its own; the user's usual Codex folder is
  never altered; tearing down or rolling back a login never deletes a home that already holds a
  working sign-in; Kolux recognises the system-default Codex login (whatever plain Codex uses) as a
  ChatGPT sign-in, as an API key with a custom provider, or as signed out; the device-code view
  keeps waiting until it has both the link and the code.
Acceptance:
  - [x] Connect Codex with a code → the card shows a code; entering it on another device turns the
        card connected. (cards; evidence/cards-ACCT-007.txt)
  - [x] Add a second Codex account → every file in the user's usual Codex folder is byte-for-byte
        unchanged. (cards; evidence/cards-ACCT-007.txt)
Compat: —
Source: D-07-007

### ACCT-012 · A lapsed sign-in is flagged outside Settings with Sign in again
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: keeps working while the active managed Claude account's sign-in goes stale, or while
  Codex reports a sign-in error.
User sees: a quiet notice that names the account and offers "Sign in again", which starts
  re-authentication.
Rules: it appears only for an active managed Claude account whose sign-in is stale, or for a Codex
  account that hit a sign-in error; it never appears for Codex's system-default login, nor while
  Claude Code is left to handle its own sign-in (ACCT-006); it stays hidden until settings have
  loaded, so it never flickers at startup.
Acceptance:
  - [x] Mark the active managed Claude account stale → the notice shows its label; Sign in again
        starts re-authentication. (cards; evidence/cards-ACCT-012.txt)
  - [x] Turn on the setting that lets Claude Code handle its own sign-in → the notice goes away. (cards; evidence/cards-ACCT-012.txt)
Compat: —
Source: D-07-012

### ACCT-013 · A needs-attention card states the reason and offers the one fix that fits
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: comes across a card in the needs-attention state.
User sees: a plain-language reason with a single button that fixes it, or no button when the only
  fix is to wait.
Rules: possible reasons: browser blocked, sign-in refused, plan does not cover this agent, not found
  yet, blocked by SmartScreen, usage limit reached, key expiring, key expired, install failed,
  install unavailable, unknown; fix buttons: "Renew", "Check again", "Try installing again", "Open
  install page", "Try again", "Use a 1-year key instead"; a usage limit shows the time the agent
  becomes usable again, with no button; an unknown reason is shown for information only and is never
  paired with a fix that could mislead; if a key runs out mid-session, the Claude card switches to
  key expired, but only for a Claude connected by the 1-year key; account-mode Claude, other stop
  reasons and other agents leave the card as it is.
Acceptance:
  - [x] Let the Claude key run out → the card shows key expired with Renew. (cards; evidence/cards-ACCT-013.txt)
  - [x] Reach a Claude usage limit → the card shows the reset time and no fix button. (cards; evidence/cards-ACCT-013.txt)
Compat: —
Source: D-07-013

### ACCT-009 · Saved keys and sign-ins are sealed on disk
Tier: P0 · Pushed: 5 · State at 0.15.0: live-unverified
User does: connects accounts and keys, quits Kolux, and opens it again.
User sees: every connection is still in place, and the settings and account files on disk hold
  sealed values rather than readable keys.
Rules: the Claude 1-year key and the xAI key are stored in the settings file, sealed by the
  operating system's own protection; managed Claude credentials and Codex account details are sealed
  too; shortly after the first window appears, a one-off pass seals anything older that is still
  stored in the clear; that pass never delays or breaks a launch; if the system cannot seal, the
  data is left as it was rather than lost; plain files from the previous release are read and then
  sealed again; a sealed file that cannot be opened is moved out of the way, not deleted; files and
  folders holding secrets are limited to the current user (on Windows their permissions are
  rewritten so only that user has access); this is best effort, failures go to the log, and a launch
  is never stopped by it; where the system offers no real keyring, or one that only scrambles
  instead of protecting, sealing still happens and a single log line is written when that situation
  starts, changes or ends, never a dialog.
Acceptance:
  - [x] Connect Claude by 1-year key, quit, look inside the settings file → the key text is not
        there; reopen → still connected. (cards; evidence/cards-ACCT-009.txt)
  - [x] Start from a profile whose credentials were stored in the clear → after the first launch
        they are sealed and still work. (cards; evidence/cards-ACCT-009.txt)
Compat: An older profile may hold sealed or clear secrets and both must load; whether the one-off
  sealing pass already ran carries over.
Source: D-07-009

### ACCT-001 · The AI connections page shows a Connect card for each agent
Tier: P0 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens Settings and goes to the accounts page, titled AI connections.
User sees: Claude, Codex and Grok cards in a grid, each telling in plain language what that plan is
  good for and whether it is ready; under a divider, an advanced area handles several accounts.
Rules: the cards run Claude, then Codex, then Grok, each with a one-line plain tagline; the advanced
  area is headed "Manage accounts (advanced)" and holds the per-provider account sections; Kolux
  charges nothing: each connection runs on the user's own plan or key, and Kolux ships no models or
  keys of its own; until detection returns, the cards show a loading placeholder and never claim
  early that an agent is missing; agent traffic flows directly between each agent tool and its
  provider; Kolux neither relays nor records it.
Acceptance:
  - [x] Open the page on a machine where only Claude is installed → three cards; Claude shows its
        actual state; Codex and Grok each offer to install. (cards; evidence/cards-ACCT-001.txt)
  - [x] Slow status detection down → the cards stay on a loading placeholder, never an install
        offer, until detection answers. (cards; evidence/cards-ACCT-001.txt)
Compat: —
Source: D-07-001

### ACCT-002 · A Connect card walks from not installed to connected through clear states
Tier: P0 · Pushed: 6 · State at 0.15.0: live-unverified
User does: looks at a Connect card, clicks "Connect", goes through sign-in and comes back.
User sees: the card is always in exactly one state out of not installed, installing, not connected,
  connecting, connected and needs attention, with only the action that suits it.
Rules: not connected offers a main "Connect" button and an "Other ways to connect" menu listing that
  agent's other sign-in methods; connecting tells the user, depending on the method, that a browser
  page opened, or asks for a pasted code next to an "Open sign-in page" link, or shows a device code
  to enter elsewhere; "Cancel" is always there; connected shows the account's label (email or plan)
  with "Manage" and "Disconnect", plus "Renew" for the Claude 1-year key; default methods: the
  1-year key for Claude, ChatGPT sign-in for Codex, the Grok CLI's login for Grok; only Claude takes
  a pasted code; the other agents finish in the browser or by device code; Cancel ends the sign-in
  process underneath, not just what the card displays, and, with nothing in progress, it also wipes
  a leftover needs-attention state; each connect choice is greyed out while its request is pending
  and comes back after 30 seconds if no answer arrives, so the card can never hang.
Acceptance:
  - [x] Click Connect on Codex → the card goes to connecting with Cancel; complete the browser
        sign-in → connected with the account label. (cards; evidence/cards-ACCT-002.txt)
  - [x] Click Cancel while connecting → the sign-in stops, the card returns to not connected and no
        partial account is kept. (cards; evidence/cards-ACCT-002.txt)
Compat: Seven ways to connect must exist: Claude by 1-year key, Claude by account, Codex by ChatGPT
  sign-in, Codex by device code, Grok by CLI login, Grok by device code, Grok by API key.
Source: D-07-002

### ACCT-003 · A missing agent tool installs from its Connect card
Tier: P0 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks "Install" on the card of an agent that is not on the machine.
User sees: a progress bar with Cancel during the install; when it finishes the card moves on to not
  connected, with no Kolux restart.
Rules: on Windows the install goes through the system package manager, and progress is read from
  what that tool prints; once installed, the program search path is read again so the new tool is
  found at once, and any remembered version check is thrown away; an install still going after 15
  minutes is stopped and shown as failed; agents with no automatic installer get "Open install page"
  instead; the package manager's known exit codes are turned into plain reasons such as already
  installed, blocked by SmartScreen, or not available; starting another install for the same agent
  ends the earlier one.
Acceptance:
  - [x] Click Install on a missing Codex → progress moves, then the card shows not connected and
        Connect works with no restart. (cards; evidence/cards-ACCT-003.txt)
  - [x] Make an install hang → after 15 minutes the card shows a failure with "Try installing
        again". (cards; evidence/cards-ACCT-003.txt)
Compat: —
Source: D-07-003

### ACCT-008 · Grok connects by its CLI login, a device code or a pasted xAI key
Tier: P0 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks "Connect" on the Grok card, or picks "Sign in with a code" or "Use an xAI API
  key".
User sees: the Grok CLI login completes and the card turns connected; on the key route a small
  dialog takes the key a single time.
Rules: the key route is labelled advanced and pay-per-use, unlike the subscription sign-in; the
  dialog's Connect stays disabled until something is typed, sends the key once, and the key never
  appears on screen again; Cancel empties the field, even when the dialog is reopened without being
  rebuilt; the key is stored sealed like every other secret (ACCT-009); when both a Grok CLI sign-in
  and a saved xAI key exist, the card reports the sign-in; a sign-in the user had already made shows
  as connected with nothing to do.
Acceptance:
  - [x] Open the key dialog → Connect is disabled; type a key → it enables; submit → the card is
        connected and the key text appears nowhere on the page. (cards; evidence/cards-ACCT-008.txt)
  - [x] Type a key, press Cancel, reopen → the field is blank. (cards; evidence/cards-ACCT-008.txt)
Compat: A saved xAI key carries over from an older profile.
Source: D-07-008

### ACCT-034 · Model routing tiers per provider for workers
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: opens model routing in the Agents settings, chooses a provider, and sets a model and an
  effort level for each tier.
User sees: four tiers named Major, Deep, Build and Light, each with a model picker and an effort
  picker, plus a reset for the chosen provider.
Rules: providers that are not installed still appear, each carrying a mark that this computer lacks
  it; Claude's defaults: the newest top model at high effort for Major, Opus at high for Deep,
  Sonnet at medium for Build, Haiku for Light; Codex has a separate default ladder of models and
  efforts; reset puts back the defaults of that one provider.
Acceptance:
  - [x] Set Claude's Build tier to Opus at high, then reset Claude → Build goes back to Sonnet at
        medium and Codex is unchanged. (cards; evidence/cards-ACCT-034.txt)
  - [x] On a machine without Codex → the Codex tab can still be selected and shows a not-detected
        mark. (cards; evidence/cards-ACCT-034.txt)
Compat: Each provider's table of tier to model and effort, for all four tiers, carries over.
Source: D-07-034

### ACCT-046 · Windows terminals choose the best shell on the machine
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a terminal on Windows.
User sees: PowerShell 7 when it is installed, otherwise Windows PowerShell, otherwise the classic
  command prompt, each set up so prompts and Unicode text work.
Rules: Microsoft Store stub programs are passed over, and the command prompt is always the final
  fallback; the command prompt starts in UTF-8; PowerShell gets prompt markers so Kolux can tell
  where each command begins and ends; Git Bash is started as a login shell; if the preferred
  PowerShell is refused with access denied, the next shell in line is tried rather than failing the
  pane; the command prompt is located through the system's command-interpreter setting when that is
  set; an automatic choice waits for the PowerShell availability check before deciding; a PowerShell
  7 the user asked for by name is used even if that check said it was missing.
Acceptance:
  - [ ] On a machine with no PowerShell 7 → a new pane opens Windows PowerShell; take that away too
        → the command prompt opens in UTF-8.
  - [ ] Make PowerShell 7 refuse to start with access denied → the pane opens in the next shell in
        the order instead of failing.
Compat: —
Source: D-07-046

### ACCT-047 · Startup commands run once, after the shell is ready
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a pane that carries a startup command, such as an agent launch.
User sees: the command runs a single time, only after the prompt is ready, and arrives intact.
Rules: zsh, bash and fish are wrapped so they signal when they are ready, while the user's own
  config folder is still honoured; commands that are long or full of quotes are handed over some
  other way (through standard input, or as an encoded PowerShell command) rather than typed in;
  login shells get their startup commands too; if the shell quits before it signals ready, any
  output held back while waiting is still shown.
Acceptance:
  - [ ] Launch an agent with a long prompt full of quotes → it starts once, with the prompt
        unchanged.
  - [ ] Use a shell that exits before it signals ready → what it printed is still shown in the pane.
Compat: —
Source: D-07-047

### ACCT-048 · Terminals begin with a clean environment
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a terminal.
User sees: tools act as they would in an ordinary terminal: none of Kolux's own build variables, no
  half-activated Python environment, no prompt-theme setup wizard popping up.
Rules: variables that belong to Kolux's own runtime and packaging are not passed down; conda
  variables that were only partly inherited are removed; the Powerlevel10k first-run wizard is kept
  from starting; when Kolux hands a pane its own git settings, inherited numbered git settings above
  Kolux's count are removed so old ones do not slip through.
Acceptance:
  - [ ] Open a pane and list its environment → nothing from Kolux's own runtime mode or packaging is
        present.
  - [ ] Start Kolux from a shell with a partly active conda environment → a new pane shows no
        leftover conda variables.
Compat: —
Source: D-07-048

### ACCT-049 · Terminals refuse start folders that are unsafe or out of reach
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a pane for a project whose folder is gone, unmounted, or the root of a drive.
User sees: a clear message about the folder, rather than a silent start somewhere else.
Rules: an agent never starts on its own in the filesystem root; on Windows the home folder is worked
  out from the home drive and home path; an unmounted volume gets a message that says what to do;
  folder checks are throttled so many panes at once cannot stall the app.
Acceptance:
  - [ ] Point a project at a drive that is unplugged → opening a pane shows the unmounted-volume
        message.
  - [ ] Ask for an agent pane whose start folder is the filesystem root → the agent does not start
        by itself there.
Compat: —
Source: D-07-049

### ACCT-065 · macOS and Linux terminals fall back to a shell that works
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a terminal on macOS or Linux when the login shell, or the shell they chose, has
  been deleted or cannot be run.
User sees: the pane opens anyway in the next standard shell available; if none can be found, the
  pane lists every shell it tried.
Rules: a shell given only by name, not as a full path, is passed through untouched and found via the
  program search path or the start folder; a full path that is absent or cannot be run falls back to
  zsh, then bash, then sh; when none of those works, the error names each shell that was attempted.
Acceptance:
  - [ ] Set the shell to a full path that does not exist → a new pane opens in zsh, or bash, or sh,
        whichever is found first.
  - [ ] Set the shell to the bare name bash → the pane runs it from the search path, with no
        fallback.
  - [ ] With no usable shell at all → the pane shows a failure that lists every shell tried.
Compat: —
Source: D-07-065

### ACCT-056 · A failed scan never drops worktrees from the list
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens a project while git is slow, or while a worktree scan fails.
User sees: worktrees already known stay listed; cleanup removes only worktrees Kolux can show it
  made.
Rules: a failed scan removes nothing; removal needs proof of where the worktree came from.
Acceptance:
  - [ ] Make the worktree scan fail → the sidebar still shows every known worktree.
  - [ ] Ask cleanup to remove a worktree Kolux did not create → it is left in place.
Compat: —
Source: D-07-056

### ACCT-050 · Kolux recognises which agent runs in each pane
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: starts an agent by hand inside a plain terminal pane.
User sees: the pane is treated as that agent's session, and its status and header follow.
Rules: recognition looks at the program in the foreground of the pane, using the pane's process
  group on Windows; when the result is unclear Kolux reports unknown rather than guessing; earlier
  answers are re-checked cheaply so recognition costs little CPU; an agent suspended with Ctrl-Z
  does not count as running: the shell is taken to own the pane again, and a background job is never
  the foreground agent.
Acceptance:
  - [ ] Type the Claude command in a plain pane → within a few seconds the pane counts as a Claude
        session.
  - [ ] Suspend that agent with Ctrl-Z → the pane is no longer treated as running Claude.
Compat: —
Source: D-07-050

### ACCT-016 · The Claude accounts list: system default and managed accounts
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens the Claude accounts section in the advanced area.
User sees: a "System default" row for the usual Claude login, then one row per managed account with
  its email, organisation and last sign-in time, an Active badge on the chosen one and a Needs
  re-auth warning on stale ones.
Rules: every managed row offers "Re-authenticate" and "Remove", and removal is confirmed first;
  removing the active account switches back to the system default; with no managed accounts the
  section says Kolux is using the system-default login; clicking a row makes it the account for new
  Claude sessions.
Acceptance:
  - [ ] Add two accounts and click the second → it shows Active, and new Claude panes run as that
        account.
  - [ ] Remove the active account and confirm → System default becomes Active.
Compat: —
Source: D-07-016

### ACCT-017 · Changing the active Claude account is safe with sessions running
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: changes the active Claude account while Claude panes are open.
User sees: the change goes through; sessions already running are left alone and new ones use the new
  account; if the change fails, the earlier choice comes back.
Rules: before moving off the system default, its credentials are saved aside, and they are put back
  on returning to it; if the user signs out of Claude outside Kolux, Kolux does not bring that login
  back; renewed credentials are written back only when they provably belong to the same account;
  running sessions keep their account until they are restarted; a Claude launch asked for while a
  change is still under way is refused with a message to try again in a moment; a sign-in the user
  made inside Claude itself while a managed account was active is kept, not overwritten, on
  returning to the system default; returning to the system default when Kolux holds no saved copy of
  it removes the managed account's credentials, so Claude ends up signed out instead of still signed
  in as the managed account.
Acceptance:
  - [ ] With a Claude pane running, change accounts → that pane keeps working, and a new pane signs
        in as the new account.
  - [ ] Force the change to fail → the earlier account still shows Active.
Compat: —
Amended 2026-10-11 (DT-A3): no save-aside copy; managed accounts run in their own folders, so the system login is never touched and a switch is a single locked write.
Source: D-07-017

### ACCT-018 · The same Claude account cannot be added twice
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: signs in again with an account that is already in the list.
User sees: Kolux reports that the account is already there and adds no second row.
Rules: two accounts are the same when the email matches (ignoring letter case and surrounding
  spaces) and the organisation and the place the account runs also match; one email in two
  organisations is two separate accounts.
Acceptance:
  - [ ] Add an account, then add it again with the email typed in another letter case → no new row,
        and an already-added message.
  - [ ] Add the same email under a second organisation → a second row appears.
Compat: —
Source: D-07-018

### ACCT-019 · The Codex accounts list for fast switching
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens the Codex accounts section, and adds, picks or removes accounts.
User sees: an optional list of Codex accounts, each signed in on its own, used for switching and for
  live rate-limit figures; a row warns when its sign-in is missing or stale.
Rules: row warnings are needs sign-in and needs re-auth; removal is confirmed first, and when the
  active account is removed the system default takes over; a personal and a business workspace on
  one email stay two accounts, labelled so they can be told apart; adding or picking an account does
  not wait for a quota refresh; a credential file that is missing for a moment is tolerated for a
  grace period, and a locked sign-in file never leads to a home being deleted; removing an account
  retries for a short while when Windows still has its folder locked; while the user's Codex
  settings point Codex at a custom model provider, adding a ChatGPT-signed Codex account is refused
  and those settings stay untouched; the message tells the user to stay on the system default or
  switch the provider back first; an account's ownership is proven by its own identity, never by a
  plan label that happens to match.
Acceptance:
  - [ ] Add a personal and a business Codex sign-in with the same email → two rows with different
        labels.
  - [ ] Remove the active Codex account → the system default becomes active, and new Codex panes use
        it.
Compat: Managed Codex accounts and which one is active (including the older record that kept one
  active choice per runtime) carry over.
Source: D-07-019

### ACCT-020 · Codex's system-default login is shown truthfully
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: looks at the Codex section without having added any managed account.
User sees: the system-default row says whether Codex is signed in with ChatGPT, running on an API
  key, or signed out.
Rules: Kolux reads the system login from a mirrored copy and never edits the user's own Codex
  folder; an API-key login with a custom provider is never mistaken for a ChatGPT account; when the
  user signs Codex out outside Kolux, Kolux throws away its mirrored copy of that sign-in instead of
  restoring it; an older copy of the same sign-in is never copied back from the system login unless
  Kolux can prove where it came from.
Acceptance:
  - [ ] Sign Codex out in a plain terminal, then focus Kolux → the system-default row shows signed
        out.
  - [ ] Sign Codex in with an API key and a custom provider → the row shows the API-key login, not a
        ChatGPT account.
Compat: —
Amended 2026-10-11 (DT-A3): no mirrored copy; Kolux reads the user's own Codex folder directly, read only, re-read whenever the window gets focus.
Source: D-07-020

### ACCT-023 · A resumed session keeps the account it began on
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: changes accounts, then resumes or restarts an older session.
User sees: the session comes back under the account it started with; a pane whose account has been
  removed is flagged stale instead of being moved quietly to another account.
Rules: stale panes are matched by account identity, not by label; sign-in errors that Codex prints
  in a pane are caught and raise the re-auth notice (ACCT-012); a resume waits until the right
  account's home is in place; if the original account's sign-in is still unavailable after about two
  seconds, the resume fails with a try-again message rather than carrying on as another account.
  (Kolux, T-139-b: a pane keeps the account id it started on and a restart hands it back to
  the pane start, which waits up to 2 s for that account's home; an account no longer listed
  refuses the start with a try-again message. Panes are not yet restored across a Kolux restart
  and sign-in errors printed in a pane are not scanned, T-139-d.)
Acceptance:
  - [ ] Start Codex on account A, change to B, restart the pane → it still runs as A.
  - [ ] Remove account A → the pane shows that it needs a new account.
Compat: —
Source: D-07-023

### ACCT-027 · The Grok section shows the CLI sign-in and credit use
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens the Grok section, or clicks "Refresh usage".
User sees: whether the Grok CLI is signed in, the weekly credit used and the monthly spend on
  unified billing; when signed out it tells the user to run Grok's login command.
Rules: Kolux reads the Grok CLI's own session from disk and keeps no second login of its own; an
  expired session shows how to sign back in.
Acceptance:
  - [ ] Sign the Grok CLI out → the section says to run the login command; sign in again and click
        Refresh usage → the credit figures come back.
  - [ ] Let the Grok session expire → the section explains how to sign in again.
Compat: —
Source: D-07-027

### ACCT-031 · `kolux account add` and `kolux account list`
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: runs the account commands in a terminal on the machine where Kolux is running.
User sees: add runs the agent's own login right in that terminal and registers the outcome as a
  managed account; list prints the managed Claude and Codex accounts.
Rules: add assumes Claude unless `--agent` names Claude or Codex; adding Codex uses device
  authorisation, so the browser can be on another machine; both commands take `--json`; the Kolux
  app must be running, and the commands say so when it is not; flags for environments and pairing
  codes are rejected, not silently ignored.
Acceptance:
  - [ ] Run `kolux account add --agent codex` → a device code is printed; after sign-in the account
        appears in Settings.
  - [ ] Run `kolux account list --json` → valid JSON that lists every managed account.
Compat: `kolux account add [--agent claude|codex] [--json]` and `kolux account list [--json]`.
Source: D-07-031

### ACCT-032 · Model choice per agent; the live per-account lookup exists but is off the main path
Tier: P1 · Pushed: 4 · State at 0.15.0: half-done
User does: opens the model choice while starting a session.
User sees: the session picker currently offers a built-in model list for each agent; the live list,
  which asks the agent's tool what this account may use, reaches only the hidden native chat view
  and the commit-message model choice.
Rules: the session picker has built-in lists for Claude, Codex, Grok, Gemini and Cursor; a live
  lookup makes a short, non-interactive call to the agent's own tool for the models open to this
  account; it exists for Claude, Grok and Cursor; when a live lookup fails, the built-in list is
  used; for Grok a discovered list replaces the built-in one, because Grok drops model names between
  releases and launching a dropped name fails; Codex and Gemini have no live lookup yet (planned,
  not shipped); Claude, Codex and Grok are the featured agents in the picker; agents without a
  built-in list, and plain terminals, skip the model step; for agents that have one, the launch
  waits until the user picks a model or picks the normal-model option, which leaves the tool's own
  default in charge.
Acceptance:
  - [ ] Open the model choice for a new Claude session with the Claude tool unreachable → models are
        still listed.
  - [ ] Once the live lookup feeds the picker: the list matches what the tool reports for the
        signed-in account; block the tool → the built-in list shows instead.
Compat: —
Source: D-07-032

### ACCT-064 · Changing the Codex account offers to restart live Codex panes
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: changes the active Codex account, or changes the Codex setup, while Codex sessions are
  running.
User sees: every pane still running Codex shows a centred prompt saying the account changed and
  naming the account that pane is still using, with a choice between keeping that account and
  restarting; a setup change shows a version that asks for a restart to pick up the current
  configuration.
Rules: only panes whose foreground program truly is Codex are asked; a pane where the user has
  already left Codex, or runs something of their own, is left alone, and short-lived shell readings
  do not dismiss the prompt; Restart starts Codex again in the same pane once its shell is ready,
  signed in as the newly chosen account; panes split beside it are not touched; keeping the old
  account dismisses the prompt for that pane only; choosing yet another account asks again; going
  back to the account the pane started on removes its prompt without a restart, and two different
  accounts with the same label still count as different; a restart that fails brings the prompt
  back; after Kolux itself restarts, restored Codex panes still on an outdated account are asked
  again; keyboard focus moves into the prompt only for the active, visible pane; hidden or
  background panes never take focus; panes on remote hosts or in WSL are not asked about a change
  made for this computer (those cases left with area 18); a resumed Codex pane whose sign-in folder
  matches no known account is tied to no account and is never asked.
  (Kolux, T-139-b: a Codex pane runs the program itself, so "foreground program is Codex" is
  the pane's program being credited as Codex and still running; Restart remounts the pane on the
  active account at once, there is no shell to wait for; a restart that fails is a failed launch,
  DT-C19; the setup-change version and re-asking after a Kolux restart are T-139-d.)
Acceptance:
  - [ ] Codex in two panes and a plain shell in a third; change the Codex account → both Codex panes
        show the prompt and the shell pane does not.
  - [ ] Click Restart in one pane → only that pane restarts Codex on the new account; the other
        keeps its prompt.
  - [ ] Go back to the original account → the remaining prompts disappear without a restart.
  - [ ] Keep the old account in a pane, then choose a third account → that pane is asked again.
  - [ ] Quit and reopen Kolux with a Codex pane still on the old account → the prompt comes back.
Compat: —
Source: D-07-064

### ACCT-010 · A key that can no longer be unsealed is cleared with a reconnect hint
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: opens Kolux after the system's key store has changed, for example a new Windows profile
  or a restored backup.
User sees: the affected connection shows not connected, and a message asks the user to reconnect it
  on the AI connections page; otherwise the app opens as usual.
Rules: only the key that fails to unseal is dropped; every other setting loads unchanged; the
  message says where to reconnect: Settings, then AI connections.
Acceptance:
  - [ ] Damage the sealed Claude key in the settings file → Kolux opens, Claude shows not connected,
        and a reconnect message appears.
  - [ ] In that same run → every other setting and connection is as it was.
Compat: —
Source: D-07-010

### ACCT-011 · Keys and sign-in links never show up in logs, errors or on screen
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: connects, has a sign-in fail, or shares a log.
User sees: error messages say what went wrong without revealing tokens, sign-in links or codes.
Rules: the Claude 1-year key is masked in every log; login errors are rephrased so they never repeat
  a sign-in link or device code; the xAI key dialog never displays a key once it was submitted; an
  automated check fails the build if managed credentials are ever written in the clear.
Acceptance:
  - [ ] Connect Claude by key with logging on → the log holds a masking marker, not the key.
  - [ ] Make a Claude login fail after a link was printed → the error shown holds no link.
Compat: —
Source: D-07-011

### ACCT-055 · The app window can read only files it was given access to
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: opens files from projects or worktrees, or from a folder they picked.
User sees: those files open; anything outside them is turned down.
Rules: allowed: project and worktree folders, and paths granted exactly; refused: network shares,
  the drive root, and a whole folder tree granted through picking one file; folders reached through
  a symbolic link are not exposed; the list of grants has a size limit.
Acceptance:
  - [ ] Ask the app window to read a file outside every project → refused.
  - [ ] Pick one file, then ask for another file in the same folder → refused.
Compat: —
Source: D-07-055

### ACCT-015 · Disconnect removes only what Kolux made
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks "Disconnect" on a connected card and confirms.
User sees: a confirmation step; afterwards the card is back to not connected.
Rules: 1-year key: the stored key is erased; managed account: that account is removed from Kolux;
  system-default login: nothing is deleted, and Kolux only explains how to sign out in the agent's
  own tool; when Kolux quits, every connect flow in progress is cancelled and every running install
  is stopped.
Acceptance:
  - [ ] Disconnect a Claude key connection → the key is gone from settings and the card shows not
        connected.
  - [ ] Disconnect while Codex uses the system login → the user's Codex login still works in a plain
        terminal.
Compat: —
Source: D-07-015

### ACCT-014 · Connection status stays current without constant polling
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: signs in or installs an agent outside Kolux, then comes back to it.
User sees: the cards update by themselves once Kolux has focus again; "Check again" detects afresh
  without starting any sign-in.
Rules: a light backup check runs every 5 seconds, only while the page is open and the window is
  visible; getting focus back triggers an immediate check; Check again re-reads the program path and
  forgets the remembered version before detecting, and never connects anything; each check works out
  every status once and sends the result to all open windows.
Acceptance:
  - [ ] Run the agent's login in a terminal outside Kolux, then focus Kolux → within a second or two
        the card shows connected.
  - [ ] Minimise the window → no status checks run until it is visible again.
Compat: —
Source: D-07-014

### ACCT-021 · Codex settings are copied into each account, with sync problems flagged
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: edits the usual Codex settings file, then runs a managed Codex account.
User sees: the managed account uses the same settings; if copying fails, the section says why.
Rules: warnings cover a settings file locked by antivirus, a missing settings file, and an empty
  one; shared settings left by older releases can still be read; before a launch, the user's own
  Codex skills, plugins and profile are made available inside each account's home without replacing
  that account's sign-in or sessions, and later edits to the user's settings are picked up before
  the next launch; copying never overwrites a project-trust entry that Codex writes at the same
  moment, and a failed copy never stops a launch.
Acceptance:
  - [ ] Add a model setting to the Codex settings file → a new pane on a managed account uses it.
  - [ ] Lock the settings file → the section shows a locked-file warning.
Compat: The user's Codex TOML settings file is copied into each managed home.
Source: D-07-021

### ACCT-024 · New sessions wait until the chosen sign-in is ready
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens a new Claude or Codex pane just after launch or just after changing accounts.
User sees: the pane starts already signed in as the chosen account, with no login prompt.
Rules: Codex panes wait for the managed account's credentials to be in place; only a Claude pane in
  1-year-key mode receives the Claude key variable; managed-account and plain panes have it removed
  so they use their own login; if the chosen Codex account still has no sign-in after about two
  seconds, the pane starts on the system-default login instead of hanging; with a managed Claude
  account active, if the user's own per-agent environment settings set an Anthropic key or token
  (names compared without case on Windows, exactly elsewhere), the pane is not started and the
  message asks the user to remove those overrides; Anthropic settings that are not sign-ins, such as
  a custom endpoint, are fine, and so is an override that sets such a variable to an empty value to
  blank it; a Codex pane reattaching to a session that is already running is never held back for
  sign-in; if the user changes the Codex account while a new pane is still waiting, the pane starts
  on the newly chosen account; if one choice after another lacks a usable sign-in, the pane does not
  start and the message says to open it again.
Acceptance:
  - [ ] Change Codex accounts and open a pane right away → it runs as the new account with no login
        prompt.
  - [ ] Open a plain shell while a key connection exists → the Claude key variable is not set in
        that shell.
Compat: Claude Code's OAuth-token environment variable is set only in key-mode Claude panes.
Source: D-07-024

### ACCT-025 · Sign-ins survive quitting and restarting
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or restarts it for an update.
User sees: on reopening, every account is still signed in, including tokens renewed during the last
  run.
Rules: on quit Kolux saves Codex sign-ins first, then Claude's, then writes settings to disk, each
  step with a time limit so quitting never hangs.
Acceptance:
  - [ ] Renew a Claude account's token, quit straight away, reopen → the account is signed in with
        no re-auth.
  - [ ] Make one save step hang during quit → Kolux still quits once that step's time limit passes.
Compat: —
Source: D-07-025

### ACCT-026 · Accounts and keys carry over from older releases
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: upgrades Kolux, or moves from the old app to the rebuild.
User sees: accounts added before, the active choice and saved keys are all there.
Rules: Codex sign-ins from the older shared home are moved into per-account homes; older session
  lists are migrated so past sessions can still be resumed; saved sign-ins for MCP tools in the old
  shared Codex home move into the account's own home, readable only by the user, and nothing is
  created when there are none; the old shared Codex sign-in is taken over once, and never later used
  to refill an account whose own sign-in has disappeared.
Acceptance:
  - [ ] Bring in a profile with two Claude accounts and one Codex account → all three appear, with
        the same one Active.
  - [ ] Bring in a profile with no MCP sign-ins → no MCP sign-in data is created in any account
        home.
Compat: Carry over managed Claude accounts and the active one, managed Codex accounts and the active
  ones, the Claude connection mode, the Claude 1-year key and its creation date, the Claude opt-out
  choice, the xAI key, MiniMax settings, and the Gemini credentials choice.
Source: D-07-026

### ACCT-051 · Closing a pane or quitting ends every child process
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes a pane or quits Kolux.
User sees: no agent or shell processes are left orphaned.
Rules: panes are asked to stop first, then forced; during an immediate Windows shutdown the whole
  process tree is ended; quitting stops every pane.
  (Kolux, DT-C27 as changed 2026-10-20: quitting leaves terminals running in the background
  terminal service; closing a pane still ends its whole process tree.)
Acceptance:
  - [ ] Run a long command in a pane and quit → no matching process is left.
  - [ ] Close a pane whose agent ignores the polite stop → the agent is forced to end.
Compat: —
Source: D-07-051

### ACCT-052 · macOS terminals start as real login sessions
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a terminal on macOS.
User sees: privacy permissions and login-session behaviour are the same as in the system Terminal
  app.
Rules: a login wrapper and a session check are used where available; if the session check fails,
  later panes check again and go back to the login wrapper once it works.
Acceptance:
  - [ ] On macOS, open a pane and read a protected folder → it behaves as in Terminal.
  - [ ] Make the session check fail once → a later pane checks again and uses the login wrapper when
        it succeeds.
Compat: —
Source: D-07-052

### ACCT-053 · Wide characters are not doubled in Windows terminals
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: prints Chinese, Japanese, Korean or emoji text in a Windows pane.
User sees: each character shows once, also after a redraw.
Rules: the fix covers both the Windows console layer and the redraw buffer.
Acceptance:
  - [ ] Echo a CJK string in PowerShell → it shows once.
  - [ ] Force a redraw of that pane → the string still shows once.
Compat: —
Source: D-07-053

### ACCT-060 · Terminal modes reset sensibly when an agent exits
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: quits or restarts an agent in a pane.
User sees: mouse, paste and cursor work normally afterwards, while an agent that is still running
  keeps its hidden cursor.
Rules: the reset covers mouse tracking, bracketed paste and whether the cursor is visible.
Acceptance:
  - [ ] Quit an agent that had turned on mouse mode → clicking in the shell no longer prints escape
        codes.
  - [ ] Restart an agent that hides the cursor → while it runs, the cursor stays hidden.
Compat: —
Source: D-07-060

### ACCT-061 · Terminal links open only when safe
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks a link printed in a terminal.
User sees: ordinary links open; unsafe targets are ignored.
Rules: every link is checked before it is opened; if link detection trips over unusual output, the
  error is contained: that line simply has no links and the pane keeps working.
Acceptance:
  - [ ] Click an https link in a pane → it opens; click a disallowed scheme → nothing happens.
  - [ ] Print output that breaks link detection → the pane keeps working and that line has no links.
Compat: —
Source: D-07-061

### ACCT-063 · Each agent pane has one clear owning session
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: restarts, resumes or closes agent panes.
User sees: status and resume always point at the right session; old panes are retired rather than
  doubled.
Rules: pane ownership is tracked so a pane that reattaches takes over cleanly; session handles are
  linked across restarts so resume finds the right conversation; a tab the user closed is not
  brought back when a late reattach arrives for it; a forked conversation is recorded as a fork of
  the session it came from, never as a resume of it.
Acceptance:
  - [ ] Restart an agent pane → one pane, one status, and resume opens the same conversation.
  - [ ] Close a tab, then let a late reattach for it arrive → the tab stays closed.
Compat: —
Source: D-07-063

### ACCT-022 · Choose which Codex folder past sessions come from
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: sets the Codex home that session history is read from, or clicks "Reset".
User sees: an empty field means the standard Codex folder; a custom path makes Kolux read session
  history there instead.
Rules: Reset empties the field, which means the standard folder.
Acceptance:
  - [ ] Enter a custom folder that holds Codex sessions → those sessions can be resumed in Kolux.
  - [ ] Click Reset → the field is empty and history comes from the standard Codex folder.
Compat: —
Source: D-07-022

### ACCT-028 · MiniMax credentials for usage tracking
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: pastes a MiniMax session cookie or API key, chooses the endpoint, and may override the
  group id or the model names.
User sees: each credential can be saved, replaced or forgotten and is marked as kept on this
  computer; usage refreshes right after a save or a clear.
Rules: the section appears only when MiniMax is detected; a help popover explains how to copy the
  session cookie; the endpoint starts as overseas and the usage model as general.
Acceptance:
  - [ ] Save a MiniMax key → a usage refresh runs; Forget → the key is removed and usage clears.
  - [ ] On a machine where MiniMax is not detected → the section does not appear.
Compat: The MiniMax group id, usage-model names and endpoint choice carry over.
Source: D-07-028

### ACCT-029 · Use Gemini CLI credentials (experimental)
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: switches on the experimental setting for Gemini CLI credentials.
User sees: Kolux reads the Gemini CLI's own sign-in to show usage; the setting appears only when
  Gemini is detected.
Rules: off by default.
Acceptance:
  - [ ] With Gemini installed and signed in, switch the setting on → Gemini usage shows.
  - [ ] On a fresh profile → the setting is off.
Compat: The on or off choice (off unless turned on) carries over.
Source: D-07-029

### ACCT-035 · The first connection is recorded; failures name the agent
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: connects an agent for the first time, or has a connect attempt fail.
User sees: failure toasts name the agent that failed; the first connection counts as a step done in
  the guided first run.
Rules: the milestone is recorded once, for the first agent connected; if the statuses fail to load,
  a friendly error toast appears rather than an empty page with no explanation.
Acceptance:
  - [ ] Make a Grok connect fail → the toast names Grok.
  - [ ] Connect the first agent on a fresh profile → the first-run checklist ticks it off.
Compat: —
Source: D-07-035

### ACCT-054 · Fast output never freezes a pane
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs something that prints a flood of output.
User sees: the pane keeps pace and stays responsive.
Rules: output is acknowledged in running totals, so the producer pauses when the screen falls
  behind.
Acceptance:
  - [ ] Print a 100 MB file in a pane → the app stays responsive and the pane finishes.
  - [ ] Type in another pane during the flood → keystrokes appear without a visible delay.
Compat: —
Source: D-07-054

### ACCT-059 · Memory caps scale with the machine
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs many panes on a small or a large machine.
User sees: Kolux sizes its buffers and caches to the machine's memory.
Rules: the caps come from a memory profile picked at startup.
Acceptance:
  - [ ] On a low-memory machine → scrollback caps are lower than on a large one.
  - [ ] Restart Kolux on the same machine → the same caps are chosen.
Compat: —
Source: D-07-059

### ACCT-030 · Settings search finds account sections
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: types a provider or account word into the Settings search.
User sees: on the accounts page, only the sections that match stay visible.
Rules: each section is filtered by itself, not the page as a whole.
Acceptance:
  - [ ] Search for Codex → only the Codex section shows on the accounts page.
  - [ ] Clear the search → every account section is visible again.
Compat: —
Source: D-07-030

### ACCT-033 · Commit-message model choices are discovered per agent
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: picks which agent and model writes AI commit messages.
User sees: the model list matches what the installed agent really offers, with defaults when
  discovery fails.
Rules: discovery covers Claude, Codex, Pi, Cursor and Antigravity; Grok is only probed and keeps a
  fixed default; discovered lists are remembered per agent.
Acceptance:
  - [ ] Choose Codex for commit messages → its model list comes from the installed tool.
  - [ ] Make discovery fail → the default list is offered.
Compat: —
Source: D-07-033

### ACCT-057 · Task sources fall back to GitHub
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the Tasks list.
User sees: GitHub is the source; without a signed-in GitHub CLI it is shown as unavailable instead
  of failing.
Rules: hidden or unknown providers fall back to GitHub.
Acceptance:
  - [ ] Sign the GitHub CLI out → Tasks shows GitHub as unavailable.
  - [ ] Leave a saved task source set to a provider that is gone → Tasks uses GitHub.
Compat: —
Source: D-07-057

### ACCT-058 · Review-bot authors can be overridden
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: reads review comments posted by bots.
User sees: known bot accounts are marked as bots.
Rules: the override list is matched against the author's name.
Acceptance:
  - [ ] A review comment from a bot on the list shows as a bot.
  - [ ] A comment from an author not on the list shows as a person.
Compat: —
Source: D-07-058

### ACCT-062 · Nim files get syntax colours
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a Nim source file in the editor.
User sees: keywords, strings and comments are coloured.
Rules: a grammar shipped with the app is used.
Acceptance:
  - [ ] Open a Nim source file → it is highlighted.
  - [ ] With no network connection → highlighting still works.
Compat: —
Source: D-07-062

### ACCT-036 · Account switcher that suggests another account with quota left
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: opened the Claude or Codex usage menu in the status bar.
User sees: other accounts offered to switch to; when a Codex account hit its limit, the menu named
  an account that still had quota, or offered to check the rest.
Rules: a switch applied to new sessions, with a hint to restart live sessions before carrying on old
  conversations; a link opened account management in Settings; the menus were left in place, but
  nothing has displayed them since the status-bar usage readout went away on 2026-10-05; switching
  itself stays in Settings (ACCT-016, ACCT-019).
Acceptance:
  - [ ] Default build → no status-bar usage menu and no switch suggestion appear.
  - [ ] Switching accounts is still possible from the accounts page in Settings.
Compat: —
Decision: H: default skip. The scope names this switcher, so the owner may mark it build; it is not
  shipped in any live view.
Source: D-07-036

### ACCT-037 · Codex rate-limit reset credit from the switcher
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: spent a Codex rate-limit reset credit from the Codex usage menu.
User sees: a confirmation, which could be skipped from then on, then the limit was reset once.
Rules: redeeming ran one at a time and was remembered across restarts, so a credit could never be
  spent twice; the redeeming service still works, but its only button sits in the status-bar menu
  that is no longer shown.
Acceptance:
  - [ ] Default build → no button to redeem a reset credit appears anywhere.
  - [ ] If revived: redeem twice in quick succession, or redeem and restart at once → exactly one
        credit is spent.
Compat: The saved choice to skip that confirmation (off unless turned on).
Decision: H: default skip
Source: D-07-037

### ACCT-038 · Several Kolux profiles (developer only)
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: with a developer switch set, creates profiles, switches between them and moves projects
  from one to another.
User sees: a profile list and a switcher; without the switch none of it shows.
Rules: it turns on only when a developer environment variable is set to 1; projects and their
  session state can move between profiles; only switching and moving are developer-only: every
  install runs on one default local profile, made at first launch from the earlier data, which is
  copied and never deleted; the rebuild needs just that single-profile path, and keeping data is
  area 19; the profile list is rebuilt when its index is missing, also on macOS and Linux under a
  restrictive file-creation mask.
Acceptance:
  - [ ] Default build → no profile list or switcher anywhere.
  - [ ] First launch over data from an earlier release → one default profile is made from it, and
        the earlier data is still on disk.
Compat: The old developer switch was an environment variable; the rebuild chooses its own.
Decision: H: default skip. The single default profile is on the live path and is built anyway (area
  19).
Source: D-07-038

### ACCT-039 · Kolux cloud account and organisation members
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: signed in to a Kolux account in the browser and invited, removed or revoked organisation
  members.
User sees: a cloud-linked profile with a member list; the session renewed itself quietly.
Rules: hidden on 2026-09-28 because it pointed at placeholder hosts, and removed on 2026-10-05 along
  with the other cloud-only features.
Acceptance:
  - [ ] Default build → no Kolux account sign-in and no member list anywhere.
  - [ ] No network call goes to any Kolux cloud service.
Compat: —
Decision: H: default skip
Source: D-07-039

### ACCT-040 · Accounts that run inside WSL
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: chose where accounts run: automatically, on this computer, or in WSL with a chosen
  distribution.
User sees: separate account choices for Windows and for WSL, with older WSL sign-ins moved into the
  newer layout.
Rules: WSL accounts were never sealed by the key vault.
Acceptance:
  - [ ] Default build → no account-location choice and no WSL account list.
  - [ ] An older profile's WSL account choices are not brought over.
Compat: The account location and WSL distribution choices do not carry over.
Decision: default cut: WSL execution is part of area 18. Revive via DECISIONS.md.
Source: D-07-040

### ACCT-041 · Account management for a remote Kolux host
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: controlled a remote or headless Kolux from the desktop.
User sees: Add Account greyed out with a note to use the command line on the host; Connect cards
  mentioned SSH projects.
Rules: remote-scope notices appeared in the Claude and Codex sections.
Acceptance:
  - [ ] Default build → no remote-scope notice in any account section.
  - [ ] Add Account is never disabled because of a remote host.
Compat: —
Decision: default cut: remote hosts are area 18. Revive via DECISIONS.md.
Source: D-07-041

### ACCT-042 · Notice when an unpaired device asks to sign in
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: had a phone or another device try to connect without being paired.
User sees: a single notification about that device.
Rules: shown once, even when the request came in before the window was ready.
Acceptance:
  - [ ] Default build → no pairing and no unpaired-device notification.
  - [ ] Nothing listens for sign-in requests from other devices.
Compat: —
Decision: default cut: mobile pairing is area 18. Revive via DECISIONS.md.
Source: D-07-042

### ACCT-043 · Files on SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browsed, previewed, downloaded and watched files on an SSH host.
User sees: remote files in the explorer, with live change notices and partial or streamed reads.
Rules: roughly 120 of the tests mapped to this area covered it.
Acceptance:
  - [ ] Default build → the explorer shows files on this computer only.
  - [ ] No SSH connection is opened to read or watch files.
Compat: —
Decision: default cut: SSH hosts are area 18. Revive via DECISIONS.md.
Source: D-07-043

### ACCT-044 · Git on SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: ran status, diff, staging, commit messages, merge, sync and worktrees on an SSH host.
User sees: the source-control panel working on a remote repository.
Rules: roughly 130 of the tests mapped to this area covered it.
Acceptance:
  - [ ] Default build → source control works on repositories on this computer only.
  - [ ] No git command is sent over SSH.
Compat: —
Decision: default cut: SSH hosts are area 18. Revive via DECISIONS.md.
Source: D-07-044

### ACCT-045 · Terminals on SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened terminals and agent sessions on an SSH host and reattached after drops.
User sees: remote panes that outlived reconnects and sent notifications back to the desktop.
Rules: a choice between local and SSH decided which back end served each pane.
Acceptance:
  - [ ] Default build → every pane runs on this computer.
  - [ ] No pane offers an SSH host as where it runs.
Compat: —
Decision: default cut: SSH hosts are area 18. Revive via DECISIONS.md.
Source: D-07-045

## Dropped by default (tier D)

- ACCT-040 · Accounts that run inside WSL — WSL execution left with area 18 (owner cut, 2026-10-05);
  accounts run on this computer only.
- ACCT-041 · Account management for a remote Kolux host — remote and headless hosts left with area
  18 (owner cut, 2026-10-05).
- ACCT-042 · Notice when an unpaired device asks to sign in — mobile and device pairing left with
  area 18 (owner cut, 2026-10-05).
- ACCT-043 · Files on SSH hosts — SSH hosts left with area 18 (owner cut, 2026-10-05).
- ACCT-044 · Git on SSH hosts — SSH hosts left with area 18 (owner cut, 2026-10-05).
- ACCT-045 · Terminals on SSH hosts — SSH hosts left with area 18 (owner cut, 2026-10-05).

## Hidden or retired (tier H)

- ACCT-036 · Account switcher that suggests another account with quota left — retired 2026-10-05
  with the status-bar usage readout; default skip (the owner may mark it build).
- ACCT-037 · Codex rate-limit reset credit from the switcher — retired 2026-10-05, its only button
  lived in that menu; default skip.
- ACCT-038 · Several Kolux profiles (developer only) — developer-only, behind an environment switch;
  default skip (the single default profile is built anyway).
- ACCT-039 · Kolux cloud account and organisation members — hidden 2026-09-28, removed 2026-10-05;
  default skip.
