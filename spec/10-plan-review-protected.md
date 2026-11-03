# 10 · Plan review & protected actions

This area holds two safety nets that sit between an agent and the user's work, plus the trust and
secret-handling rules around them. Plan review: when Claude Code has finished planning and asks to
leave plan mode, a button in the pane header opens a side sheet where the user reads the plan in
sections, comments on any section or writes an overall note, and then either approves the plan or
sends it back with the comments attached. Protected actions: before Claude Code runs a shell command
that matches a guarded pattern (force-pushing main, discarding uncommitted work, dropping database
tables, changing live Stripe data, applying infrastructure, deploying to production, recursively
deleting folders outside the worktree), Kolux makes Claude stop and ask the user first; the rules,
per-project overrides, custom patterns and a log of recent attempts live in the Protected actions
section of the Safety settings page. Around these sit masking of secrets in logged commands,
pre-marking new worktrees as trusted so agents do not stall on a trust menu, asking before a
repository's shared scripts run, keyring-sealed secrets, and the guards against leaking credentials
to network shares or launching programs from a link. The weaknesses found by the 2026-10-04 security
audit, fixed on 2026-10-06, appear here as acceptance checks that the rebuild must pass from its
first version. SAFE-025 describes the same repository-script prompt as STAT-056 in area 04; build it
once.

Tier counts: P0 16 · P1 9 · P2 2 · H 1 · X 0 · D 2
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 07 Accounts, sign-in & keys · 08 Orchestration · 09 Automations · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 14 Native chat · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations

## Cards

### SAFE-023 · New worktrees are pre-trusted so an agent's first prompt is not lost
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: launches Claude Code, Codex, Cursor or Copilot in a freshly made worktree with a starting
  prompt.
User sees: the agent goes straight to work on the prompt; it never halts on its own folder-trust
  menu, which would otherwise swallow the pasted prompt.
Rules: before launch, Kolux records the folder as trusted in each agent's own configuration
  (Cursor's per-project trust marker, Copilot's list of trusted folders, a project entry in the
  Codex home that Kolux manages, and Claude's accepted-trust setting for that project); writing the
  same trust again changes nothing, leaves every other setting and project as it was, and never adds
  a duplicate; a Copilot configuration that cannot be parsed is left untouched; Codex writes happen
  one after another, never at the same time; a linked worktree is trusted through the root of its
  main repository, and tampered git metadata inside the worktree can never extend trust to some
  other folder; Claude's project entries always use forward slashes and the folder's real letter
  case on disk, because Claude ignores an entry written with backslashes; a folder that is already
  trusted is reported as done at once.
  (Kolux RS, T-017-c, DT-C17: Claude Code and Codex only. Cursor and Copilot are not pre-trusted:
  neither documents where its trust decision is kept, and Cursor's `--trust` flag is for headless
  runs only; their own trust prompt stays with the user.)
Acceptance:
  - [x] Create a worktree and launch Claude Code with a prompt → no trust menu, and the prompt
        reaches the agent. (cards live; evidence/cards-SAFE-023.txt)
  - [x] Launch again in the same folder → the agent's trust configuration does not change at all. (cards; evidence/cards-SAFE-023.txt)
Compat: the agents' own configuration is their public interface and the rebuild writes the same
  places: Cursor's per-project trust marker, Copilot's trusted-folder list, Codex's project trust
  entry in its configuration, Claude's per-project trust flag in its user configuration.
Source: D-10-023

### SAFE-024 · A batch of Claude worktrees is trusted in one write before any agent starts
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: starts several Claude Code agents together, each in its own new worktree.
User sees: all of them begin cleanly; none halts on a trust menu even though they start at the same
  moment.
Rules: before any agent process starts, Kolux works out every worktree folder the launch will create
  and marks them all trusted in a single configuration write, for at most 12 names per launch; the
  folder paths come from the same rules worktree creation uses, so a name that creation would refuse
  is refused here too; the request is refused when the agent or the project is unknown or missing,
  when the name list is empty or not text, or when the project is a plain folder rather than a
  repository or lives on a remote machine; for agents other than Claude it does nothing; trust marks
  that arrive within roughly a quarter of a second of each other are merged into one write, so one
  Claude process rewriting its configuration cannot wipe out the mark a sibling has just added; the
  step is best effort, and a failure never stops the worktrees from opening.
Acceptance:
  - [x] Start six Claude agents in new worktrees at once → a single configuration write covers all
        six folders, and every agent starts without a trust menu. (cards live; evidence/cards-SAFE-024.txt)
  - [x] Ask to pre-trust 13 names → refused before any folder path is worked out. (cards; evidence/cards-SAFE-024.txt)
Compat: —
Source: D-10-024

### SAFE-001 · Pane header offers a plan-review button while Claude waits for plan approval
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: lets Claude Code work in plan mode until it asks permission to leave plan mode, then
  glances at that pane's header.
User sees: a small icon button for reviewing the plan sits in the pane header for as long as Claude
  is waiting on the exit-plan approval; clicking it opens the review sheet.
Rules: the button appears only while the pane's live status holds a plan-approval prompt that
  carries the plan's text; any other approval, such as permission to run a shell command, never
  shows it; a pane with nothing pending, or an agent build too old to send the plan, shows no
  button; the waiting state itself comes from the agent status hooks (area 04), which count Claude's
  exit-plan tool call as waiting for the user; Claude reports the exit-plan step through both its
  PreToolUse and its PermissionRequest events, each with the whole plan, and either event on its own
  is enough to show the button.
Acceptance:
  - [x] Claude asks to leave plan mode → the review button appears; approve in the terminal instead
        → the button goes away. (cards; evidence/cards-SAFE-001.txt)
  - [x] Claude asks permission for a shell command → no review button. (cards; evidence/cards-SAFE-001.txt)
Compat: Claude Code sends the plan text inside the tool input of its exit-plan tool, on both the
  PreToolUse and the PermissionRequest event.
Source: D-10-001

### SAFE-002 · The review sheet breaks the plan into sections that each take comments
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: opens the review sheet, reads the plan, comments on any section, and may write an overall
  note at the bottom.
User sees: a panel sliding in from the right with the plan shown as formatted markdown, split into
  blocks; each block has its own add-comment control, every comment can be removed, and a free-text
  box for general feedback sits at the foot.
Rules: a blank line starts a new section, except where the empty line falls within a fenced code
  block, which stays in one piece; leading, trailing or repeated blank lines never create an empty
  section; each section knows its first and last line numbers, counted from 1, and comments are
  labelled with that range; a plan that is empty or only whitespace has no sections.
Acceptance:
  - [x] Three paragraphs, one of them containing a fenced block that has an empty line inside →
        exactly three sections, with the fenced block kept whole. (cards; evidence/cards-SAFE-002.txt)
  - [x] Comment on the second section → the comment shows under it and can be deleted. (cards; evidence/cards-SAFE-002.txt)
Compat: —
Source: D-10-002

### SAFE-003 · Approving from the sheet lets Claude carry out the plan
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: clicks Approve in the review sheet.
User sees: the sheet closes and Claude carries on the same way it would had the user chosen allow in
  the terminal; any unsent comments on that plan are thrown away.
Rules: Approve stays clickable for as long as the plan is still pending, with or without comments;
  it answers Claude's terminal prompt with the first choice, which is the allow choice; it wipes the
  saved draft for that pane and plan; in most Claude releases that first choice also accepts later
  file edits automatically, but the button keeps the plain label Approve; if Kolux cannot pass the
  answer on, a note says so and points at the terminal, where the agent still waits.
Acceptance:
  - [x] Open the sheet and click Approve → Claude leaves plan mode and starts the work, and the
        review button is gone. (cards live; evidence/cards-SAFE-003.txt)
  - [x] Write a comment, then click Approve → Approve was clickable, Claude proceeds, and the
        comment is not kept. (cards live; evidence/cards-SAFE-003.txt)
  - [x] An Approve or Deny that Kolux cannot deliver → a note gives the reason and says to answer in the terminal. (tests; evidence/T-684.txt)
Compat: —
Source: D-10-003

### SAFE-004 · Request changes returns the plan to Claude with the user's comments
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: writes one or more section comments or an overall note, then clicks Request changes.
User sees: the button carries a count of the pending comments; clicking it closes the sheet,
  dismisses Claude's plan prompt, and then delivers one message into the pane asking Claude to
  rework the plan and show it again, with each comment beside its line range and a short quote of
  its section, followed by the overall note.
Rules: the button stays disabled until there is at least one comment or a note that is more than
  whitespace; Kolux first dismisses the plan prompt, then waits for the pane to leave the
  plan-approval state before typing the feedback; if the state never changes the feedback goes
  anyway after about 3 seconds, and if the pane had already left the prompt it goes straight away;
  cancelling a pending send is safe whether or not it has gone out yet; the message runs in this
  order: a fixed opening line asking for a revision, then every comment (its line range, a short
  quote, the comment itself), then the overall note with outer whitespace removed; sending wipes the
  saved draft; if the plan prompt has already gone, Request changes says so and sends nothing.
Acceptance:
  - [x] No comments and an empty note → Request changes is disabled. (cards; evidence/cards-SAFE-004.txt)
  - [x] Two comments, then Request changes → Claude gets a single message naming both line ranges
        and comes back with a revised plan. (cards live; evidence/cards-SAFE-004.txt)
  - [ ] A pane whose status never updates → the feedback still arrives after about 3 seconds.
        (cards; evidence/cycle3-SAFE-004.txt)
  - [x] Press Request changes after the agent has moved on from the plan → a note says it is no longer waiting and nothing is typed into the pane. (tests; evidence/T-684.txt)
Compat: —
Source: D-10-004

### SAFE-009 · Claude stops and asks before running a protected shell command
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: runs a Claude Code session in a Kolux pane, and Claude tries a command that matches a
  protected rule.
User sees: Claude halts before running it and shows its own permission prompt, with a reason that
  names the Kolux rule (for example Force-push to main) and explains that the command waits for the
  user and stays blocked if refused; the pane shows the waiting state; allowing once runs the
  command, refusing leaves it unrun.
Rules: only Claude Code is guarded, through its PreToolUse hook, and the Safety page says so
  plainly; OpenClaude shares the managed Claude hook and is guarded too; Codex is not, because its
  hooks can refuse a command but cannot ask; only Claude's Bash and PowerShell tools are inspected,
  and every other tool passes; the agent status hooks must be on, which they are by default; when
  nothing matches, the tool is not a shell, the event is not PreToolUse, or the hook body cannot be
  read, Kolux returns a neutral answer and Claude's usual permission flow carries on (it fails open
  and never blocks by itself); the rule name inside the reason is cut to 120 characters; path-based
  rules treat the pane's worktree folder as the workspace, not merely the current directory, and the
  pane's project decides which per-project rules apply; switching a rule off takes effect on the
  very next command, with no restart.
  (Kolux RS, T-058: the Claude hook script prints Kolux's answer, which the core builds from the
  protected-command check; the master switch and the list of rules switched off are both settings,
  read from the settings file on every command; the proof through a signed-in Claude is T-058-b.)
Acceptance:
  - [x] Claude force-pushes main → Claude's permission prompt shows the Kolux reason; refuse →
        nothing is pushed. (cards live; evidence/cards-SAFE-009.txt)
  - [x] Claude asks for the working-tree status → no prompt. (cards; evidence/cards-SAFE-009.txt)
  - [x] Switch the matching rule off and try again → the command runs with no prompt. (cards; evidence/cards-SAFE-009.txt)
  - [x] Send the hook a garbled body → neutral answer, and Claude carries on. (cards; evidence/cards-SAFE-009.txt)
  - [x] Run Claude in its automatic permission mode, and again with permission checks skipped, then
        force-push main → record whether the ask still appears (never verified at 0.15.0). (cards live; evidence/cards-SAFE-009.txt)
Compat: Claude Code's PreToolUse protocol: the reply is either an empty object, meaning no opinion,
  or a hook-specific output block that names the PreToolUse event, sets the permission decision to
  ask and gives a reason; Kolux reads the tool name (Bash or PowerShell) and the command from the
  tool input, and accepts both form-encoded and raw JSON hook bodies.
Source: D-10-009

### SAFE-010 · Built-in rules protect git history: force-push to main and discarding uncommitted work
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: has Claude run git commands in a worktree.
User sees: a pause before a force-push or a branch deletion aimed at main or master, and before a
  hard reset or a forced clean; normal pushes, force-pushes of feature branches, soft resets and
  dry-run cleans go through untouched.
Rules: force means any force flag, including the lease and mirror variants and short flags bundled
  together, or a refspec that starts with a plus sign; deletion means the delete flag or a refspec
  with an empty source pushed onto main; it asks when the target is main or master, the current
  branch (written as HEAD or as the at-sign shorthand), a shell substitution, or when no refspec is
  given at all, and also for push-all and mirror pushes; git's global options placed before the
  subcommand (changing directory, passing config, pointing at a git directory) are skipped over; the
  discard rule asks for a hard reset or a clean carrying the force flag, but not for a reset without
  hard or a dry-run clean.
  (Kolux RS, T-058: the force-push and discard rules of the protected-command check; a command is
  split on its plain chain operators, the rest of the chain and wrapper handling is the SAFE-014 task.)
Acceptance:
  - [x] git push -f, git push origin :main, and git push --force origin main → each asks. (cards; evidence/cards-SAFE-010.txt)
  - [x] git push -f origin @:main, and git push --force origin @ → each asks. (cards; evidence/cards-SAFE-010.txt)
  - [x] A force-push of a feature branch, git push origin main, and git push origin @ → each runs. (cards; evidence/cards-SAFE-010.txt)
  - [x] git reset --hard and git clean -fdx → ask; git reset --soft HEAD~1 and git clean -n → run. (cards; evidence/cards-SAFE-010.txt)
Compat: —
Source: D-10-010

### SAFE-011 · Built-in rule: pause before dropping or emptying database objects
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: has Claude send destructive SQL through a database client.
User sees: a pause before a drop or truncate handed to a database client, and before the standalone
  drop-database tool; the same words inside a commit message or a text search never ask.
Rules: only database clients count: the Postgres, MySQL, SQLite, SQL Server and Mongo shells, and
  the command-line tools of hosted databases such as Supabase, Prisma, Wrangler, BigQuery, DuckDB
  and the like; destructive means dropping a table, database, schema, view, index, user or role, or
  truncating; the whole command line is inspected, so SQL piped in or supplied through a heredoc is
  still seen; the dedicated drop-database tool always asks.
  (Kolux RS, T-058: the database-drop rule; a Mongo shell command that calls drop, drop-database or
  drop-collection counts as a drop.)
Acceptance:
  - [x] The Postgres client given a drop-table statement on its command line → asks; a truncate
        statement piped into the Postgres client → asks; dropdb on a production database → asks. (cards; evidence/cards-SAFE-011.txt)
  - [x] A commit whose message mentions dropping a table → runs; a text search of the migrations
        folder for the drop-table keyword → runs. (cards; evidence/cards-SAFE-011.txt)
Compat: —
Source: D-10-011

### SAFE-012 · Built-in rules protect live services: Stripe, infrastructure and production deploys
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: has Claude run payment, infrastructure or deployment tools.
User sees: a pause before live Stripe data changes, before infrastructure is applied or torn down,
  and before a production deploy; read-only and preview commands go through untouched.
Rules: Stripe: a live secret key or live restricted key anywhere in the command asks, unless the
  command is a text search; otherwise the Stripe CLI asks when its live flag is present or one of
  its first few words is a changing verb (create, update, delete, cancel, refund, post and similar),
  while listening for events and listing records never ask. Infrastructure: Terraform or OpenTofu
  apply or destroy, Terragrunt apply or destroy (run-all included), Pulumi up, update or destroy,
  and CDK deploy or destroy all ask; plan and init do not. Production deploy: a production marker
  (prod, production, an environment set to prod, or -e production) together with a deployment CLI
  (Vercel, Netlify, Firebase, Wrangler, Fly, Railway, Heroku, gcloud, az and similar) or a deploy
  verb; a deploy without a production marker, and a package install with a production flag, do not
  ask. All three rules are kept deliberately tight so the user does not learn to click allow without
  reading.
  (Kolux RS, T-058: the Stripe, infrastructure and production-deploy rules; a production marker is the word prod or
  production on its own, after a dash, or as the value of a flag or assignment on the command.)
Acceptance:
  - [x] Cancelling a subscription with the Stripe CLI → asks; stripe listen, and listing customers →
        run; a text search of the source folder for the live-key prefix → runs. (cards; evidence/cards-SAFE-012.txt)
  - [x] terraform apply -auto-approve → asks; npx cdk deploy → asks; terraform plan → runs. (cards; evidence/cards-SAFE-012.txt)
  - [x] vercel --prod → asks; a Wrangler deploy with --env production → asks; vercel deploy with no
        production flag → runs; npm install --production → runs. (cards; evidence/cards-SAFE-012.txt)
Compat: —
Source: D-10-012

### SAFE-013 · Built-in rule: pause before a recursive delete that reaches outside the workspace
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: has Claude run a recursive delete in Bash, cmd or PowerShell.
User sees: a pause when the target lies outside the worktree, is the worktree itself or its git
  folder, or cannot be worked out; clearing build output inside the worktree, or scratch folders
  under the temp directory, runs untouched.
Rules: recursive deletes are rm with a recursive flag; rd, rmdir, del and erase with the subtree
  switch, also when switches are run together; and PowerShell's Remove-Item and its aliases with the
  recurse switch or any shortening of it, reading both its path and literal-path arguments. It asks
  when the target is outside the workspace, is the workspace, is its git folder, cannot be known (a
  variable, another user's home, a drive-relative path), or is absent because the names arrive
  through a pipe. Temp locations (TMPDIR, TEMP, /tmp, /var/tmp) never ask unless the path climbs out
  with ..; a wildcard is judged by its folder. A cd, pushd or Set-Location earlier in the same
  command shifts the base for relative paths; a bare cd means home; popd, a bare pushd, or cd into a
  variable leaves the base unknown. With no known workspace, the directory the command began in is
  used instead; with neither known, any relative recursive delete asks. Paths are compared as text
  only and never looked up on disk; Git Bash drive paths are turned into Windows form; comparisons
  on Windows ignore letter case.
  (Kolux RS, T-059-a: the delete rule of the protected-command check; the workspace is Claude's own
  hook cwd, which a Kolux pane makes the worktree folder, DT-C23; a temp root wins over the
  workspace test, so a repository kept under TEMP is not protected from its own deletes.)
Acceptance:
  - [x] rm -rf on the filesystem root, on a folder in the user's documents, on .., on ., on .git, or
        on a path held in a shell variable → each asks. (cards; evidence/cards-SAFE-013.txt)
  - [x] cd to the home variable and then rm -rf build; a bare cd and then rm -rf build; popd and
        then rm -rf build; a find piped through xargs into rm -rf → each asks. (cards; evidence/cards-SAFE-013.txt)
  - [x] Remove-Item with recurse and force on the home folder; a directory listing piped into
        Remove-Item with recurse; rd /s /q on the documents folder → each asks. (cards; evidence/cards-SAFE-013.txt)
  - [x] rm -rf of the dependency and build folders inside the worktree, of everything under a build
        folder, from a package subfolder after a cd into it, or of a scratch folder in /tmp; rd /s
        /q of the dependency folder → each runs. (cards; evidence/cards-SAFE-013.txt)
Compat: —
Source: D-10-013

### SAFE-014 · Protected commands are still caught when wrapped, chained, nested or encoded
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: has Claude run a dangerous command tucked inside a wrapper program, a chain, or another
  shell.
User sees: the same pause as for the bare command, naming the part that matched; harmless commands
  written the same ways still run.
Rules: every program in a chain is inspected (semicolons, ampersands, pipes, and/or operators,
  newlines, grouping), and so are command substitutions and backtick substitutions, up to four
  levels deep; wrapper programs are seen through (sudo, doas, nohup, time, nice, env, xargs,
  timeout, npx, bunx, exec, start and the like, package-runner subcommands, and leading NAME=value
  assignments), their options that take a value are never mistaken for the command, and the timeout
  length is skipped; inner commands are pulled out of POSIX shells given -c, cmd given /c or /k
  (including the doubled-slash form Git Bash needs), PowerShell given -Command or a base64-encoded
  command under any unambiguous shortening of the switch, eval or iex, and wsl exec forms;
  PowerShell switches that take a value (execution policy, window style, working directory, input
  and output format and the like, short aliases included) have that value skipped, and a -File run
  carries no inner command; a command that is only printed as text does not ask. These close the
  2026-10-04 audit findings S1 (PowerShell value switches), S2 (wrapper option values), S3
  (run-together cmd switches and the doubled slash), S4 (bare cd and popd) and the at-sign-for-HEAD
  gap; the rebuild must pass all of them from its first version.
  (Kolux RS, T-059-a: the command splitter of the protected-command check; the inner commands of a
  PowerShell -File script, a shell reading stdin, and the commands find runs through its exec flag
  are not read, and the window title of a start command is skipped only when it is empty quotes.)
Acceptance:
  - [x] bash -c wrapping rm -rf / → asks; rm -rf / inside a $( ) substitution → asks; cmd /c
        wrapping rd /s /q on the Users folder → asks. (cards; evidence/cards-SAFE-014.txt)
  - [x] powershell -ExecutionPolicy Bypass -Command wrapping terraform apply -auto-approve → asks;
        the same with -ep bypass, -WindowStyle Hidden, -of text, or as a base64-encoded command →
        asks. (cards; evidence/cards-SAFE-014.txt)
  - [x] A powershell -File run, then a semicolon, then terraform apply -auto-approve → asks. (cards; evidence/cards-SAFE-014.txt)
  - [x] cmd //c wrapping rd /s /q on the Windows folder → asks; rd /s/q on the Windows folder →
        asks; del /q/s on a file under the Windows folder → asks. (cards; evidence/cards-SAFE-014.txt)
  - [x] sudo -u root, sudo -uroot, nice -n 10, env -u NAME, or timeout 5 placed before rm -rf on a
        system folder → each asks; timeout 30s terraform apply -auto-approve → asks. (cards; evidence/cards-SAFE-014.txt)
  - [x] sudo -u root ls build, timeout 5 ls, nice -n 10 echo hi, powershell -ExecutionPolicy Bypass
        -Command printing hi, rd /s/q build, and echoing the text rm -rf / → each runs. (cards; evidence/cards-SAFE-014.txt)
Compat: —
Source: D-10-014

### SAFE-015 · The Protected actions section on the Safety page
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: opens Settings, then Safety, then Protected actions.
User sees: a short explanation of the feature, a plain statement that only Claude Code is covered, a
  reminder that the agent status hooks must be on, a master switch named Ask before protected
  actions, and one row per rule with its name, sample commands and an on/off switch.
Rules: with the master switch off no rule ever asks, and it is on by default; the seven built-in
  rules appear under plain names: Stripe changes, Force-push to main, Deleting database tables,
  Infrastructure changes, Production deploys, Deleting folders outside the workspace, Throwing away
  uncommitted work; switching a built-in off records it as turned off, and it can be switched back
  on at any time; settings search finds the section; in the rebuild the section sits on the kept
  Safety page.
Acceptance:
  - [x] Switch the force-push rule off → Claude's next force-push of main runs with no prompt;
        switch it on → it asks again. (cards; evidence/cards-SAFE-015.txt)
  - [x] Turn the master switch off → no protected command asks. (cards; evidence/cards-SAFE-015.txt)
Compat: importing settings from the old app must carry over the master switch, the list of
  turned-off built-ins, the custom rules and the per-project overrides.
Source: D-10-015

### SAFE-019 · Secrets inside paused commands are masked before they are kept or shown
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: looks at the recent attempts after Claude tried a command that held a key or a password.
User sees: the command with each secret hidden; Stripe keys keep their prefix and final four
  characters, enough to tell one key from another.
Rules: Stripe live and test secret keys, restricted keys and webhook signing secrets become their
  prefix, four dots and the final four characters; a general masking pass then hides labelled
  name=value secrets, well-known provider keys (Anthropic, OpenAI, xAI, Google, GitHub, AWS, Slack,
  JSON web tokens, PEM key blocks), lines written in the style of an env file, credentials embedded
  in a URL of any scheme, token or password flags followed by a value, and short password flags with
  the value attached; Stripe values that are already masked pass through the second pass untouched;
  the raw key never reaches the attempts list.
Acceptance:
  - [x] A paused command holding a live Stripe key → the list shows only the prefix, four dots and
        the last four characters. (cards; evidence/cards-SAFE-019.txt)
  - [x] A MySQL client with the password stuck to its short flag, a command with a token flag, and a
        Postgres connection URL carrying a user and password → all three are masked. (cards; evidence/cards-SAFE-019.txt)
Compat: —
Source: D-10-019

### SAFE-021 · Paths on other machines are refused before any file access
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: clicks or hovers a link to a path on another computer in a markdown preview or in
  terminal output, or something asks Kolux to open, check or grant access to such a path.
User sees: nothing on the remote machine is opened or checked, and the link does nothing; local
  paths, WSL paths, and shares that hold one of the user's own registered worktrees keep working.
Rules: a host path is any share written with a leading double backslash or double slash, a file URL
  that names a host, the long-path form of a UNC path, a device pipe, or any double-backslash path
  that climbs with .. and so could land on a share; WSL roots and long-path forms of local drives
  count as local; a share inside a registered worktree root stays allowed; the refusal comes before
  any filesystem call, so the operating system never hands the user's credentials to the remote host
  (the NTLM leak); it covers internal links in markdown, OSC 8 terminal links in both plain and file
  style, hover checks on terminal links, checks that a path exists, and granting access to outside
  files; markdown images whose source is a file or host path go through the same text check before
  anything is read; a grant for an outside file covers that exact file only, never a folder, never a
  drive or filesystem root, never a UNC path (audit findings I2 and I5); on POSIX the app's core
  treats a leading double slash as an ordinary local path while link clicks in the interface refuse
  it on every platform, a known difference that errs on the safe side and that the rebuild may make
  consistent.
  (Kolux RS, T-060: the host-path check and its refusal; a leading double slash is refused on
  every platform, in the core as well as the interface, which the card allows; the registered
  roots are the projects and the workspaces folder; terminal and note links are not built yet and
  will call the same functions; no grant flow exists yet, so the exact-file grant rule is T-062's.)
Acceptance:
  - [x] Ctrl-click a terminal link to a double-slash share path, or to a file URL naming another
        host → nothing opens and no connection to that host is tried. (cards; evidence/cards-SAFE-021.txt)
  - [x] A long-path local-drive form that climbs up into a UNC path on a host → treated as a host
        path and refused. (cards; evidence/cards-SAFE-021.txt)
  - [x] A link to a WSL path → opens; a share path inside a registered repository → still checked as
        usual. (cards; evidence/cards-SAFE-021.txt)
  - [x] Grant access to a folder → no file under it is granted. (cards; evidence/cards-SAFE-021.txt)
  - [x] A folder in a repository that is a symbolic link to the home folder → granting it never
        exposes anything beneath it, such as the SSH key folder. (cards; evidence/cards-SAFE-021.txt)
Compat: —
Source: D-10-021

### SAFE-022 · Clicking a link to a program reveals it in its folder instead of running it
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: uses the open-in-another-app click on a file link that points at a script, an installer
  or a shortcut.
User sees: the file's folder opens with the file selected; the file itself never runs.
Rules: around a hundred program and script-like file types count, including unusual Office and
  web-query types such as OneNote, web query and SYLK files; alternate-data-stream suffixes, 8.3
  short names and trailing dots or spaces cannot disguise the type; on POSIX a file with the execute
  permission also counts; colons and tildes in ordinary POSIX file names are not misread (audit
  finding I3); the Windows short-name test also catches ordinary names that happen to look like one,
  for example a text file whose name has a tilde and a digit, and such files are revealed rather
  than opened, which errs on the safe side.
  (Kolux RS, T-060: the program-like and launchable checks and the open-file command; the short-name
  shape is a stem of up to eight characters holding a tilde followed by a digit with an extension
  of up to three; on Linux the reveal opens the folder without selecting the file.)
Acceptance:
  - [x] Shift-click open on a link to a batch file, a JavaScript file, a Windows program or a
        shortcut → its folder is revealed and nothing runs. (cards; evidence/cards-SAFE-022.txt)
  - [x] A name that ends with a program type followed by a stream suffix, or by a trailing dot →
        still treated as a program. (cards; evidence/cards-SAFE-022.txt)
  - [x] A link to a plain text file → opens normally. (cards; evidence/cards-SAFE-022.txt)
Compat: —
Source: D-10-022

### SAFE-005 · Unsent comments are kept when the sheet closes and reopens
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: writes comments, closes the sheet without sending, and reopens it later.
User sees: the same comments and overall note are still there; a fresh plan from Claude opens with
  an empty draft.
Rules: drafts live in memory, one per pane and per exact plan text, so a revised plan gets a new
  draft; drafts are gone after the app restarts; at most 128 drafts are held, and the oldest is
  dropped first once that limit is passed.
Acceptance:
  - [ ] Comment, close, reopen → the comment is still there.
  - [ ] Claude presents a revised plan → the sheet opens with no comments.
Compat: —
Source: D-10-005

### SAFE-006 · A very long plan is cut down in the sheet, with a pointer to the terminal
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the review sheet for a very long plan.
User sees: as much of the plan as fits, plus a notice saying it was cut and that the whole plan is
  in the terminal.
Rules: the status update that carries the plan may be at most 16,000 characters, and the plan is
  trimmed to the longest length that still fits; the prompt's one-line summary is always kept; if
  even an empty plan would not fit, the plan is left out and no review button appears; the notice
  shows only when the plan really was cut.
Acceptance:
  - [ ] A 40,000-character plan → the sheet opens with the cut notice.
  - [ ] A short plan → no notice.
Compat: —
Source: D-10-006

### SAFE-007 · The sheet turns read-only once Claude stops waiting on that plan
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves the sheet open while the plan prompt is answered in the terminal, or while Claude
  moves on.
User sees: a notice that the plan prompt has closed, and both action buttons disabled.
Rules: the sheet keeps comparing its plan with the plan the pane is currently waiting on; if they
  differ, or the pane has no plan pending at all, Approve and Request changes are both disabled;
  a press that still gets through says the agent is no longer waiting on the plan and sends nothing.
Acceptance:
  - [ ] Open the sheet, then approve in the terminal → the notice shows and both buttons are
        disabled.
  - [ ] Open the sheet, then Claude presents a different plan → the open sheet's buttons are
        disabled.
  - [x] Approve or Request changes on a plan the agent has left → a note says nothing was sent. (tests; evidence/T-684.txt)
Compat: —
Source: D-10-007

### SAFE-016 · Users add their own protected rules by prefix, text or regular expression
Tier: P1 · Pushed: 5 · State at 0.15.0: live
User does: in the Protected actions section, types an optional name, picks a match type (command
  starts with, contains text, or regular expression), enters a pattern such as npm publish, and
  clicks Add rule.
User sees: the new rule in the list with a badge for its match type, its pattern, an on/off switch
  and a delete button; a bad pattern shows a plain-language error and nothing is saved.
Rules: starts-with compares the program and its first words, ignoring case; contains compares the
  command in lower case with runs of whitespace squeezed to one space; regular expressions ignore
  case; a pattern is refused when it is empty, longer than 500 characters, not a valid expression,
  has a repeated group that itself repeats, or has three or more overlapping unbounded repeats in a
  row; repeats side by side over character sets that cannot overlap (whitespace then non-whitespace,
  letters then digits) are allowed, and ordinary expressions with one or two neighbouring repeats
  are accepted; a risky expression typed into the settings file by hand is never run, and expression
  matching only ever sees the first 4,096 characters of a command (audit finding S6); a rule with no
  name shows its pattern as the name.
Acceptance:
  - [ ] Add a contains rule for npm publish → when Claude runs npm publish, it asks.
  - [ ] Enter (a+)+ as a regular expression → an error, nothing saved; the same for .*.*.*.*x and
        a*a*a*a*a*b.
  - [ ] Enter an expression matching kubectl followed by delete or drain → accepted, and deleting a
        pod with kubectl asks.
  - [ ] Enter [a-z]+[a-m]+[a-c]+$ → refused; x+y+z+ and an expression for git push followed later by
        --force → accepted.
Compat: —
Source: D-10-016

### SAFE-017 · Protected rules can differ per project, and each scope can be reset
Tier: P1 · Pushed: 5 · State at 0.15.0: live
User does: picks a project in the scope picker of the Protected actions section, switches or adds
  rules there, or clicks Reset to defaults.
User sees: the rules for that project alone; a rule switched off for all projects shows as locked
  off with a short note; a reset asks for confirmation first.
Rules: the scope picker offers all projects or any one registered project; a project's working rules
  are the built-ins, minus those turned off everywhere, minus those turned off for the project, plus
  custom rules made for all projects that are on and not turned off for the project, plus the
  project's own custom rules; broken custom rules (an empty pattern or an unknown match type) are
  quietly ignored; resetting all projects turns every built-in back on and deletes the custom rules
  made for all projects, but leaves per-project settings alone; resetting one project removes only
  its own rules and its list of rules turned off; the reset confirmation is drawn inside the page
  and marked as destructive; a custom rule made for all projects can only be deleted from the
  all-projects scope, and inside a project it can only be switched off there; a project's own custom
  rules are deleted from within that project.
Acceptance:
  - [ ] Switch the production-deploy rule off for project A only → Claude in project A deploys to
        production with no prompt; in project B it asks.
  - [ ] Reset all projects → the custom rules made for all projects disappear, and project A's
        override stays.
Compat: —
Source: D-10-017

### SAFE-018 · A recent-attempts list shows what was paused and how it ended
Tier: P1 · Pushed: 5 · State at 0.15.0: live
User does: scrolls to the recent attempts in the Protected actions section, and may click Clear.
User sees: up to 50 recently paused commands, newest at the top, each with its time, its worktree,
  the masked command and an outcome badge: waiting for the user (amber), allowed once (green), or
  denied and not run (red); an empty state when there are none.
Rules: a paused command starts as waiting; it becomes allowed when that same tool call completes or
  fails, and denied when the turn ends, a new prompt is sent, the session ends, or a newer attempt
  arrives from the same pane; only the newest 50 are kept, and only in memory, so restarting the app
  empties the list; each stored command is capped at 2,000 characters and masked; the list refreshes
  live in every open window.
Acceptance:
  - [ ] Refuse a paused force-push → its row shows the denied badge; allow another → the allowed
        badge.
  - [ ] Cause 55 attempts → 50 rows; click Clear → the empty state.
Compat: —
Source: D-10-018

### SAFE-020 · The installed Claude hook can only make Claude ask, and keeps the settings file private
Tier: P1 · Pushed: 5 · State at 0.15.0: live
User does: runs Claude Code with the Kolux hooks installed, whether Kolux is running, closed,
  crashed or unreachable.
User sees: Claude keeps working normally when Kolux cannot be reached or the event is not a tool
  call; Kolux can only ever make Claude ask, never allow or refuse silently on the user's behalf.
Rules: the hook program Kolux installs writes exactly one JSON object, either the neutral empty
  answer or the protected-action ask answer, and any other reply from Kolux's local listener is
  swapped for the neutral answer (audit finding S5); a missing Kolux environment, events that are
  not tool calls, and listener errors all give the neutral answer; the Windows and POSIX versions
  behave identically; whatever the listener does (unreachable, a server error even with a body
  shaped like a decision, an HTML page, several lines, extra text after the object, or a reply
  slower than the time limit) the hook prints the neutral answer, exits with success and leaves no
  temporary files behind; printing nothing is never allowed, because Claude reads empty output from
  a permission hook as a refusal; when Kolux rewrites the user's Claude settings file to install its
  hooks, the file keeps its owner-only permissions (audit finding S7).
Acceptance:
  - [ ] Make the listener answer with an allow decision → the hook prints the neutral answer
        instead.
  - [ ] Start Claude while Kolux is not running → no hook error, and commands run normally.
  - [ ] Make the Claude settings file owner-only, then reinstall the hooks → its permissions are
        unchanged.
  - [ ] Point the hook at a listener that returns a server error carrying an allow decision, or that
        stalls → neutral answer and exit code 0, on Windows and on POSIX.
Compat: what the installed hook prints is part of Claude Code's PreToolUse protocol: one JSON
  object, either empty or the ask reply described in SAFE-009.
Source: D-10-020

### SAFE-025 · Kolux asks before running a repository's shared kolux.yaml scripts
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: creates or removes a workspace, or launches one tied to an issue, in a repository whose
  committed kolux.yaml defines a script.
User sees: a dialog that shows the script and asks whether to run it (or, when a script approved
  earlier has since changed, whether to run the new version), a checkbox to always trust this
  repository's kolux.yaml, and two buttons, Don't run and Run hooks.
Rules: it covers the shared setup script (run on create), the archive script (run on remove), the
  issue command (run on launch with an issue) and the VM recipe, which goes with area 18; approval
  is remembered for the exact script content through a fingerprint, or for the whole repository when
  always-trust is ticked, and a changed script asks again; the fingerprint uses the platform's
  cryptography and falls back to a predictable hash where that is missing; local overrides that are
  not shared never ask; prompts wait in line and appear one at a time; closing the dialog, or
  another dialog replacing it, counts as Don't run, and later prompts still appear; removing the
  repository, or adding it again, forgets its trust. This is the same prompt as STAT-056 in area 04;
  build it once.
Acceptance:
  - [ ] First workspace in a repository with a setup script → the dialog appears; Don't run → the
        script is skipped.
  - [ ] Approve, then edit the script → the next create asks again, worded for a changed script.
  - [ ] Another dialog opens over the prompt → the script does not run, and the next prompt still
        shows.
Compat: —
Source: D-10-025

### SAFE-026 · Stored secrets stay sealed by the system keyring, with no plain-text fallback
Tier: P1 · Pushed: 5 · State at 0.15.0: live
User does: saves a proxy address, a search session link, a Claude token or a Grok key in Kolux,
  including at a moment when the system keyring is unavailable.
User sees: the value still works after a restart; if the keyring is down, Kolux reports a problem
  with the secret store instead of quietly writing plain text, and a value the user cleared stays
  cleared.
Rules: four secrets are sealed: the HTTP proxy address, the browser search-session link, the Claude
  sign-in token and the Grok API key; while the keyring is unavailable, ciphertext saved earlier
  stays sealed, neither exposed nor overwritten by later saves, and a deliberate clear is honoured
  and does not come back when the keyring returns; a slower write that a newer one overtook can
  never leave old ciphertext behind; a missing secret store is reported as an error; secret values
  are removed from what the interface receives, so sending settings back from the interface can
  never erase them.
Acceptance:
  - [ ] Simulate a keyring outage, clear the Grok key, bring the keyring back → the key stays
        cleared.
  - [ ] Read the settings file on disk → no secret appears in plain text.
Compat: —
Source: D-10-026
Amended 2026-10-12 (DT-A8): off Windows the build still scrambles per ACCT-009 until a keyring backend is chosen; on Windows a save while the store is down fails and writes nothing.

### SAFE-027 · The floating workspace opens only in folders the user picked
Tier: P2 · Pushed: 5 · State at 0.15.0: live-unverified
User does: chooses a folder for the floating workspace terminal through the folder picker.
User sees: the floating terminal opens in that folder; folders set any other way are not trusted.
Rules: only folders chosen in the system folder picker become trusted, and trusted-folder lists sent
  from the interface are ignored; at load, trusted paths are normalised to their canonical form,
  ones that are unreachable for the moment are kept, and blank ones are dropped; an older single
  working-folder setting is moved into the trusted list once, a marker stops it from being added
  again, and a blank old value becomes the home folder.
Acceptance:
  - [ ] Change the trusted list through settings sync → it is unchanged after reload.
  - [ ] Unplug the drive holding a trusted folder and restart → the entry is still listed.
Compat: —
Source: D-10-027

### SAFE-028 · Saved settings come back valid after a restart
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes the notification sound, editor auto-save or terminal theme settings, then
  restarts Kolux.
User sees: the same choices after the restart; values out of range are corrected rather than
  breaking the app.
Rules: a custom notification sound file location is kept, its volume is held to the valid range, and
  a volume that is not a number reverts to the default; editor auto-save on or off and its delay are
  kept; a separate light-mode terminal theme left switched off stays off, and the names of chosen
  terminal themes survive the round trip; an older setting for opening the right sidebar by default
  can still be read. This card most likely belongs with areas 17, 03 and 12.
Acceptance:
  - [ ] Put a sound volume of 5 into the settings file → it loads as the maximum.
  - [ ] Choose a terminal theme and restart → the same theme.
Compat: —
Source: D-10-028

### SAFE-008 · Plan review opened from a native-chat approval card
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: in the native chat view, clicks the review-plan action on an approval card.
User sees: the same review sheet, sharing its drafts with the pane-header button.
Rules: a second way in only; native chat sits behind an experimental switch that is off by default.
Acceptance:
  - [ ] If built: with native chat on, the review action on a plan approval card → the same sheet
        opens with the same draft as the header button.
  - [ ] With native chat off, the default → this second way in does not exist.
Compat: —
Decision: H: default skip
Source: D-10-008

### SAFE-030 · Folder trust and secret recovery for repositories on SSH hosts
Tier: D · Pushed: 2 · State at 0.15.0: dropped
User does: creates a worktree in a repository on an SSH host and launches an agent there.
User sees: the agent's folder already trusted on the remote machine, and remote ownership secrets
  recovered across reconnects.
Rules: worktree creation passes the remote connection along when it pre-marks trust; remote
  ownership secret slots accept an older plain-text value once, after checking it, and drop it if
  that check fails.
Acceptance:
  - [ ] If revived: launch Claude in a new worktree on an SSH host → no trust menu.
  - [ ] If revived: reconnect to the host → the remote ownership secret still works and no plain
        text stays stored.
Compat: —
Decision: default cut: area 18 SSH hosts dropped. Revive via DECISIONS.md.
Source: D-10-030

### SAFE-029 · Protected actions for agents on SSH hosts and in WSL
Tier: D · Pushed: 5 · State at 0.15.0: dropped
User does: runs Claude on a remote host or inside WSL through the Kolux relay.
User sees: the same protected-action pauses, decided on that side by the relay from a copy of the
  rules, with no round trip to the app.
Rules: the app writes a versioned copy of the rules (the global list plus each project's list,
  respecting the master switch) for the relay; if that copy is missing or carries a version the
  relay does not know, no rules apply.
Acceptance:
  - [ ] If revived: Claude on an SSH host force-pushes main → it asks.
  - [ ] If revived: remove the relay's copy of the rules → nothing asks.
Compat: —
Decision: default cut: area 18 remote and WSL hook relay dropped. Revive via DECISIONS.md.
Source: D-10-029

## Dropped by default (tier D)

- SAFE-030 · Folder trust and secret recovery for repositories on SSH hosts · area 18 (SSH hosts)
  dropped by the owner on 2026-10-05.
- SAFE-029 · Protected actions for agents on SSH hosts and in WSL · area 18 (remote and WSL hook
  relay) dropped by the owner on 2026-10-05.

## Hidden or retired (tier H)

- SAFE-008 · Plan review opened from a native-chat approval card · native chat is behind an
  experimental switch, off by default · default skip.
