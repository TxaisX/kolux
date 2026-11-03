# 15 · Skills, plugins & starter kits

This area covers the things that equip the AIs and give a newcomer a job to hand them. The Skills
page gathers every skill the connected AIs can read (from the home folder, the open repo, each AI's
own skill folder, the shared cross-agent folder and plugin caches) and lets the user search,
filter, inspect and safely delete them. Kolux ships a few skills of its own (a guide to the `kolux`
CLI, orchestration, security review and prompt-injection scepticism) that always match the app
version; they are read with `kolux skills list` and `kolux skills get`, put in place with
`kolux skills install` and `kolux skills update`, and the app nudges when an installed copy falls
behind. The starter-kit gallery offers six ready-made business jobs, each done by three AIs in
titled seats, with sample data to try them, a results strip that follows every role, and Collect
results to gather the output into one dated folder. The Artifacts library, which keeps the pages
Claude publishes and shows them offline, is carded here because its checks live here; area 05
lists it as a view. The plugin marketplace and plugin runtime are cut by default.

Tier counts: P0 2 · P1 25 · P2 5 · H 1 · X 0 · D 8
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 08 Orchestration · 10 Plan review & protected actions · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### SKILL-035 · Pages Claude publishes are kept in Kolux automatically
Tier: P0 · Pushed: — · State at 0.15.0: live
User does: lets a Claude Code session publish an HTML page through Claude's Artifact tool.
User sees: the page turns up in the Artifacts library with its title, the project and session that
  produced it, and the date, and it can be opened with no network connection.
Rules: the publish result is picked up from the session's terminal output or from its transcript;
  output that is replayed or restored, ordinary prose, and similar-looking results from other tools
  are not picked up; there is one entry per URL, so publishing again refreshes that entry and the
  newest publish wins; the page and the assets it points to by relative path are stored, but nothing
  outside the page's own folder; the caps are 10 MB of HTML, 100 assets, 10 MB for any one asset and
  50 MB overall; scripts from allow-listed CDNs (at most 16, at most 5 MB each) are fetched so the
  page still works offline, and when a fetch fails the original script reference is left as it was;
  the entry's title is the page's title element cut to 200 characters, or, lacking a usable one,
  the file's name; pages on a network share are never opened and are listed as
  unavailable; WSL or SSH paths that this machine cannot read are listed as remote.
Acceptance:
  - [x] Claude publishes the same page twice → the library holds one entry showing the second version. (cards; evidence/cards-SKILL-035.txt)
  - [x] A page that points at a file outside its own folder → that file is not copied in. (cards; evidence/cards-SKILL-035.txt)
  - [x] A page stored on a network share → listed as unavailable, and the app never reads it. (cards; evidence/cards-SKILL-035.txt)
Compat: —
Source: D-15-035

### SKILL-036 · Artifacts library page and offline viewer
Tier: P0 · Pushed: — · State at 0.15.0: live
User does: opens Artifacts from the sidebar, searches, selects an entry, adds a page from a file,
  or removes one.
User sees: a list of saved artifacts, newest first, each giving its project (or that it was added by
  hand), its session, its date and a remote badge where that applies; next to the list, a viewer
  renders whichever page is selected.
Rules: the Artifacts sidebar button is always there; search looks at titles, ignores case and
  needs every typed word to appear; a search with no results shows an empty-search message, and
  with nothing selected the viewer invites the user to pick an entry; Add artifact imports a page
  from a file and raises an error toast if that fails; Remove from library deletes the stored copy;
  the viewer is sandboxed, serves only the files stored for that entry, and hands clicked links to
  the system browser; the viewer has remote, loading and could-not-show states.
Acceptance:
  - [x] Search with two words → only titles holding both stay in the list. (cards; evidence/cards-SKILL-036.txt)
  - [x] Click a link inside a viewed artifact → it opens in the system browser, not in Kolux. (cards; evidence/cards-SKILL-036.txt)
  - [x] Add artifact with a file that cannot be read → an error toast, and the list is unchanged. (cards; evidence/cards-SKILL-036.txt)
Compat: —
Source: D-15-036

### SKILL-001 · Six ready-made starter kits for common business jobs
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: browses the starter kits to choose a job for a small team of AIs to do on the user's
  own files.
User sees: six kits — analyse a spreadsheet, tidy and merge two data files, report on a marketing
  campaign, write a research brief, build a sales follow-up list, and sum up the week's metrics.
  Each kit shows a category (data, marketing, research, sales or operations), an estimate between
  15 and 25 minutes, the inputs it asks for, and its three named roles.
Rules:
  - Every kit has exactly three roles, its own id and icon, at least one input, a category and a
    time estimate.
  - Each role has a preferred AI. Spreadsheet: analyst on Claude, report builder on Codex (an HTML
    report), checker on Grok. Tidy and merge: merger on Codex (the merged CSV), quality notes on
    Claude, spot check on Grok. Marketing: writer on Claude, metrics table on Codex, context scan on
    Grok. Research: researcher on Grok, writer on Claude, comparison table on Codex. Sales: lead
    scorer on Codex, follow-up drafts on Claude, data-quality check on Grok. Weekly metrics:
    calculator on Codex, one-page HTML summary on Claude, anomaly finder on Grok.
  - Inputs. Spreadsheet: one CSV needed, a question optional. Tidy and merge: two CSVs needed, merge
    instructions optional. Marketing: a metrics CSV needed, a focus optional. Research: a topic
    typed as text needed, a notes file in Markdown or plain text optional. Sales: a CSV exported
    from the CRM needed, a priority optional. Weekly metrics: a KPI CSV needed, an emphasis optional.
  - Some roles hold back until another finishes: the spreadsheet checker after the analyst, the
    merge spot check after the merger, the weekly anomaly finder after the calculator. A role can
    only wait on a role of its own kit.
  - Each role writes only into its own subfolder of the results folder.
  - Every placeholder in a role's prompt stands for an input the kit declares, and each required
    input is used by at least one role's prompt.
  - Each file input ships with a sample file, and each text input has a sample value that is not
    blank.
Acceptance:
  - [ ] The catalogue holds exactly six kits, with distinct ids and three roles each.
  - [ ] Every file input of every kit has a sample file shipped with the app.
  - [ ] A kit whose role prompt names an input it never declares fails the catalogue check.
Compat: —
Source: D-15-001

### SKILL-002 · Starter kit gallery and its entry points
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens the kit gallery from the kit block on the start screen, from the starter-kits row
  of the launch dialog (which has a link to see them all), or from the newcomer setup checklist.
User sees: a gallery of kit cards; each card has the kit's icon, title, short summary, category
  badge and time estimate, and names every role with the AI it will get, or a not-connected marker
  when no AI can take that role.
Rules: each bundled kit has an icon of its own, and an unknown kit gets a generic one; the gallery
  stays open when the user leaves the start screen, since that screen does not own it; choosing a
  kit opens its setup dialog; a recent-runs section shows in the gallery only once there are past
  runs (SKILL-014).
Acceptance:
  - [ ] Click the kit block on the start screen → the gallery opens with six cards.
  - [ ] Only Claude connected → each role on each card shows Claude.
  - [ ] Leave the start screen while the gallery is open → the gallery stays open.
Compat: —
Source: D-15-002

### SKILL-003 · Kit roles go to the AIs the user has connected
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens a kit with some mix of Claude, Codex and Grok connected.
User sees: an AI against every role. With all three connected each role gets the AI it prefers;
  with fewer, the roles are spread across the ones that are connected.
Rules: a role whose preferred AI is connected gets it; roles whose preferred AI is missing are
  dealt out in rotation from the connected AIs, in the fixed order Claude, Codex, Grok; with no AI
  connected nothing is assigned; only Claude, Codex and Grok can take kit roles, and an AI the user
  has switched off is never offered.
Acceptance:
  - [ ] Claude, Codex and Grok all connected → each role shows its preferred AI.
  - [ ] Only Codex connected → all three roles show Codex.
  - [ ] Grok switched off in settings → no role goes to Grok.
Compat: —
Source: D-15-003

### SKILL-004 · Kit setup dialog gathers inputs and stops bad files
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: fills in a kit's inputs (types or pastes a path, uses Browse, drops a file onto the
  field, or types text), then presses Start kit.
User sees: one field per input with the kit's hint underneath, optional fields marked as optional,
  the folder that will receive the results, and Start kit enabled only once every required input is
  present and valid.
Rules:
  - With no AI connected, a notice asks the user to connect one and Start kit stays disabled.
  - A required-field warning appears only after an empty field loses focus, and goes once it is
    filled.
  - A path to an Excel workbook brings up a card explaining that a CSV is needed and disables Start
    straight away; a CSV path that does not exist is flagged after a brief pause; text inputs are
    never checked against the disk.
  - Start stays disabled while any file path is missing on disk.
  - Browse opens the system file picker limited to the types the input accepts (any file when none
    are set), starting in the project folder; cancelling leaves the field as it was; type matching
    ignores the leading dot and letter case.
  - A path pasted with the quotes that the system's copy-as-path command adds loses one pair of
    surrounding quotes.
  - When several files are dropped the first one is used; dropped folders are ignored; a dropped
    file of a type the input does not list still fills the field; a drop aimed at another input is
    ignored.
  - If an assigned AI's account is close to its usage limit, a warning shows that does not stop
    the start.
  - Switching to another kit clears the folder and every input.
Acceptance:
  - [ ] Enter a path to an Excel workbook → the explanation card shows and Start kit is disabled at
        once.
  - [ ] Paste a path wrapped in quotes → the field keeps the path without them.
  - [ ] Leave a required field empty and tab out → the warning appears; type something → it goes.
  - [ ] Browse, then cancel → the field still holds its earlier value.
Compat: —
Source: D-15-004

### SKILL-005 · Try a kit on bundled sample data, and recall past inputs
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks Try with sample data in a kit's setup, or opens a kit already run before.
User sees: the kit's sample files copied into a samples folder in the home folder, that folder
  opened as a project, and the inputs filled with the sample files and sample text; on a later run
  of the same kit in the same project, the fields come back holding last time's values.
Rules:
  - Samples go into one folder per kit inside a single samples folder in the user's home; copying
    again changes nothing and never overwrites a copy that is already there.
  - The samples folder is added as a project and its workspace opened.
  - When the current workspace already is that kit's sample folder (a first run), the inputs fill
    with sample values without a click; a real project is never prefilled with samples.
  - Remembered values only fill fields that the sample step left empty.
  - Only non-empty values are remembered, nothing is remembered from a sample workspace, and
    remembered values for inputs a kit no longer has are ignored.
  - If copying the samples or adding the project fails, a friendly toast explains what went wrong.
  - An installed copy of the app (not only a development build) finds and copies its bundled
    samples.
Acceptance:
  - [ ] Click Try with sample data → a samples folder appears in the home folder, opens as a
        project, and every required input is filled.
  - [ ] Click it a second time → nothing on disk changes.
  - [ ] Run a kit on real inputs, reopen it in the same project → the fields show the earlier values.
Compat: —
Source: D-15-005

### SKILL-006 · Starting a kit opens one titled session per role
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: presses Start kit.
User sees: one AI session per role opens in the grid, each titled with its role and its AI's name,
  and a toast says how many AIs are on the kit and that most kits need 5 to 20 minutes.
Rules:
  - All seats share the project's own checkout; a kit never makes a worktree per AI.
  - A seat's title is the role title, a middle dot, then the AI's name.
  - Each seat runs its AI's default model.
  - A role that waits on another opens idle, with no prompt sent (SKILL-008).
  - An idle, empty first tab is reused for the first seat.
  - Before launch, results left by an earlier run are gathered into a dated folder and a toast names
    it; nothing is deleted. If that step fails the launch still goes ahead.
  - The run record is written before launch; if that write fails, an error toast warns that results
    may not be tracked.
  - If not one seat starts, an error toast says so.
  - The role-to-session mapping is saved only when every seat started.
  - If the folder already holds a run of a different kit, the user is warned and offered Start
    anyway, shown inline in the setup dialog rather than as a toast; the same kit, or no earlier
    run, starts straight away.
Acceptance:
  - [ ] Start the spreadsheet kit with three AIs → three panes open, titled with role and AI, and
        the checker's pane sits idle.
  - [ ] Start a kit in a folder holding another kit's results → an inline warning with Start anyway;
        nothing starts until it is pressed.
  - [ ] Start a kit where earlier results exist → a toast names a new dated folder that holds them,
        and the originals are untouched.
Compat: —
Source: D-15-006

### SKILL-007 · Every kit seat works under the same plain rules
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: starts a kit and reads what each AI was told.
User sees: each AI gets its role prompt with the user's inputs filled in, then a fixed block of
  rules that keeps it to reading the user's files and turning out plain deliverables.
Rules:
  - Placeholders are swapped for the user's values; an optional input left blank becomes empty
    text.
  - The rules: inputs may be read, but existing files are never edited, moved or deleted; writing
    happens only in the role's own results folder; no software gets installed; the AI's built-in
    tools may be used for sums.
  - Deliverables are Markdown, CSV, or one self-contained HTML page whose charts are inline SVG and
    which loads no outside scripts.
  - The rules name the exact files the role has to produce, then ask for a one-line completion
    marker file in the role's folder.
  - The AI writes for a reader short on time, such as a manager, and keeps the rules and the marker
    file out of what it hands over.
  - The same rules text also fed the results-folder option of the custom-agent builder, which is
    cut (area 02).
Acceptance:
  - [ ] Start a kit and read a seat's first prompt → the inputs stand where the placeholders were,
        and the rules list that role's deliverable files.
  - [ ] Leave an optional input blank → no placeholder text is left in the prompt.
Compat: each role writes in its own subfolder of the project's results folder and finishes by
  writing a short completion-marker file there; deliverables are Markdown, CSV or a single
  self-contained HTML page.
Source: D-15-007

### SKILL-008 · A waiting kit role starts once the role it depends on is done
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: starts a kit with a dependent role, such as a checker, and lets it run.
User sees: the dependent session sits idle and shows which role it is waiting on; when that role
  finishes, the dependent session gets its prompt and gets going.
Rules: the prompt goes out only when the upstream role's completion marker from this run exists
  and the dependent session has been found; it is delivered once, and a send that fails is tried
  again at the next status change; a marker left from an earlier run does not count.
Acceptance:
  - [ ] Spreadsheet kit: the analyst writes its marker → the checker gets its prompt exactly once.
  - [ ] A marker older than the run's start is present before launch → the checker keeps waiting.
Compat: —
Source: D-15-008

### SKILL-009 · Kit results strip above the session grid
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: works in a project where a kit is running or has run.
User sees: a strip that can be folded away, sitting above the sessions, with the kit's icon and
  title, how many roles are done, Open results, Collect results, and a toggle that unfolds one row
  per role.
Rules:
  - Nothing shows when the workspace has no kit run.
  - During a run, with the strip unfolded, results are looked at again roughly every
    10 seconds; looking pauses while the window is hidden or the strip is folded, and happens at
    once on unfold.
  - When the window gets focus back, the app checks again whether a kit run exists.
  - Open results shows the results folder in the system file manager.
  - With no recorded kit run, the strip checks once when it appears and then stops polling.
Acceptance:
  - [ ] Open a project that never ran a kit → no strip.
  - [ ] Start a kit → the strip reads 0 of 3 done; a role writes its marker → within about 10 s it
        reads 1 of 3.
  - [ ] Fold the strip → polling stops until it is unfolded.
Compat: —
Source: D-15-009

### SKILL-010 · Each kit role row says what its AI is up to
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: unfolds the kit strip while the kit is running.
User sees: one row per role with a plain status: not ready yet, waiting on a named role, working
  (with minutes elapsed once past the first minute), done, left from the last run, needs you, or
  stopped with a reason.
Rules:
  - Done means the role's completion marker was written at or after the run started, even if its
    session still looks busy.
  - A file the role was meant to produce that predates the run's start shows as left from the last
    run.
  - Working is plain text in the first minute, then adds the minutes elapsed.
  - Needs you: an ordinary permission or question wait shows a plain needs-you label; a known
    blocking prompt (for example Codex asking the user to review hooks) shows a hint to click and
    answer; a Claude sign-in prompt shows a sign-in hint with Open AI connections.
  - Stopped: a usage limit, a sign-in problem and an exit with no reason each have their own label
    (actions in SKILL-011).
  - Done rows offer Preview and Open for each result file (SKILL-012).
  - Clicking a row focuses that role's session; a row whose session cannot be found is not
    clickable; buttons inside a row do not count as a click on the row.
  - Sessions are tied to roles by the saved role-to-session mapping, falling back to AI and launch
    order without using one session twice.
  - Each role's session is polled for its live state at an interval.
Acceptance:
  - [ ] A role writes its marker while its pane still shows activity → the row shows done.
  - [ ] A role has worked three minutes → the row shows working, 3 minutes.
  - [ ] A Claude seat asks to sign in → the row shows the sign-in hint, and Open AI connections
        opens the AI connection settings.
Compat: —
Source: D-15-010

### SKILL-011 · Rescue a stuck kit role: move it, sign in, or restart
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: sees a role stopped by a usage limit, a sign-in problem or an exit, and uses the action
  on its row.
User sees: a row stopped by a limit offers Move to plus another connected AI's name; a sign-in row
  offers a sign-in action; an exited row offers Restart. The role starts again in a new session and
  the row follows it.
Rules: Move to is hidden when no other AI is connected; moving or restarting launches one seat for
  that role on the chosen AI and records it as the role's session; the sign-in action opens the AI
  connection settings; if settings cannot be read, Move and Restart start nothing.
Acceptance:
  - [ ] A Claude seat hits its limit with Codex connected → Move to Codex starts one Codex session
        for the role and the row follows it.
  - [ ] Only one AI connected and it hits its limit → no Move to button.
  - [ ] A seat exits with no reason → Restart starts it again on the same AI.
Compat: —
Source: D-15-011

### SKILL-012 · Preview or open a kit's result files
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks Preview or Open beside a file of a role that is done.
User sees: Preview shows the file inside Kolux next to the AI's session; Open passes it to the
  system's default app.
Rules: HTML results preview in the built-in browser pane, Markdown in the rendered Markdown preview,
  CSV and anything else in a read-only editor tab; a preview opens beside the AI's tab and never
  replaces it, reusing a split that is already there; Collect results shows a toast when it works
  and a friendly toast when it fails.
Acceptance:
  - [ ] Preview an HTML report → it opens in a browser pane split beside the role's session.
  - [ ] Preview a CSV → a read-only editor tab where typing changes nothing.
  - [ ] Preview twice → the same split is used again.
Compat: —
Source: D-15-012

### SKILL-013 · Collect a kit's results into one dated folder with a summary page
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: clicks Collect results.
User sees: a new folder inside the results folder, named after the kit with the date and time,
  holding a copy of every result file, a README saying which role and which AI made each file, and
  one Results page that shows it all together.
Rules:
  - The folder name is the kit title, a dash, then the date and a 12-hour time with no colons (noon
    and midnight read as 12).
  - Only declared files are copied; missing ones are listed; originals are never touched.
  - The README closes with an audit section giving each file's SHA-256 hash.
  - The Results page stands alone: Markdown is rendered with any raw HTML escaped and with
    javascript links or images taken out; files that are not Markdown are linked, not embedded.
  - The run's history entry is marked as collected.
  - A declared file that is a symbolic link counts as missing; any path that leaves the results
    folder (parent-folder steps, absolute or drive paths, a sibling folder with a look-alike name,
    or a link anywhere along the way) is refused.
Acceptance:
  - [ ] Collect once every role is done → a dated folder with every result, a README with hashes,
        and a Results page that opens offline.
  - [ ] A Markdown result that contains a script tag → the Results page shows it as plain text.
  - [ ] A declared file swapped for a link to a file elsewhere → reported missing and not copied.
Compat: the collected folder sits inside the project's results folder and is named with the kit
  title, a dash, then the short month name, day, year and a 12-hour time written with a dot where
  the colon would be, followed by AM or PM; it holds the copied files, a README and a single HTML
  results page.
Source: D-15-013

### SKILL-014 · Kit run record and recent kit runs
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: comes back to the kit gallery after running kits.
User sees: a list of recent kit runs naming each kit and its folder, with Open results and Open
  project.
Rules:
  - The list is hidden while there are no runs.
  - Open results opens the collected folder or, if nothing has been collected, the results folder
    the kit is writing into.
  - Open project switches to the matching workspace, or shows an error when no registered project
    matches the folder.
  - Each project keeps a run record in its results folder; a record over 256 KB, or one that cannot
    be parsed, is ignored.
  - History is kept per folder and across all projects; each list keeps the newest 50, newest
    first, and the same folder, kit and start time is stored only once.
Acceptance:
  - [ ] No runs yet → no recent runs section.
  - [ ] Run 51 kits → the list holds the 50 newest.
  - [ ] Remove the project from Kolux, then click Open project → an error message, not a crash.
Compat: each project keeps a small hidden run-record file in its results folder; the history
  across projects lives in the app's own data folder.
Source: D-15-014

### SKILL-015 · Kits run only in local projects or the samples folder
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: tries to use a kit in a remote workspace or in some arbitrary folder.
User sees: remote workspaces offer no kits; kit actions aimed at a folder that is neither a
  registered local project nor inside the samples folder are refused.
Rules: remote, SSH and remote-runtime workspaces are left out of kits; kit actions accept only
  absolute paths to existing folders that are registered local projects or sit under the samples
  folder in home; relative paths, missing paths, files, SSH projects and unknown kit ids are turned
  away.
Acceptance:
  - [ ] Ask to record a kit run for a folder that is not a project → refused.
  - [ ] Open a remote workspace → no kit entry point appears.
Compat: —
Source: D-15-015

### SKILL-022 · Delete skills safely from the Skills page
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: picks Delete skills, chooses skills, and confirms.
User sees: a selection mode with Select all eligible, Clear and Exit selection; a confirmation
  that sums up what will go and what is blocked; then an outcome for each skill.
Rules:
  - Bundled and plugin skills cannot be chosen, and select-all counts only rows that can be.
  - Two skills sharing a name can still be selected one by one; choices that disappear or become
    ineligible after a rescan are dropped.
  - The confirmation counts the folders and links to be removed across all roots, names the
    place the content remains if only a link is removed, lists blocked items with their reasons, warns that this
    cannot be undone, and styles its confirm button as destructive.
  - Blocked reasons: bundled (it would come back), put there by a plugin (remove the plugin
    instead), outside Kolux's skill folders, no longer on disk, changed since the list loaded
    (refresh first).
  - Outcomes per skill: deleted; skipped; busy because another skill operation is under way; partly
    removed with hidden staged files left over; failed with nothing changed.
  - Removing a link never removes what it points to.
  - Delete shares one lock with skill installs and updates; a lock left behind because releasing it
    failed is taken back, so skill operations never stay stuck.
  - One delete request covers between 1 and 512 skills.
  - A skill in a project stored in WSL is listed but cannot be deleted from Kolux ("delete it from
    WSL"); nothing runs inside a distribution (OD-12, DT-C94).
Acceptance:
  - [ ] Select a home skill and a bundled one → the confirmation lists the bundled one as blocked;
        confirming removes only the home skill.
  - [ ] Change a selected skill on disk before confirming → it is reported as changed and left
        alone.
  - [ ] Delete a skill that is a link to another folder → the link is gone and the target folder
        remains.
Compat: —
Source: D-15-022

### SKILL-024 · Nudge when an installed Kolux skill falls behind
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs a Kolux version newer than the Kolux skills installed for their AIs.
User sees: a notice that one of the installed Kolux skills is out of date, with an Update skill(s)
  button that opens the update dialog.
Rules: the notice stays until the user acts on it; dismissing it remembers the exact skill location
  and revision, so it returns only when something new falls behind, and it never repeats within one
  session; it is withdrawn when the skills are fixed, when its data goes stale, or when the check
  stops being available; copies inside a project play no part in what was dismissed; it waits for
  settings to load before deciding to show; it shows only when at least one stale copy can really be
  updated.
Acceptance:
  - [ ] Install an older orchestration skill and start Kolux → the notice appears and stays.
  - [ ] Dismiss it and restart → it stays away until another skill revision falls behind.
  - [ ] Update the skill some other way → the notice is withdrawn.
Compat: —
Source: D-15-024

### SKILL-026 · Update stale Kolux skills in the background
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: opens the update dialog from the notice or the freshness pill and presses Update.
User sees: a dialog listing the skills that can be updated, a progress bar with no fixed end while
  the work runs in the background, then an outcome per skill with Show log, Retry for failures,
  Re-check and Done.
Rules:
  - Only official copies recorded in the skills installer's lock file qualify; a copy changed
    locally is kept and never removed.
  - Line-ending differences (CRLF against LF) and files the operating system drops beside others
    do not count as changes.
  - Every copy carries a location chip: current, newer, unrecognised, inaccessible, duplicate,
    external link, broken link, read only, inside a repo, plugin cache.
  - A skipped skill shows its reason inline, plus a reinstall command that names the skill, ready to
    run.
  - When plugin caches were only partly covered, the dialog says so.
  - The update runs with no terminal window and carries on if the dialog is closed.
  - Stop shows a stopping state and ends the whole process tree; a run that never finishes can
    always be escaped.
  - Failures are decided by scanning again: a clean rescan counts as success even when the updater
    exited with an error code.
  - Show log prints the updater's output exactly, with colour codes stripped.
  - Skill names holding shell syntax are refused, and a second update cannot start while one runs.
  - It works when Kolux is installed in a folder whose path has spaces and brackets.
  - Skills are grouped as update available or cannot update. A skill an update cannot fix (an
    edited or unreadable copy) still gets a row so Details can explain why; a copy newer than this
    build, a copy owned by a plugin, or a finding that exists only inside a project adds no row; for
    a blocked skill the location causing the block is marked, not the main copy.
  - An update is offered only when the updater can really change the skill: if the updater's own
    record already names a revision other than what sits on disk, it would report up to date and
    do nothing, so that skill is not offered; unclear cases stay eligible.
  - A copy whose content matches the updater's record counts as updated even when Kolux does not
    recognise it as an official release.
  - Links, hard links and special files inside a skill never count as matching an official copy.
  - If the updater cannot start, the user sees why it could not start.
  - When every copy is current, the dialog shows an up-to-date state.
Acceptance:
  - [ ] Press Update and close the dialog → the update completes and the status bar reports it.
  - [ ] Press Stop during a run → the dialog shows stopping, then stopped, and no stray processes
        remain.
  - [ ] A locally changed copy → listed as skipped with a reason and a reinstall command; its files
        are untouched.
Compat: runs the community skills installer's update command through Node's package runner with no
  prompts, passing the skill names in sorted order, a yes flag and global scope.
Source: D-15-026

### SKILL-028 · Install a Kolux skill for your AIs from inside Kolux
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: where a feature needs a skill (the CLI settings, the orchestration pane or its floating
  dialog, browser use), clicks Install or Update.
User sees: a setup panel saying whether the skill is installed; Install opens a small terminal with
  the install command already typed, waiting for Enter. Copy command and Re-check are offered too.
Rules:
  - States: installed, not installed, checking, setup failed, plus a preparing state while the
    terminal is being set up.
  - Install aims at every detected AI and the shared skills folder, translated into the agent names
    the skills installer uses.
  - If the `kolux` CLI is installed but missing from PATH, its installer runs first; that step is
    skipped when the Windows PATH cannot be read.
  - On Windows, a default terminal of WSL or Git Bash is swapped for PowerShell during setup.
  - Copy command confirms with a short message.
  - The orchestration pane also carries the freshness pill (SKILL-025).
  - The same panel also shows up inside cut features (computer use, Linear, ephemeral VMs, mobile
    emulator).
  - An AI that already reads the shared skills folder gets no copy of its own (Codex at global
    scope); a custom configuration folder an AI uses is respected; two AIs cannot claim the same
    folder unless it is the shared one; AIs Kolux cannot place skills for are skipped.
  - The copied command stays interactive; only an unattended run adds the yes flag and explicit
    targets, and an unattended run with no target, or with a target the installer would discard, is
    refused. Install repeats the skill flag once per name; blank names in an update are rejected.
Acceptance:
  - [ ] Click Install for the orchestration skill → a terminal opens with the install command typed
        and not yet run.
  - [ ] Press Enter, then Re-check → the status reads installed.
  - [ ] The `kolux` CLI not on PATH → the CLI installer runs before the skill command.
Compat: install calls the community skills installer's add command against the Kolux repository,
  with the skill flag once per skill, the agent flag listing the detected AIs plus the shared
  folder, a yes flag, and a global flag for a global install.
Source: D-15-028

### SKILL-029 · Kolux's own skills, matched to the app version
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: installs or reads one of the skills that ship with Kolux.
User sees: skills bundled inside Kolux that teach AIs how to use it: the guide to the `kolux` CLI,
  orchestration, a security-review guide, and a guide to staying sceptical of prompt injection;
  each comes with a short guide, a full guide and named reference pages.
Rules: the kept skills are kolux-cli, orchestration, koluxsecurity and koluxward; skills for cut
  features have their own card (SKILL-032); the guides always match the installed Kolux version;
  the Linear skill exists under a current and a legacy name, and the app reports which one is
  installed (cut along with Linear).
Acceptance:
  - [ ] `kolux skills list` → the kept skills appear, each with a one-line description.
  - [ ] Each kept skill offers a compact guide, a full guide and its listed references.
Compat: skill names kolux-cli, orchestration, koluxsecurity, koluxward.
Source: D-15-029

### SKILL-030 · The skills list and get commands print the bundled guides
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux skills list`, or `kolux skills get` with a topic.
User sees: the bundled skill topics with one-line descriptions, or a guide printed as Markdown:
  compact by default, full on request, or one named reference.
Rules: both work offline from the guides bundled with the CLI; a reference can be named on its own
  or by its path; a references flag lists the reference names; `kolux skills show` is another name
  for get; both accept a JSON output flag.
Acceptance:
  - [ ] `kolux skills get orchestration --full` → the whole guide prints as Markdown.
  - [ ] `kolux skills get kolux-cli --reference browser` → that reference prints.
  - [ ] `kolux skills list --json` → a machine-readable list.
Compat: `kolux skills list` takes `--json`; `kolux skills get` takes a topic, then either `--full`
  or `--reference` with a name, plus `--references` and `--json`; `kolux skills show` is its alias.
Source: D-15-030

### SKILL-031 · The skills install and update commands
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux skills install` or `kolux skills update` in a terminal.
User sees: the bundled skills installed or refreshed for the user's AIs through the community
  skills installer.
Rules: install is global unless a local flag puts it in the project; it aims at the detected AIs
  plus the shared folder, the universal agent value aims only at the shared folder, and an agent has
  to be named when none is detected; with neither a skill nor the all flag it prints the names on
  offer, and giving both is an error; a dry-run flag prints the command instead of running it; JSON
  output is refused on a real run; a missing npx or Node gives a plain error; update takes the same
  flags except agent, and refreshes only skills that are already installed.
Acceptance:
  - [ ] `kolux skills install --skill orchestration --dry-run` → the install command is printed and
        nothing is installed.
  - [ ] `kolux skills install --all --skill orchestration` → an error.
  - [ ] `kolux skills install --json` on a real run → refused.
Compat: `kolux skills install` takes `--skill` with a name (may be given more than once), `--all`,
  `--agent` with one name or a comma-separated list, `--local`, `--dry-run` and `--json`;
  `kolux skills update` takes the same flags apart from `--agent`.
Source: D-15-031

### SKILL-017 · Skills page lists every skill the AIs can see
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the Skills page, searches, and filters by AI or by where a skill comes from.
User sees: a full page of skills with name, description and date, a search box, a Filter by agent
  menu, source chips with counts, Refresh, Clear filters, and a Skill folders popover showing which
  folders were scanned.
Rules:
  - The header holds Close (Escape), the title, and a more-actions menu containing Delete skills.
  - The agent filter offers all agents, each AI, and the shared skills folder.
  - Source chips are home, workspace, bundled and plugin, each with a count.
  - Search refuses a pasted query that is far too long.
  - A row lacking a description or a date shows a plain placeholder in its place.
  - The folders popover marks each root as not found, remote repo not scanned, or not scanned; a
    skill found via a link is counted once for each root it was found from.
  - States: scanning; no matches (with Clear filters); no skills found (with Refresh); scan failed
    (with Retry).
  - Escape closes the page but never takes Escape away from a focused input.
  - Long paths are shortened inside the row and never widen the page.
  - Closing the page goes back to whichever view was open before.
Acceptance:
  - [ ] Open Skills with skills in the home folder and in the repo → both show, with correct source
        counts.
  - [ ] Filter by Codex → only skills Codex can see remain; Clear filters brings them all back.
  - [ ] A scan fails → a failure state with Retry; Retry scans again.
Compat: —
Source: D-15-017

### SKILL-018 · Sidebar Skills button, off by default
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on the Skills button, then uses it to open the Skills page, or right-clicks it to
  hide it.
User sees: a Skills entry in the sidebar that opens the Skills page; its right-click menu can hide
  it.
Rules: hidden on a fresh install; the show or hide switch lived in the Skills settings section,
  which is cut (SKILL-019), while hiding by right-click stays on the button; at 0.15.0 this button
  is the only way into the Skills page, so the rebuild must keep some reachable way to turn it on.
Acceptance:
  - [ ] Fresh install → no Skills button in the sidebar.
  - [ ] Turn it on, right-click it, choose hide → the button disappears and the setting is off.
Compat: —
Source: D-15-018

### SKILL-021 · Where Kolux finds skills
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the Skills page with skills installed for different AIs in different places.
User sees: skills from the home folder, the current repo, each AI's own skills folder, the shared
  skills folder, enabled Claude plugins and Codex plugin caches, each with its name and description.
Rules:
  - A skill is a folder holding the standard skill file that agent CLIs read; its name and
    description come from that file's front matter, or failing that from its first heading and
    first paragraph.
  - AI roots: Claude, Codex, Grok, Hermes (respecting its home-folder variable and, on Windows, the
    local app-data folder), the shared cross-agent skills folder, and shared-agent links inside
    worktrees.
  - Only Claude plugins enabled for the project add skills, using the plugin version in effect.
  - Codex plugin caches are scanned within a limit, and partial coverage is reported rather than
    hidden.
  - Links are followed without looping and only to a limited depth.
  - A project stored in WSL is scanned through its `\\wsl.localhost\` path like any folder;
    its names keep their letter case; distributions' own home folders are not listed and nothing runs
    inside one (OD-12, DT-C94).
  - Repeated scans are merged and cached; a scan target that hangs becomes an error the user can
    retry.
  - Refresh forces a new scan, ignoring cached and in-flight results.
  - An AI home-folder override that is missing or unsafe is ignored.
  - On Windows, Hermes skills are found in the local app-data folder and, for older installs, in
    the hidden folder in home; when both exist the app-data folder wins.
  - When the workspace folder is the home folder, it is scanned both as home and as a repo.
  - A root whose scan fails partway is reported as an error, never as a shorter list, so a slow
    folder cannot make skills look deleted.
Acceptance:
  - [ ] A skill file with no front matter → its first heading becomes the name.
  - [ ] A link loop inside a skills folder → the scan completes and lists each skill once.
  - [ ] A disabled Claude plugin's skills → not shown.
Compat: reads skill folders in the standard agent-skill format from each AI's skills folder and
  from the shared cross-agent skills folder in the home folder.
Source: D-15-021

### SKILL-016 · Kits tick off first-run milestones and carry a tour anchor
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: launches a first kit, then opens or collects its results.
User sees: the newcomer checklist ticks off launching a first kit and seeing first results; a
  contextual tour can point at the kit results strip.
Rules: a launch records the first-kit milestone; Open results or Collect results records the
  first-results milestone; the results strip offers an anchor the guided tour can highlight; the
  checklist itself is carded in area 16.
Acceptance:
  - [ ] Launch any kit → the first-kit item on the checklist is ticked.
  - [ ] Click Open results → the first-results item is ticked.
Compat: —
Source: D-15-016

### SKILL-023 · An interrupted skill delete is undone or completed on restart
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or it crashes, while skills are being deleted, then opens it again.
User sees: the skills end up either fully gone or fully back; nothing is left half-removed.
Rules: a delete first renames each item aside, keeps a journal, and rolls back on failure; at
  startup an unfinished journal is checked and the transaction recovered; install receipts for
  deleted skills go with them; on Windows a rename blocked by another process is tried again; items
  set aside are hidden from the skills list.
Acceptance:
  - [ ] Kill the app after items are set aside but before the delete completes → on restart the
        skills are back.
  - [ ] Briefly lock a skill file on Windows → the delete retries and succeeds.
Compat: —
Source: D-15-023

### SKILL-025 · Skill freshness pill
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: looks at a Kolux skill's setup panel, for example in the orchestration pane.
User sees: a small status pill: update available, review the skill, up to date, installed (before
  the inventory has loaded), checking, check failed, or a details link.
Rules: a copy changed locally shows review, not update; the pill opens the details of the update
  dialog.
Acceptance:
  - [ ] A stale skill → the pill offers an update.
  - [ ] The inventory check fails → the pill reports that the check failed.
Compat: —
Source: D-15-025

### SKILL-027 · Status bar shows a running skill update
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: starts a skill update and closes the dialog.
User sees: a status-bar item reading updating, updated, failed or stopping; clicking it reopens the
  update details.
Rules: the item shows only while an update runs or has just reported; a success clears itself after
  about 4 seconds, but not while the user is reading it in the update dialog; a failure stays until
  clicked; area 05 lists this status-bar item as well.
Acceptance:
  - [ ] Start an update and close the dialog → the item shows updating, then the outcome; clicking
        it reopens the dialog.
  - [ ] A successful update → the item clears after about 4 seconds; a failed one stays until
        clicked.
Compat: —
Source: D-15-027

### SKILL-020 · Skill row actions and skill details
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the actions on a skill row or opens its details.
User sees: row actions View details, Reveal file, Copy path and Delete; a details dialog showing
  which AIs see the skill, when it was last updated, and its path with Copy, Reveal and Delete.
Rules: Copy path confirms with a brief toast; Reveal file opens the system file manager at the
  skill file; Delete from a row or from the dialog goes through the same confirmation as bulk
  delete (SKILL-022).
Acceptance:
  - [ ] Click Copy path → the clipboard holds the skill file's path and a toast confirms it.
  - [ ] Open details → the dialog lists the AIs that can use the skill.
Compat: —
Source: D-15-020

### SKILL-034 · Install a shared skill bundle with a choice per clash
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: would install a packaged bundle of skills from a file, deciding for each clashing name
  whether to keep the local copy.
User sees: nothing at 0.15.0: the install machinery still exists in the old app, but no screen or
  command reaches it.
Rules: an install named the bundle by checksum and size, the skills picked from it, whether they go
  global or into the project, and for each clash whether to keep the local copy or replace it; it is
  what remains of artifact and skill sharing, hidden 2026-09-28 and removed 2026-10-05 (area 21).
Acceptance:
  - [ ] Default: no screen and no `kolux` command offers to install a skill bundle.
  - [ ] If revived: a bundle with one clashing name asks keep or replace for that skill only, and
        the answer decides which copy remains.
Compat: —
Decision: H: default skip
Source: D-15-034

### SKILL-019 · Skills settings section
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the Skills section in Settings.
User sees: choices for how the Skills page appears, mainly whether the sidebar Skills button shows.
Rules: owner cut on 2026-10-05; Skills keeps its own page but loses its settings section.
Acceptance:
  - [ ] Settings has no Skills section.
  - [ ] The Skills page still opens from its sidebar button (SKILL-018).
Compat: —
Decision: default cut: the table 1b settings cut removes the Skills section; the Skills page stays.
  Revive via DECISIONS.md.
Source: D-15-019

### SKILL-032 · Bundled skills for cut features
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: installs the skill for computer use, the iOS or Android emulator, Linear tickets, or
  per-workspace environment recipes.
User sees: guides that teach AIs to drive those features.
Rules: six skills in all: computer use, the iOS emulator, the Android emulator, Linear (under a
  current and a legacy name) and per-workspace environment recipes; each follows its feature, so
  computer use, Linear and the emulators are cut and environment recipes go with area 18.
Acceptance:
  - [ ] `kolux skills list` shows only the kept skills (SKILL-029).
  - [ ] `kolux skills install --all` installs none of the cut-feature skills.
Compat: —
Decision: default cut: the features these skills drive are cut (computer use, Linear, emulators,
  environment recipes). Revive via DECISIONS.md.
Source: D-15-032

### SKILL-033 · Skills on remote hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the Skills page while connected to a remote host.
User sees: the remote machine's skills, which can be deleted there, in place of the local ones.
Rules: delete was sent to the remote only where its runtime supported it.
Acceptance:
  - [ ] The Skills page lists only skills reachable from this computer (a project stored in WSL through its share path, SKILL-021).
  - [ ] No remote-host choice appears on the Skills page.
Compat: —
Decision: default cut: remote hosts are dropped with area 18. Revive via DECISIONS.md.
Source: D-15-033

### SKILL-037 · Plugins settings: install, enable, consent to and remove plugins
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the Plugins section in Settings (experimental, desktop only) and installs a plugin
  from a local folder or a git URL.
User sees: a list of plugins with consent prompts for what each may do, switches to turn them on
  and off, and removal.
Rules: the whole plugin system sat behind an experimental switch that was off by default; git
  installs pin a ref, take HTTPS or SSH, and refuse URLs that carry credentials; consent is
  fingerprinted, so a plugin asks again when what it requests changes; bundled plugins cannot be
  removed; the old app also accepted plugin descriptions under the upstream app's branded name, an
  identity problem to avoid if plugins ever return.
Acceptance:
  - [ ] Settings has no Plugins section.
  - [ ] No screen or command installs a plugin.
Compat: —
Decision: default cut: the table 1b settings cut removes the plugins section and the plugin
  runtime. Revive via DECISIONS.md.
Source: D-15-037

### SKILL-038 · Plugin marketplace
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browses a marketplace of plugins and installs one.
User sees: an official source added by default with an Official badge, an offline snapshot, and
  support for private git marketplaces.
Rules: only plugins from the canonical organisation earn the Official badge.
Acceptance:
  - [ ] No marketplace screen or marketplace source list exists.
  - [ ] The app makes no marketplace network request.
Compat: —
Decision: default cut: the marketplace goes with the plugins settings section. Revive via
  DECISIONS.md.
Source: D-15-038

### SKILL-039 · Plugin runtime: workers, panels, commands and keybindings
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: uses an installed plugin's panel, command or shortcut.
User sees: plugin panels in the right sidebar, plugin commands with their own keybindings, and
  plugin code running in background worker processes.
Rules: workers restart with growing back-off (0.5 s, 2 s, 5 s) and idle ones are shut down; panels
  are sandboxed and rate-limited; keybinding clashes are reported and the user can override them.
Acceptance:
  - [ ] The right sidebar shows only built-in panels.
  - [ ] The app starts no plugin worker processes.
Compat: —
Decision: default cut: the plugin runtime goes with the plugins settings section. Revive via
  DECISIONS.md.
Source: D-15-039

### SKILL-040 · Plugin content packs: language packs, VM recipes, launch packs
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: installs a plugin that adds a language, a VM recipe or launch content.
User sees: extra interface languages, VM environment recipes and launch presets from plugins; a
  developer watch mode reloads local plugins when they change.
Rules: plugin loading had a budget of about 50 ms at the 95th percentile with 20 packs.
Acceptance:
  - [ ] No content pack can be installed.
  - [ ] No VM recipe or plugin-supplied launch preset appears anywhere.
Compat: —
Decision: default cut: content packs go with the plugin runtime, and VM recipes also go with
  area 18. Revive via DECISIONS.md.
Source: D-15-040

### SKILL-041 · Plugin safety: secrets, storage caps, audit log, remote revocation
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: runs plugins that keep data or secrets.
User sees: plugins hold secrets encrypted and data within storage caps, their actions are audited,
  and a kill list published from afar can revoke a plugin.
Rules: a kill list dated too far into the future is rejected.
Acceptance:
  - [ ] No plugin secret store or plugin audit log exists.
  - [ ] The app fetches no plugin kill list.
Compat: —
Decision: default cut: the plugin safety machinery goes with the plugin runtime. Revive via
  DECISIONS.md.
Source: D-15-041

## Dropped by default (tier D)

- SKILL-019 · Skills settings section — table 1b removes the section; the Skills page stays.
- SKILL-032 · Bundled skills for cut features — computer use, Linear, the emulators and environment
  recipes are all cut, so their skills go too.
- SKILL-033 · Skills on remote hosts — remote hosts are dropped with area 18.
- SKILL-037 · Plugins settings: install, enable, consent to and remove plugins — table 1b removes
  the plugins section and the runtime behind it.
- SKILL-038 · Plugin marketplace — goes with the plugins section.
- SKILL-039 · Plugin runtime: workers, panels, commands and keybindings — goes with the plugins
  section.
- SKILL-040 · Plugin content packs — go with the plugin runtime; VM recipes also go with area 18.
- SKILL-041 · Plugin safety machinery — goes with the plugin runtime.

## Hidden or retired (tier H)

- SKILL-034 · Install a shared skill bundle with a choice per clash · removed 2026-10-05 (hidden
  2026-09-28) · default skip
