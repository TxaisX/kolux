# 06 · Usage & limits

This area covers how Kolux shows the user how much of an agent's context and of an account's plan
has been spent, and what it does when a limit is reached. Every agent pane header carries a fill
ring with a percentage, tabs carry a smaller ring, Board cards and the Agents view carry a compact
meter that sets context against the window beside the plan's 5-hour and weekly figures, and a pill
at the top right gives the unused share of the weekly allowance for Claude and Codex. Out of the box
Claude, Claude Agent Teams and Codex are held to a 200k context window so they compact early. An
opt-in switch lets Kolux nudge a stopped Claude session with a brief keep-going message after the
limit window rolls over. Alerts go off at 80% and 95% of a usage window, and launch dialogs warn
when an account is close to spent. The Stats & Usage page counts Kolux activity and, when the user
opts in per provider, turns local Claude and Codex logs into token and cost analytics, next to a
Grok credits panel and a card that can be shared as a picture. The run-out forecast left the screen
on 2026-10-05 but still computes, and is marked for building into the pill's hover.

Tier counts: P0 11 · P1 10 · P2 6 · H 4 · X 1 · D 1
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 07 Accounts, sign-in & keys · 08 Orchestration · 09 Automations · 15 Skills, plugins & starter kits · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 21 Retired, hidden, removed, dev-only

## Cards

### USAGE-002 · Board cards carry a compact session meter
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: opens the Board and looks at the card for one session.
User sees: a compact meter on the card: a bar of context spent against the window, written in tokens
  (say 84k / 200k), and under it the account's plan spending as a 5-hour percentage and a weekly
  percentage.
Rules: the context bar shows up only after the session has reported its context, while the plan
  figures can show without it; only windows Kolux actually knows about are listed, so a plan with
  nothing but a weekly limit shows the weekly figure alone; with neither a context reading nor plan
  figures, the meter is left off the card instead of being drawn empty; the bar goes yellow at 70%
  and red past 90%, on the same scale as the pane header.
  (Kolux RS, T-040-a: the meter sits under the card's chip row and reads `84k / 200k` then
  `5-hour 38% · Weekly 63%` as used percentages; hovering gives the same words with the fill
  percentage; the yellow is the attention colour and the red a new `danger` token.)
Acceptance:
  - [x] A Claude card partway through a session → a context bar plus 5-hour and weekly percentages. (T-040-a)
  - [x] A new card before its first turn → plan figures only; a card whose agent has no usage source
        → no meter at all. (T-040-a)
Compat: —
Source: D-06-002

### USAGE-003 · Agent tabs carry a tiny context ring
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: glances along the tab strip.
User sees: a tiny ring on every agent tab that fills with that session's context; hovering gives the
  same text as the Board meter. The tab itself never prints a number.
Rules: when a tab holds several panes, the ring follows whichever pane reported last; the ring stays
  hidden until a context reading exists, even when plan figures are already known; the percentage
  lives only in the pane header, never on the tab.
  (Kolux RS, T-040-a: a tab is one pane, so the ring is that pane's; the strip only shows when a
  cell holds more than one tab, as before. The ring is `src/usage/Ring.tsx`, shared with the pane
  header's gauge, and turns yellow and red on the card bar's scale.)
Acceptance:
  - [x] Run Claude in a tab → a ring appears after the first reply and fills as the session goes on;
        hovering shows the context and plan wording. (T-040-a, by a posted report)
  - [x] A Codex tab that has plan figures but no context reading → no ring. (T-040-a)
Compat: —
Source: D-06-003

### USAGE-004 · Agents view shows rings per session and a plan footer
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: opens the Agents view and picks an agent.
User sees: the compact meter (context bar plus 5-hour and weekly figures) in the detail header, a
  ring on each session row, and a footer line giving the provider's 5-hour figure and when that
  window resets.
Rules: the footer names the provider, gives its 5-hour percentage and its reset time, and follows
  the used-or-left display choice (USAGE-025); session rows use the same ring as tabs and leave it
  off when there is no context reading.
  (Kolux RS, T-040-b: the detail header is the picked session's pane header, which shows the 5-hour
  and weekly figures beside its context gauge; the footer sits at the foot of the rail and follows
  the used-or-left display setting, whose Appearance control comes with the used-or-left task.)
Acceptance:
  - [x] Pick a Claude agent at 40% of its 5-hour window → the footer reads Claude 40% with a reset
        time; switch the display to remaining → the footer reads 60%. (cards; evidence/cards-USAGE-004.txt)
  - [x] Session rows that have a context reading show a ring; rows without one show none. (cards; evidence/cards-USAGE-004.txt)
Compat: —
Source: D-06-004

### USAGE-005 · How the meters work out context and plan figures
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: reads any meter, ring or header percentage.
User sees: numbers that match the window the session truly runs in and the plan its agent is billed
  against, with token counts shortened to k and M.
Rules: context fill is measured against the effective window: 200k while the cap (USAGE-006) is on,
  otherwise the model's own window; anything past full reads 100% and a window of zero reads 0%;
  context readings come from what Claude's statusline sends; tokens spent are the total it states,
  or failing that input plus cache writes plus cache reads added up, or failing that its stated
  percentage applied to the window; only Claude and Claude Agent Teams report context; Codex and
  Grok sessions carry plan figures only; plan figures follow the session's agent: Claude and Agent
  Teams to the Claude account, Codex to Codex, Grok to Grok; agents Kolux does not recognise, and
  sessions running on another machine, get none; only a 5-hour window and a weekly window are shown,
  each rounded to a whole percent; a window of any other length is left out rather than shown under
  the wrong name; plan data that failed, is unavailable or is missing shows nothing at all, never an
  old or a zero figure; thousands are written with k and millions with M.
  (Kolux RS, T-040-a: `src/usage/meter.ts`; the status line's `context_window` gives
  `total_input_tokens`, else `current_usage.input_tokens` + `cache_creation_input_tokens` +
  `cache_read_input_tokens`, else `used_percentage` of `context_window_size`; the cap is always on
  until T-041 wires the switch through `contextFill`'s argument; millions keep one decimal, 1.3M.)
Acceptance:
  - [x] Cap on, Claude session at 100k tokens on a model whose window is 1M → the meter reads 50%,
        not 10%. (T-040-a, unit test)
  - [x] Switch the cap off → the same session is measured against the model's full window. (T-041-a)
  - [x] Make the plan read fail → the plan figures vanish from the meter instead of reading 0%. (T-040-a, unit test)
Compat: —
Source: D-06-005

### USAGE-006 · Claude, Agent Teams and Codex are held to a 200k window by default
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: starts Claude, Claude Agent Teams or Codex; may switch the cap off on the Agents settings
  page.
User sees: sessions compact at around 200k tokens instead of running on to the model's whole window,
  which makes plan allowance last longer on long sessions; a single switch on the Agents page turns
  this off.
Rules: on out of the box, and a setting that was never saved counts as on; switching it off applies
  from the next launch, and running sessions keep what they started with; Claude and Agent Teams
  receive the cap as an environment variable, with their command-line arguments left alone; Codex
  receives it as two per-run configuration overrides (context window 200k, compacting at 180k)
  placed ahead of any end-of-options marker, with its environment left alone; a window the user
  already picked always wins: the cap is not added when the environment already sets the variable, a
  compact option is passed explicitly, or the Codex arguments or a command override already set
  either value, select a Codex profile or turn on its open-source mode; Grok and every other agent
  are untouched, and no agent's own configuration file is ever written; the launch setup Kolux saves
  stays free of the cap; the cap is put back exactly once when a saved command runs again, when a
  session resumes, and for draft launches; adding the cap a second time has the same effect as
  adding it once.
  (Kolux RS, T-041-a: setting key `contextCap200k`; the cap is added in Rust as the pane starts,
  on the arguments and environment handed to the PTY, never on the start line Kolux keeps, which
  is how a rerun gets it exactly once. The switch lives on Settings > Agents. Claude Agent Teams
  is a skipped agent in Kolux RS, so only Claude Code and Codex are capped.)
Acceptance:
  - [x] Launch Claude with default settings → its process environment holds a 200k auto-compact
        window. (T-041-a, unit test on the environment handed to the PTY)
  - [x] Launch Codex with its own profile option → no cap overrides are added. (T-041-a, unit test)
  - [x] Switch the cap off and relaunch → neither Claude nor Codex is capped; Grok never is. (T-041-a, Codex live, Claude by unit test)
Compat: Claude and Agent Teams get Claude Code's auto-compact window environment variable set to
  200,000; Codex gets per-run config overrides for its model context window (200,000) and its
  auto-compact token limit (180,000); the switch is on unless the user turned it off.
Source: D-06-006

### USAGE-007 · Claude carries on by itself once a limit resets (opt-in)
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: turns on resume-after-limit in the Claude part of the AI connections page, then leaves a
  Claude session that runs into its usage limit.
User sees: roughly a minute after the limit resets, Kolux types a brief prompt into the stopped
  Claude pane saying the limit is over and asking it to continue, and the agent goes on with nobody
  at the keyboard.
Rules: off out of the box; switching it off discards anything waiting, switching it on picks up
  panes that already stopped on a limit, and the setting is looked at again right before typing;
  only a Claude pane whose stop reason is a usage limit qualifies; other stop reasons and other
  agents are skipped; it types only while Claude is the program in the foreground of that pane,
  never into a bare shell left behind after Claude exited nor into another agent that took over; if
  the foreground program cannot be determined it keeps waiting instead of giving up; any typing by
  the user in that pane after the stop cancels the resume; typing before the stop, or in a different
  pane, does not; the reset time is taken from the stop event when it carries one; otherwise from
  the account's weekly window if that is used up, otherwise from its used-up 5-hour window; windows
  already past or not used up are ignored; a used-up weekly window that lacks a reset time is never
  swapped for the 5-hour one; with no known reset time nothing is scheduled; each pane fires at most
  once per reset time, and reset times only seconds apart count as one; a truly new reset time can
  fire again; panes never affect each other; if the computer sleeps through the due time it fires on
  the first check after waking; it gives up half an hour after the due time if the pane never
  becomes reachable; closing the pane cancels it; after Kolux restarts, stopped panes are scheduled
  again, but a restored pane first waits through a short settling time, is skipped if its reset went
  by while Kolux was closed, and is never typed into twice; if the terminal refuses the text Kolux
  does not try again, and notes the refusal in its log a single time; the timer runs only while at
  least one resume is waiting.
  (Kolux RS, T-041-b: `src-tauri/src/resume.rs`. "Claude in the foreground" is the `claude` program
  Kolux started for the pane, from its start until its exit; a pane running a shell cannot tell,
  so it waits and gives up half an hour after the due time. A restored wait settles two minutes.
  The 15-second check thread idles rather than stopping while nothing waits. Waits live under
  kv `claudeResumeWaiting`; the refusal note goes to `logs/kolux.log`.)
Acceptance:
  - [x] Switch it on and let a Claude pane stop on a limit that has a reset time → about a minute
        after the reset the continue prompt appears once and Claude resumes. (T-041-b: typed into a real Claude Code pane whose input held a `/`, so no request went out)
  - [x] Type a draft into the stopped pane → nothing is sent at the reset. (T-041-b)
  - [x] Exit Claude so that only a shell is left → nothing is typed and the waiting resume expires. (T-041-b: in Kolux RS the pane's terminal ends with the program, so the wait drops)
  - [x] Leave the switch off → nothing is ever typed. (cards live; evidence/cards-USAGE-007.txt)
Compat: A saved on/off choice that stays off unless the user turns it on.
Source: D-06-007

### USAGE-008 · Weekly usage pill at the top right
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: looks at the top right corner of the window.
User sees: a rounded pill giving the part of this week's allowance still unused for Claude and for
  Codex (for instance Claude 62% left), coloured according to how much of the weekly allowance is
  spent; hovering explains that this is the weekly limit and how long until it resets.
Rules: only the weekly window ever appears here, never the 5-hour one; a provider is listed only
  when its agent is installed, its weekly window is known, and its usage item is switched on in the
  status-bar item list; it always reads as the amount left, whatever the used-or-left setting says;
  its tint follows the same 70/90 scale of percentage used as the session meters; with no known
  reset time the hover says so instead of counting down; the pill is for reading only and does
  nothing when clicked.
  (Kolux RS, T-041-a: the hover reads `Weekly limit: N% left, resets in 2d 4h`; Codex's refused
  sign-in keeps its yellow "sign in again" part, as its own card asks; the status-bar item list
  is not built yet, so every installed provider counts as switched on until it is.)
Acceptance:
  - [x] Claude and Codex both signed in → both listed with percent left; Claude at 85% used shows
        15% left in yellow. (T-041-a, Claude by a posted report, Codex by unit test)
  - [x] Switch off the Codex usage item → Codex drops out of the pill. (the item list is T-148) (cards; evidence/cards-USAGE-008.txt)
  - [x] Hover → the weekly limit and a countdown to its reset. (T-041-a)
Compat: —
Source: D-06-008

### USAGE-021 · Claude plan figures read safely from several sources
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: uses Claude through a browser sign-in, a long-lived token, or a sign-in managed outside
  Kolux.
User sees: claude's 5-hour and weekly figures, plus the separate weekly limit for the top model
  tier, kept current, or a plain reason why they are unavailable, without Kolux upsetting the user's
  sign-in.
Rules: while a Claude session runs, the updates its statusline sends drive the figures live and
  background account checks pause; updates from an unknown or a different Claude config folder are
  dropped, unreadable updates and updates with no usage windows are ignored, and an update that
  carries one window leaves the other one as it was; otherwise Kolux asks the provider's usage
  service with the saved sign-in, and when that is safe falls back to reading Claude's own usage
  screen in a hidden terminal; that fallback is for accounts Kolux manages, not for the computer's
  default Claude sign-in; with a long-lived token, or a sign-in the user manages, Kolux sends no
  usage request at all and marks the figures unavailable; the hidden-terminal fallback is never used
  with a token; a refused sign-in may be repaired once through the Claude command line and the read
  tried again; a missing permission shows as something the user must act on; when the provider asks
  Kolux to slow down, Kolux waits until the stated retry time (one day at most) and the fallback
  never hides that; when a live Claude terminal is the one renewing the sign-in, Kolux holds off and
  reads again after those terminals close instead of competing with them; that follow-up read
  happens only if the earlier read really was put off for this reason; the top tier's weekly limit
  is shown as a window of its own; an entry whose window length cannot be told is skipped; hidden
  usage terminals start in a harmless folder, use the configured proxy, and are always cleaned up
  after a timeout or a cancel; the saved sign-in is looked up in a fixed order: the per-account
  entry in the system credential store, then the older shared entry, then the sign-in file; an
  out-of-date per-account entry falls back to the older shared entry only for the computer's default
  account; if the service returns the 5-hour and weekly figures but not the top tier's weekly
  figure, only that missing figure is taken from Claude's usage screen and the service's own figures
  are kept.
Acceptance:
  (Kolux RS, T-041-a: the status line is the only source; no usage request ever goes out, and the
  hidden-terminal usage screen is not read (DT-C14). The status script sends the session's config
  folder as `X-Kolux-Config`; a report from a folder other than the active account's, or from a
  managed folder while the computer's default sign-in is active, is dropped; a report with one
  window is merged over the stored windows.)
Acceptance:
  - [x] Run a Claude session → the figures change within a turn without any background check. (T-041-a, by a posted report)
  - [x] Set the Claude account to use a token → no usage request goes out and the figures read
        unavailable. (T-041-a: nothing is requested in any mode)
  - [ ] Make the service answer with a slow-down and a retry time → Kolux waits until then unless
        the user presses refresh. (no service is asked, DT-C14)
Compat: Reads the status updates that Claude Code's statusline sends through the script Kolux
  installs for it: the plan windows with their reset times, the context window, and the config
  folder the session runs under.
Source: D-06-021

### USAGE-022 · Codex plan figures read without opening a session
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: uses Codex with one or more signed-in accounts.
User sees: codex's 5-hour and weekly figures and how many limit-reset credits remain, or a prompt to
  sign in again when the account needs it.
Rules: Kolux tries Codex's own usage service first, then a background Codex process that only reads,
  then Codex's status screen in a hidden terminal; if no sign-in exists no Codex process is
  launched; a sign-in screen or a dead refresh token ends the read and raises a sign-in-again
  warning; a plan with only a weekly limit never shows that limit in the 5-hour place; each window
  keeps its own reset time; weekly rows that belong to one particular model are ignored; the
  reset-credit count comes from the background process, or from the service when the process leaves
  it out; at most one read runs per Codex home at a time, and background processes get time to close
  cleanly before they are stopped by force; failure messages say what went wrong with file locations
  and secrets taken out; when the background process gives only the weekly window but the service
  still knows the 5-hour one, the 5-hour figure is taken from the service; whether the user is
  signed in is checked first in the account's own Codex home, then in the folder named by Codex's
  home environment variable, then in the default Codex folder under the user's home.
  (Kolux RS, T-042-b, DT-C15: only the background process route is built. Codex's usage service
  is not public documentation, and the hidden-terminal status screen is Codex's interactive
  `/status` card, which needs a session open and has no documented layout; it shows the same
  figures the background read returns, reset credits included, so nothing is ever taken "from
  the service".)
Acceptance:
  - [x] Signed in on a weekly-only plan → only the weekly figure shows, with its reset time. (cards; evidence/cards-USAGE-022.txt)
  - [x] Revoke the Codex sign-in → the figures go, a sign-in-again warning shows, and no Codex
        window is started. (cards; evidence/cards-USAGE-022.txt)
Compat: Honours Codex's home-folder environment variable, and otherwise Codex's default folder in
  the user's home, when checking sign-in.
Source: D-06-022

### USAGE-001 · Each agent pane header carries a context ring and a percentage
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: looks at the header of an agent pane.
User sees: next to the pane title, a small ring that fills up as the agent's context window fills,
  with the percentage printed beside it and tinted by how full it is; hovering explains what the
  number means.
Rules: an agent pane header always has the ring and the number; until the first reading comes in it
  shows a greyed 0% and the hover says nothing has been received yet; tint by fullness: plain or
  green below 70%, yellow from 70% up to 90%, red beyond 90%; readings are per pane, so two panes
  sharing a tab each carry their own; a newer reading always takes the place of an older one, and a
  reading that turns up late carrying an older value than the one on screen is thrown away; closing
  or clearing the pane forgets its reading.
Acceptance:
  - [x] Start a Claude session → a greyed 0% until the first turn, then a tinted figure that grows
        with the conversation. (cards; evidence/cards-USAGE-001.txt)
  - [x] Take a session beyond 90% of its window → the ring and the number go red. (cards; evidence/cards-USAGE-001.txt)
  - [x] Split a tab into two Claude panes at different fill levels → each header shows its own
        figure. (cards; evidence/cards-USAGE-001.txt)
Compat: —
Source: D-06-001

### USAGE-023 · Usage figures refresh on a timer and ride out errors
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: leaves Kolux open, comes back to its window, or presses a refresh button.
User sees: figures that stay fairly fresh, update when the window is focused again, and hold their
  last known values through short outages without flicker.
Rules: a background refresh runs every five minutes, and focusing the window also refreshes unless
  one ran moments ago; the first focus after a delayed start fetches once, and a start-up fetch that
  failed is retried on later focuses, backing off while it keeps failing; a manual refresh ignores
  both the short debounce and the provider's retry-after wait; recent figures survive repeated
  failures, and an error mark stays steady during background retries instead of flashing a loading
  state; one provider failing or lagging never stalls or blanks the others; usage updates that
  arrive while Kolux is still starting up are kept.
Acceptance:
  - [x] Cut the network → figures keep their last values; restore it and focus the window → they
        refresh. (cards; evidence/cards-USAGE-023.txt)
  - [x] Make Grok slow to answer → Claude and Codex still update promptly. (cards; evidence/cards-USAGE-023.txt)
Compat: —
Source: D-06-023

### USAGE-009 · Alerts at 80% and 95% of a usage window
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: carries on working while an account's usage rises.
User sees: a system notification headed with the agent's name and a usage alert, telling which
  window (5-hour, weekly, monthly and so on) has hit 80% or 95% and about when it resets.
Rules: covers Claude, Codex, Gemini (each quota bucket), Kimi, Antigravity, MiniMax and Grok; each
  threshold fires once per window and is armed again only when the window moves on to a new reset
  time; which alerts already fired is saved, so restarting Kolux does not repeat them; if usage is
  at or over 95% the first time Kolux sees it, both alerts fire together; under 80% nothing fires; a
  window with no known reset time never alerts; the wording handles 5-hour, weekly, monthly, any
  number of days and any number of hours, with a general phrase for other lengths; alerts obey the
  master notifications switch and a usage-alerts preference that is on by default, and nothing goes
  out until settings have loaded; while the Kolux window is hidden, the tray icon gets its attention
  dot even when the notification itself is held back.
Acceptance:
  - [ ] Take a 5-hour window from 70% to 82% → one 80% alert; more refreshes inside the same window
        add nothing.
  - [ ] Start Kolux with a window already at 97% → two alerts, for 80% and 95%, once each.
  - [ ] Let the window reset and climb again → the alerts come back.
Compat: Carry over the usage-alerts preference (on by default) and the record of which threshold
  already fired for each provider and window, tied to that window's reset time.
Source: D-06-009

### USAGE-010 · Launch dialogs warn when an account is nearly spent
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens the Launch agents dialog or a starter-kit setup and chooses agents.
User sees: a warning above the launch button naming every provider whose current usage window stands
  at 80% or more, so the user knows the seats about to start draw on an account that is almost
  empty.
Rules: one line per provider however many seats use it, so two providers over the mark give two
  lines; the 5-hour window is used, or the weekly and then the monthly window for a provider with no
  shorter one; under 80%, or with no figures at all, there is no warning; agents without a usage
  source are ignored, and the warning never stops the launch.
Acceptance:
  - [ ] Claude at 85%, choose three Claude seats → a single Claude line.
  - [ ] Add a Codex seat with Codex at 90% → a second line, for Codex.
  - [ ] Bring Claude down to 50% → no warning.
Compat: —
Source: D-06-010

### USAGE-011 · Stats & Usage page with Kolux activity counts
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens Settings and chooses the Stats & Usage page, or types usage into the command
  palette.
User sees: three headline cards (agents started, time agents spent working, pull requests created)
  with the date counting began, and a usage analytics area below them; before any agent has ever
  run, an invitation to start the first one.
Rules: searching for usage in the palette goes straight to this page; counts are stored on this
  computer and survive restarts; saving is batched, and the last save at quit always beats one still
  pending; a single agent turn is one session: a status repeated after a reconnect or loaded back
  from disk never starts another, waiting and blocked close a stretch of work instead of lengthening
  it, and refreshes that only restate who the agent is are ignored; agents that report only through
  hooks are counted even without a terminal title Kolux recognises; closing a pane, or losing the
  connection that owned it, ends any session it had open.
Acceptance:
  - [ ] New profile → the page shows the invitation to start a first agent.
  - [ ] Run two agent turns, reconnect, open the page again → agents started and working time
        reflect two turns, no more.
  - [ ] Quit while agents are busy and start again → the counts are intact.
Compat: An importer should bring over the local activity counts: agents started, working time, pull
  requests created and the date counting began.
Source: D-06-011

### USAGE-012 · Usage analytics opens on a combined overview
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: scrolls to usage analytics on the Usage page and uses the provider picker (Overview,
  Claude, Codex, Grok).
User sees: by default a combined overview: total tokens, estimated cost, days with activity and the
  share served from cache, a day-by-day activity grid with the best day marked, the token mix (fresh
  input, cache, output, reasoning), how many providers contribute, and a refresh button.
Rules: only the panel picked is loaded; totals add Claude and Codex together without counting cached
  input twice, and recent days with no use appear as blank squares; with tracking off for every
  provider, the overview offers Enable Claude and Enable Codex in place of figures; with tracking on
  but no logs yet, it explains that figures arrive after the next agent session; when some models
  have no known price, the header marks the cost as partial; refresh is greyed out during a scan and
  rescans only the providers that are turned on; opening the page counts as having tried the usage
  feature for in-app guidance.
Acceptance:
  - [ ] Open the page with tracking on for both → the overview shows combined totals and the
        activity grid.
  - [ ] Turn tracking off for both → the overview shows the two enable buttons.
  - [ ] Switch the picker to Codex → only the Codex panel is drawn.
Compat: —
Source: D-06-012

### USAGE-013 · Token tracking is opt-in for each provider
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: turns Claude or Codex token tracking on or off from its panel or from the overview.
User sees: while it is off, a panel explaining that Kolux would read that agent's logs on this
  computer, with a switch to turn it on; once on, an empty state until logs exist, then figures,
  with the switch, an options menu and refresh in the panel header.
Rules: only logs the agents already keep on this computer are read, and nothing is sent anywhere;
  refresh is greyed out during a scan, and a second request while a scan runs joins that scan
  instead of starting another; a failed scan leaves the last good figures in place and says the scan
  failed; a failed read shows the error with Retry, and a switch that cannot be changed says so (DT-C105); saved results
  appear at once on opening, before a slow rescan completes; an older profile that never recorded a
  choice keeps working and has its saved results rebuilt.
Acceptance:
  - [ ] Open the Claude panel on a new profile → the off state with a switch; turn it on → a scan
        runs and figures follow.
  - [ ] Break the log folder during a scan → the earlier figures stay on screen.
  - [x] A failed token read, rescan or Track switch → the panel names the failure (Retry for the read)
        instead of showing nothing. (unit; evidence/T-669.txt)
Compat: —
Source: D-06-013

### USAGE-014 · Claude and Codex token analytics panels
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: picks Claude or Codex in the provider picker and changes the range and scope filters.
User sees: totals for input, output, cache reads and cache writes, an estimated cost, a chart by
  day, a breakdown by model and a list of recent sessions, all limited to the chosen range and
  scope.
Rules: range is the last 7, 30 or 90 days or all time, with 30 days as the default; scope is Kolux
  worktrees only (the default) or every local use of that agent; in Kolux scope, a history holding
  only outside use shows no data rather than everything; when the project list cannot be read, the
  scope falls back to every local use and says so, instead of reading as no use inside Kolux (DT-C105); days follow the user's local calendar, not
  UTC; long model names wrap instead of being clipped; models whose price was guessed are labelled
  inferred, and unknown prices read n/a; a session that used several models appears once under each
  model it really used; the daily chart stays quick even for very long histories.
Acceptance:
  - [ ] Switch Claude from 30 days to 7 → totals and chart shrink to the last week.
  - [ ] Switch the scope to every local use → sessions run outside Kolux appear.
  - [ ] A session that ran across local midnight → its tokens are divided between the two local
        days.
Compat: —
Source: D-06-014

### USAGE-015 · Estimated cost from each model's published prices
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: reads the estimated cost on the overview, a provider panel or a share card.
User sees: a dollar figure worked out from token counts and per-model prices; models Kolux has no
  price for are left out of the sum and flagged rather than guessed at.
Rules: Claude cache writes are priced by how long they live: 5-minute writes at 1.25 times the base
  input price and 1-hour writes at twice it; a bucket holding both kinds is split without charging
  any token twice, and a 1-hour count bigger than the total is cut back to the total; every Claude
  family has its own prices; older releases are never charged at a newer family's price, and a newer
  point release Kolux does not recognise takes its family's current price; models with one flat
  price across a long context keep that price for the whole window; older models keep their
  long-context surcharge, and moving writes into the 1-hour bucket never makes an estimate smaller;
  past days are charged at the price that applied to them and are not lifted to a higher price in
  the all-time range; Codex cost charges uncached and cached input separately with no overlap;
  reasoning-effort endings and model variants are reduced to the base model before pricing; a bare
  model alias takes its base tier's price; an unknown model gets no cost and keeps its own name
  rather than borrowing another model's price.
Acceptance:
  - [ ] A Claude day with 1M tokens of 1-hour cache writes → those cost twice the base input price
        per million.
  - [ ] A Codex session on a model with no known price → tokens shown, cost n/a, and the header
        marks the cost as partial.
Compat: —
Source: D-06-015

### USAGE-018 · Grok credits panel
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: picks Grok in the usage analytics picker.
User sees: the share of this week's Grok credits used (or of the monthly included budget under
  unified billing), a refresh button and a link to the Grok account settings; when not signed in, a
  prompt to set Grok up in Accounts.
Rules: opening the panel does not refresh every provider: only its own refresh button fetches, and
  it fetches Grok alone; for a weekly credits period with no percentage, use counts as 0% only if
  the reply holds no other usage numbers at all; if it holds credit numbers but no percentage, use
  reads as not reported (unavailable), never 0%; a monthly budget pair is shown as a monthly window
  without making another request; an expired sign-in, a failed fallback request or an empty billing
  reply shows as an error or as unavailable, never as 0%; signed-out and damaged sign-in files are
  reported without revealing where the files live, and a sign-in file with no token inside counts as
  signed out rather than as an error.
Acceptance:
  - [ ] Open the Grok panel → no other provider refreshes; press refresh → Grok's figures update.
  - [ ] Sign out of Grok → the panel offers setup in Accounts.
Compat: —
Source: D-06-018

### USAGE-016 · Claude log scan counts each turn once
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: uses Claude as usual, forking and resuming sessions too, then opens Claude analytics.
User sees: token totals that match real use, with forked or copied sessions not counted twice, and
  usage credited to the Kolux worktree it happened in.
Rules: reads the configured Claude projects folder, including very large and deeply nested ones;
  turns copied into a forked session's file are counted once; if the original file is deleted those
  turns are still counted once, under the copy that remains; saved results for unrelated files are
  kept; repeated streamed pieces of one reply are merged into one; use inside a subfolder of a
  worktree counts toward that worktree, and a session that worked in several places keeps a
  breakdown per place; files unchanged since the last scan are not read again; automation runs can
  look up how much their own worktree's session used.
Acceptance:
  - [ ] Fork a Claude session and rescan → totals rise only by the new turns.
  - [ ] Run Claude in a subfolder of a worktree → its tokens show under that worktree in Kolux
        scope.
Compat: Reads Claude Code's per-project session transcripts, one record per line: token usage per
  reply, cache writes split by lifetime, message and request identifiers, and the working folder.
Source: D-06-016

### USAGE-017 · Codex log scan counts each token event once
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: uses Codex both through Kolux and on its own, then opens Codex analytics.
User sees: codex totals covering sessions from accounts Kolux manages and from the usual Codex
  folder, with no double counting of copies, forks or resumed sessions.
Rules: scans every Codex home Kolux manages, per-account ones included, plus the computer's own
  Codex folder; a Codex home override set in the surrounding environment does not move the scan; an
  account home or sessions folder that points outside Kolux's own storage is never followed; aliases
  leading to the same sessions are read once, and older copied sessions are read only from where
  they branched off; running totals inside the logs serve only as a starting point, so the first
  event of a resumed session is not taken as its whole history; usage is credited to the closest
  worktree that contains it; paths that merely look alike, paths that really climb out of the
  worktree, and other Windows drives get no credit; saved results in an older format are thrown away
  and rebuilt.
Acceptance:
  - [ ] Resume a long Codex session and rescan → only the new tokens are added.
  - [ ] Fork a Codex session → its copied events count once.
Compat: Reads the session log files under each Codex home: the token-count events, the session
  details and the working folder.
Source: D-06-017

### USAGE-019 · Share a usage card as a picture or a post
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: clicks Share on the Claude or Codex panel.
User sees: a dialog previewing a card in Kolux's own branding with total tokens, estimated cost, the
  most-used model, a strip of daily tokens and the date range; Copy image puts the picture on the
  clipboard and the button briefly reads Copied; Share on X opens a ready-written post in the
  browser.
Rules: the card matches the panel's current provider and range; the post text gives the provider,
  range, total tokens and cost; a cost below one cent shows four decimal places, and a missing cost
  shows n/a; closing the dialog while the picture is still being made causes no error; the dialog takes
  focus when it opens, keeps Tab inside, closes on Escape and gives focus back (DT-C105).
Acceptance:
  - [ ] Share, then Copy image → the clipboard holds a picture of the card and the button reads
        Copied for about two seconds.
  - [ ] Share on X → the browser opens a draft post with the range and totals.
  - [x] Open Share from the keyboard → the dialog runs on the shared dialog focus helper, so focus is in
        the dialog, Tab stays inside, Escape closes it and focus goes back (wiring: unit, evidence/T-669.txt;
        the helper's focus moves: unit, evidence/T-667.txt). A live keyboard pass is still to do.
Compat: —
Source: D-06-019

### USAGE-024 · Reset times count down live
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: hovers the usage pill or reads a reset time in a usage line.
User sees: reset times as a countdown in whole units (for example 2h 15m) that updates by itself and
  reads now once due.
Rules: durations are rounded down to whole units and zero parts are dropped; a time already past, or
  exactly now, reads now; within a day of the reset the countdown updates just after each minute; a
  day or more away it updates on the hour; with several resets on screen the nearest one sets the
  rhythm.
Acceptance:
  - [ ] A reset 90 seconds off → reads about a minute, then now when due.
  - [ ] A reset two days off → changes only on the hour.
Compat: —
Source: D-06-024

### USAGE-025 · Choose whether usage reads as used or left
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: in Appearance, under the status bar section, sets Usage percentages to Used or Remaining.
User sees: plan usage lines that follow the choice, showing either how much is spent or how much is
  left.
Rules: a missing or unrecognised value means used; percentages are rounded and held between 0 and
  100, and a broken provider value reads 0; at 0.15.0 only the Agents view footer follows this
  choice, while the top pill always reads left.
Acceptance:
  - [ ] Choose Remaining → the Agents view footer reads 70% for an account 30% used.
  - [ ] Choose Used → it reads 30%, and the top pill still says left.
Compat: —
Source: D-06-025

### USAGE-026 · Gemini and Antigravity quota reading
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opts in to letting Kolux use the Gemini CLI sign-in for usage, then works with Gemini or
  Antigravity.
User sees: gemini quota for each model bucket, with the tightest bucket as the headline figure, and
  Antigravity reported as the same shared quota; at 0.15.0 these figures appear only in usage alerts
  and launch warnings.
Rules: without the opt-in, Kolux never opens Gemini's credential files and reports usage as
  unavailable; expired tokens are refreshed and an unauthorised reply is retried once; duplicate
  buckets are merged and broken entries dropped; model identifiers are turned into readable names;
  Antigravity copies a successful Gemini read; when the read fails it says unavailable without
  blaming the sign-in, and mentions the missing opt-in only when that is the real cause; after a
  failed Gemini read, Antigravity drops any earlier figure and reads unavailable instead of
  presenting old numbers.
Acceptance:
  - [ ] Opt-in off → no Gemini file is opened and no Gemini alerts fire.
  - [ ] Opt-in on with buckets at 40% and 85% → the headline reads 85% and an 80% alert fires.
Compat: Reads the Gemini CLI's own saved browser sign-in; the opt-in switch is off by default.
Source: D-06-026

### USAGE-027 · Kimi and MiniMax quota reading
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: signs in to Kimi, or saves a MiniMax browser cookie or API key along with region, group
  and model choices.
User sees: 5-hour and weekly quota for these providers, feeding usage alerts and launch warnings;
  errors tell an expired cookie or key apart from a failing service.
Rules: Kimi's sign-in is only read, never changed: an expired token is reported, not refreshed; a
  custom Kimi home folder is used when set, and a blank one is ignored; MiniMax uses the API key
  when there is one (overseas or China endpoint) and the browser cookie otherwise, taking the cookie
  either as a header line or in quoted export form; MiniMax's 5-hour window is always treated as
  five hours whatever interval the service reports, and its weekly window is optional; a group
  number the user typed in beats the one inside the cookie; the first configured model is used, a
  blank model list means the general model, and a single result serves as the fallback; cookie
  values, group numbers and tokens are masked in every log and error, and cookies live in a storage
  area of their own that is wiped before and after each read; changing MiniMax credentials throws
  away the old figures, and MiniMax failures never affect other providers; an empty Kimi usage reply
  is an error, never 0%.
Acceptance:
  - [ ] Save an expired MiniMax cookie → usage says the cookie has expired, and other providers
        carry on.
  - [ ] Kimi token expired → shown as expired, with no refresh attempted.
Compat: Carry over the MiniMax group number, model list (the general model by default) and endpoint
  (overseas by default); read Kimi's own saved sign-in from its home folder and honour Kimi's
  home-folder environment variable.
Source: D-06-027

### USAGE-028 · Resource Manager lists terminals picked up after a reload
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the Resource Manager after Kolux reconnected to terminals that outlived a window
  reload.
User sees: those reconnected local terminals listed with their process ids, and not marked as
  remote.
Rules: a local terminal picked up again after a reload is counted in the list exactly like any other
  local terminal.
Acceptance:
  - [ ] Reload the window while a terminal runs → the Resource Manager shows it with a process id,
        as local.
  - [ ] Open a new terminal after the reload → it is listed the same way, and neither one is
        labelled remote.
Compat: —
Source: D-06-028

### USAGE-029 · Status-bar usage segments and account bars (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: used to read usage from the status bar.
User sees: a usage segment per provider with a small bar, menus for switching accounts that showed
  each account's usage, and a choice between a wordy and a compact display.
Rules: taken out when usage moved to the top pill and the pane headers; the parts are still in the
  old build but nothing displays them; the per-provider item switches live on only as a way to hide
  a provider from the top pill; background previews of accounts not in use, which fed those menus,
  are still gathered.
Acceptance:
  - [ ] Default build → the status bar carries no per-provider usage segments or account menus.
  - [x] Turn a provider's usage item off → it only drops out of the top pill (USAGE-008); nothing
        else changes. (cards; evidence/cards-USAGE-029.txt)
Compat: —
Decision: H: default skip
Source: D-06-029

### USAGE-030 · Usage overview dialog (no way to open it since 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: used to open a usage overview from the status bar.
User sees: a dialog listing every usage provider with each window's percentage and time to reset,
  today's tokens, recent sessions, providers marked as not found or unavailable, and a refresh
  button.
Rules: the dialog is still part of the old build, but the one control that opened it is no longer
  connected to anything.
Acceptance:
  - [ ] Default build → no control or command opens a usage overview dialog.
  - [ ] Per-provider window figures stay reachable through the pill, the meters and the Stats &
        Usage page.
Compat: —
Decision: H: default skip
Source: D-06-030

### USAGE-031 · Forecast of when a usage window runs out (off screen since 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: used to hover a provider's usage in the status bar.
User sees: a line estimating when the current window would be used up at the recent rate, or saying
  it would last until it resets.
Rules: the estimate uses roughly the last hour of readings and needs at least two readings five
  minutes apart; it gives nothing when use is flat or falling or when the run-out lands after the
  reset, and treats 100% or more as now; readings are still gathered per window and cleared when the
  window resets; only the hover that displayed the line went away.
Acceptance:
  - [ ] Use climbing steadily inside a window → hovering the top pill shows an estimated run-out
        time before the reset.
  - [ ] Flat use, or a run-out that would land after the reset → the hover says the window lasts
        until it resets.
Compat: —
Decision: H: default build. The estimate still runs and serves knowing limits ahead (theme 4); show
  it in the top pill's hover.
Source: D-06-031

### USAGE-032 · Notice that the usage percentages changed meaning
Tier: H · Pushed: 4 · State at 0.15.0: hidden
User does: upgraded from a version that showed usage the other way round.
User sees: a notice that could be dismissed, explaining the used-or-left choice, shown only to
  profiles that had upgraded and kept the earlier default, and only while usage meters were on
  screen.
Rules: new profiles and anyone who had already picked remaining never saw it, and a dismissal was
  remembered; at 0.15.0 nothing displays the notice.
Acceptance:
  - [ ] Default build with a fresh profile → no notice about usage percentages appears.
  - [ ] A profile that upgraded and kept the earlier default → no such notice either.
Compat: —
Decision: H: default skip
Source: D-06-032

### USAGE-020 · X logo on the post-sharing button
Tier: X · Pushed: 10 · State at 0.15.0: live-unverified
User does: opens the share dialog.
User sees: the button that shares to X wears the X company's own logo, drawn inline.
Rules: this is another company's mark; the rebuild uses an owner-made glyph or a plain text label
  instead.
Acceptance:
  - [ ] Open the share dialog → no third-party logo appears on any button.
  - [ ] The share-to-X button reads clearly as text or as the owner's own glyph.
Compat: —
Source: D-06-020

### USAGE-033 · Usage reading and auto-resume for WSL, SSH and mobile
Tier: D · Pushed: 4 · State at 0.15.0: dropped
User does: runs agents inside WSL or over SSH, or follows usage from the phone app.
User sees: usage read from the WSL distribution's own accounts, auto-resume for SSH panes based on
  their own reset time, and usage sent to subscribed phones.
Rules: WSL panes never use the host's account windows: Codex, Claude and Kimi figures come from the
  distribution's home folder, and a stuck distribution is time-limited instead of holding up the
  refresh; SSH panes use only the reset time that their own stop event reports, and hold off while
  the link is down; moving the runtime to WSL redirects only the Claude and Codex reads; repeated
  phone subscriptions never force a new fetch; hidden usage terminals inside WSL use the configured
  proxy, a WSL target never retries with the host's older saved credential, and the first read picks
  WSL or host from the runtime setting before any out-of-date choice.
Acceptance:
  - [ ] Default build → no WSL, SSH or phone usage path exists; usage is read for this computer's
        own accounts only.
  - [ ] Auto-resume (USAGE-007) only ever targets local Claude panes.
Compat: —
Decision: default cut: WSL, SSH and mobile execution left with area 18. Revive via DECISIONS.md.
Source: D-06-033

### USAGE-034 · Every agent pane header shows the full usage readout
Tier: P1 · Source: Txais 2026-10-19
User does: looks at the header of any Claude agent pane (every screen, not just Agents).
User sees, right of the title, left of the pane buttons, in one row:
  "◯ 78%  155k/200k   5h 34% · 2h 10m   wk 61% · 3d 4h   $3.15"
  - the ring and percentage as today (USAGE-001), then the context in tokens, used / window;
  - the 5-hour and weekly plan figures, each followed by a live countdown to its reset;
  - the session's cost so far, in a cyan chip.
Rules:
  - Tints follow USAGE-001: plain or green below 70%, yellow 70-90%, red beyond 90%, applied to the
    context figure and to each plan figure separately; countdowns and the token count are muted.
  - Plan figures follow the used-or-left choice (USAGE-025); the countdown format follows USAGE-024
    ("2h 10m", "3d 4h", "12m"; "now" once past) and ticks at least every 30 s.
  - Cost is the status-line report's session total cost in US dollars for that pane's session, two decimals;
    a new session in the pane starts it over (same boundary as the gauge, T-052 FIX-2). No report
    yet = no chip.
  - Codex panes show their own provider's windows; panes with no plan figures show only the gauge.
  - Narrow panes drop pieces in this order, never wrapping and never hiding the ring: the cost
    chip first, then the countdowns, then the plan figures, then the token count, so at the
    narrowest only the ring and percentage remain. Thresholds by measured header width, not window
    width, so split panes behave.
  - The hover from USAGE-001 stays and gains one line per window: "5-hour: 34% used, resets 3:40 PM".
Acceptance:
  - [ ] Wide Claude pane after a turn → all five pieces show, tinted per the rules.
  - [ ] Shrink the pane step by step → pieces drop in the stated order; the title stays readable
        before the plan figures go (title truncation must not be worse than today at each step).
  - [ ] Leave it open 2 minutes → the countdowns move without a new turn.
  - [ ] "/clear" or a new session in the pane → cost and context reset; plan figures stay
        (they are the account's, not the session's).
  - [ ] Two split panes → each shows its own context and cost, the same plan figures.
Compat: —
Source: Txais 2026-10-19 (state/kolux-rs-card-header-usage.md, proposed as USAGE-032; renumbered USAGE-034 because USAGE-032 and USAGE-033 were taken)

## Dropped by default (tier D)

- USAGE-033 · Usage reading and auto-resume for WSL, SSH and mobile — WSL, SSH and phone execution
  left with area 18 (remote and hosts).

## Hidden or retired (tier H)

- USAGE-029 · Status-bar usage segments and account bars (retired 2026-10-05) · retired 2026-10-05 ·
  default skip
- USAGE-030 · Usage overview dialog (no way to open it since 2026-10-05) · retired 2026-10-05
  (opener disconnected) · default skip
- USAGE-031 · Forecast of when a usage window runs out (off screen since 2026-10-05) · retired
  2026-10-05 (hover removed, estimate still computed) · default build
- USAGE-032 · Notice that the usage percentages changed meaning · hidden, never displayed at 0.15.0
  · default skip
