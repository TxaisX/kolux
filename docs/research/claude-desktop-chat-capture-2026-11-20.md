# Claude desktop chat: how a conversation is rendered

Captured 2026-11-20 from the shipped app, static analysis only. No app was launched, no
traffic captured, no user transcripts opened.

Target: Claude desktop 6.6395.0 (Electron/Squirrel).
Renderer bundle `resources\ion-dist.asar` (216 MB), main bundle `resources\app.asar` (96 MB).

**How I looked.** REA inventoried the `asar`: 6,354 files, 6,337 nodes, 0 unpacked, 0 integrity
contradictions [OBSERVED `ev_a59cae61a46a5dbe681e6800bfb524520700555535f86027bacd3cddc152326c`,
inventory `ev_6e6cf1fc4e70de4e7700f3725ece1cfbb4a453bd2e222ac4a9d1ff31fddb5295`], and parsed one
renderer module as JavaScript
[OBSERVED `ev_f775d935dba56ccaddf3699293bf07017dc7186376e9fb09547621dbeac71e25`]. REA went offline
part-way through, so most claims cite the bundle file they were read from: `OBSERVED · <file>`.
Where a claim rests on a code hook but I could not see the paint, it is INFERRED. Otherwise UNKNOWN.

Reading key: `c6a992d55-1jeRaqUi.css` = design system + Tailwind output (2.1 MB).
`i18n/en-US.json` = every user-facing string (hashed keys, English values).
`c21f11e6d-*.js` = tool-row labels. `c3cbaca16-*.js` = artifact viewer. `c3a41e137-*.js` =
artifact chip. `cac57de41-*.js` = tool-row rendering. `c04a1223c-*.js` = streaming state.

The renderer is the claude.ai web app packaged into Electron; `index.html` is the SPA shell
(`data-theme="claude"`, `data-mode="light|dark|system"`) [OBSERVED · index.html].

## 1. Message anatomy

A conversation is a **transcript of rows**, not a list of bubbles. Hooks:
`[data-testid=transcript-list]`, `[data-transcript-row]`, `[data-turn-key]`, `[data-reply-scope]`
[OBSERVED · c6a992d55-1jeRaqUi.css, c04a1223c-96DiOhoV.js].

Two message components exist, `AssistantMessage` and `UserMessage`
[OBSERVED · c6a992d55-1jeRaqUi.css `[data-cds=AssistantMessage]` / `[data-cds=UserMessage]`].

- Assistant text is **full width** inside a 768 px column (`--transcript-measure: 768px`)
  [OBSERVED · c6a992d55-1jeRaqUi.css].
- A bubble variant exists (`[data-cds=AssistantMessage][data-variant=bubble]`) with a 85 %
  measure and padded radius, and the user message shares those bubble tokens.
  Reading: the user's turn is a right-hand bubble; the assistant's turn is the full column.
  [INFERRED · same file]

A single assistant turn is a vertical stack of block types, all siblings inside the message:

| Block | Component hook | Default state |
|---|---|---|
| Thinking / reasoning | `group/thinking`, `[data-cds=Collapsible]` | collapsed, labelled with elapsed time |
| Prose answer | `[data-cds=Prose]` | open |
| Tool rows | `group/tool`, `[data-cds=TurnStatus]` + `TurnStatusStep` | one line each, collapsed |
| Artifact card | artifact chip / frame | preview shown |
| Question to user | `[data-cds=AskUserQuestion]` | open, interactive |
| Sources / citations | inside prose | open |
| Row actions | `[data-cds=MessageActions]` | hidden until hover or focus |

Thinking copy is a duration label, not a summary: "Thinking…", "Thinking some more…",
"Still thinking…", "Almost done thinking…", then after it finishes "Thought for {seconds}s",
"Thought for {minutes}m {seconds}s", "Thought for {hours}h {minutes}m"
[OBSERVED · i18n/en-US.json]. "Show full thinking" and "Click to collapse" are the controls
[OBSERVED · i18n/en-US.json]. Extended thinking can be toggled per session ("Toggle thinking",
"Thinking summaries will appear from the next response.") [OBSERVED · i18n/en-US.json].

`MessageActions` fades in rather than appearing: `opacity: 0`, revealed on
`.group/message-row:hover` and `:focus-within`, 120 ms in with a 100 ms delay, 60 ms out,
no scale, `transform-origin: top` [OBSERVED · c6a992d55-1jeRaqUi.css].

## 2. Streaming

While a reply is being written:

- The transcript row carries `[data-is-streaming=true]`, and the page adds extra bottom padding
  while it is true [OBSERVED · c6a992d55-1jeRaqUi.css].
- A caret blinks at 1 s linear, opacity 1→0→1, disabled under reduced motion
  (`motion-safe:animate-blink`, `@keyframes blink`) [OBSERVED · c6a992d55-1jeRaqUi.css].
- Text arrives progressively; there is no "typing" fake — the row is the real markdown, re-rendered
  [INFERRED · streaming flag plus prose renderer, same file].
- Thinking uses a shimmer sweep, not a spinner, for long waits (`cds-shimmer-text-shine`,
  `epitaxy-ultrathink-sweep`) [OBSERVED · c6a992d55-1jeRaqUi.css].
- The stop control is `[data-testid=chat-input-stop]` inside the composer, and the app reads
  `transcript-list`, `chat-header` and `chat-input-stop` together when a turn stops
  [OBSERVED · c0005ed47-DFdZgg2h.js].
- Stopping is acknowledged in words: "Claude is stopping", then "Stopped"
  [OBSERVED · i18n/en-US.json]. A stop that loses the race gives "Stop requested. Claude will cancel it."
  [OBSERVED · i18n/en-US.json].

Commit at the end of a turn: the streaming flag clears, the caret goes, thinking collapses to its
duration label, tool rows collapse to one line each, and `MessageActions` becomes hoverable
[INFERRED from the above hooks]. Rows animate in on insert: 120 ms ease-out
[OBSERVED · c6a992d55-1jeRaqUi.css].

## 3. Tool calls

One line per **grouped subject**, not per call. The row model is
`{filePath, fileName, displayName, operationHistory[], latestId, openWith, rowKind, categoryKey}`
[OBSERVED · c21f11e6d-DuZbjtj2.js].

Verb by operation — this is the whole vocabulary [OBSERVED · c21f11e6d-DuZbjtj2.js]:
read→viewed, write→wrote to, edit→edited, create→created, web_search→searched, web_fetch→read,
cli_tool→ran, mcp_tool→used, memory→referenced, fs_detected→updated,
skill_invoked/command_invoked→invoked, project_file→in project, device_commit→saved.

Grouping keys: files group by path, MCP calls group under `mcp://<server>` (one row per server),
all web searches collapse into one `web_search://all` row named "Web search", reading
"{n} searches" [OBSERVED · c21f11e6d-DuZbjtj2.js].

Shape of the collapsed row: an icon, a label, and a chevron, inside a real
`<button aria-expanded>`: `flex items-center gap-1 text-body`, muted text that brightens on hover
[OBSERVED · cac57de41-Bdn5SlRS.js]. Long single-line content is truncated with the full value kept
in `aria-label` [OBSERVED · cac57de41-Bdn5SlRS.js].

Expanded view: a `Collapsible` under the row, inset by `ps-md`, holding the input block labelled
"Tool input" [OBSERVED · i18n/en-US.json]. Long input is clipped with
"Show more of the input · {n} more characters" and "Show full input · {n} more characters"
[OBSERVED · i18n/en-US.json]. Long output is not inlined: "This result is too long to show here.
It's saved in {file}." [OBSERVED · i18n/en-US.json].

Status. Side sessions and MCP rows carry a state chip in caption size: `working`, `starting`,
`queued`, `spawning`, `needs_you`, `start_failed`, `done`, `idle`, `unlinked`
[OBSERVED · cac57de41-Bdn5SlRS.js]. While `working` or `starting` the row title shimmers
[OBSERVED · cac57de41-Bdn5SlRS.js — `ShimmerText` with `active`].

Errors: a warning icon instead of the normal one, the label gets an error text, and the row keeps
the same one-line shape [OBSERVED · cac57de41-Bdn5SlRS.js]. Copy strings: "Tool-result error",
"Error displaying content - Raw result:", "Response exceeded the output limit"
[OBSERVED · i18n/en-US.json].

Diffs are a first-class block: `--diff-widget-bg/fg/border`, `.group/diff`, a `diff-file`
container, and git colours `--cds-text-git-added #1e9e3c`, `--cds-text-git-removed #cd2054`,
`--cds-bg-git-added` = that colour at 20 % [OBSERVED · c6a992d55-1jeRaqUi.css]. A turn that changed
files offers "View this turn's changes" and "Open changes, {added} added, {removed} removed"
[OBSERVED · i18n/en-US.json].

## 4. Composer

Structure: `ChatComposer` > `ChatComposerEditor` (rich text) > `ChatComposerChin` (bottom row of
controls) and `ChatComposerDock` (a stack above it). The dock hosts `dock-item`, `dock-card`,
`dock-group`, `ChatComposerNotices` and `ChatComposerQueuedMessages`, spaced by `--cds-gap-xs`
[OBSERVED · c6a992d55-1jeRaqUi.css].

- Input grows to `min(24rem, 60dvh - 7.8rem)` then scrolls [OBSERVED · index.html inline CSS].
- Composer radius is 14 px (`--cds-radius-composer: .875rem`), against 24 px for cards
  [OBSERVED · c6a992d55-1jeRaqUi.css].
- Attachments are own components: `MessageAttachments`, `MessageAttachmentsImage`,
  `MessageAttachmentsVideo`, `MessageAttachmentsQuote`, plus a composer chip surface
  [OBSERVED · c6a992d55-1jeRaqUi.css; `surface: "chat_composer_chip"` in c3a41e137-Djvo3BXJ.js].
- Model picker: `ModelSelector` and `ModelSelectorEffort`, mounted in the Chin
  [OBSERVED · c6a992d55-1jeRaqUi.css].
- Stop: `[data-testid=chat-input-stop]` [OBSERVED · c0005ed47-DFdZgg2h.js].

Queueing a message mid-turn is a real feature, not a disabled input: "Queue for later",
"Send queued message", "Remove queued message", "Reorder queued message", "{n} queued"
[OBSERVED · i18n/en-US.json]. Edits are blocked while a turn runs — "Claude is working. You can
edit when it's done." / "Claude is still working. You can send this once it's done." — but a new
message may be queued [OBSERVED · i18n/en-US.json]. If sending fails the text comes back:
"Your queued message wasn't sent. It's back in the message box for you to send."
[OBSERVED · i18n/en-US.json]. Scroll affordance: `[data-testid=jump-to-latest]`, shown only when
the reader has scrolled away [OBSERVED · c04a1223c-96DiOhoV.js].

## 5. Visual system

**Colour.** One warm grey ramp, 35 steps, `#ffffff` to `#0b0b0b`, with a slight cream cast
(`--cds-gray-10 #fcfcfb`, `--cds-gray-50 #f0efec`, `--cds-gray-100 #e1e0d9`, `--cds-gray-850 #151515`)
[OBSERVED · c6a992d55-1jeRaqUi.css]. A parallel alpha ladder `--cds-alpha-0..9` at 0/5/10/20/35/50/
60/70/85/95 % of the ink colour builds every border and hover tint. The theme is monochrome:
"solid primary" is `--cds-gray-900`, "solid secondary" is `--cds-gray-600`.
The only warm accent is the Claude clay `#d97757` (dark twin `#d25f25`), used sparingly.
State colours exist but stay small: green `#10a122`, red `#dc3c3d`, amber `#e49c06`.
[OBSERVED · c6a992d55-1jeRaqUi.css]

**Type.** One UI sans with a variable weight axis; weights are 400 / 500 / 580, not 600
(`--cds-font-weight-semibold: 580`) [OBSERVED · c6a992d55-1jeRaqUi.css].

| Role | Size | Line |
|---|---|---|
| Prose body | 16 px | 24 px |
| Prose small / large | 15 px / 18 px | 22 px / 27 px |
| UI body | 13 px | 20 px |
| Caption | 12 px | 17 px |
| Code | 13 px | 19 px |
| Heading | 15 px | 20 px |
| Title | 22 px | 28 px |

Chat body leading is set separately to 1.4286
[OBSERVED · c6a992d55-1jeRaqUi.css]. A `--cds-rem-scale` multiplier scales every size, and
`[data-chat-text-size=l]` raises the leading — i.e. text size is a user setting
[OBSERVED · c6a992d55-1jeRaqUi.css; the toggle itself is INFERRED].

**Space.** 4 px base. Gaps 8 / 12 / 16 / 28 / 40 px (`--cds-gap-xs..xl`), pad 6 px
(`--cds-pad-md`), radius 24 px for cards and 14 px for the composer
[OBSERVED · c6a992d55-1jeRaqUi.css].

**Motion.** Durations 60 / 120 / 200 / 300 / 450 ms. Eases: `out cubic-bezier(0,0,.2,1)`,
`snap cubic-bezier(.32,.72,0,1)`, `overshoot cubic-bezier(.34,1.3,.64,1)`
[OBSERVED · c6a992d55-1jeRaqUi.css]. 139 keyframes total, almost all of them small: shimmer, pulse,
blink, fade, zoom.

**Code blocks.** `.code-block__code` with a `.table` layout inside, a separate
`--msg-code-font-size`, and a size that can follow the chat text size
(`code-blocks-follow-text-size`) [OBSERVED · c6a992d55-1jeRaqUi.css]. Highlighting runs in a
worker (`highlightWorker`) [OBSERVED · bundle inventory].

**How it stays quiet.** No borders by default — separation comes from 1 px `--cds-alpha-1/2`
hairlines. Colour is nearly absent; the only saturated pixels are an icon or a git colour. Actions
hide until hover or keyboard focus and fade in 120 ms. Thinking and tool rows are one muted line
until opened. Nothing pulses except the caret and a shimmer while something is genuinely working.
[OBSERVED hooks; the impression is INFERRED]

## 6. Artifacts

**Where it opens.** An artifact is a **pane beside the chat**, not a page, and it switches mode:
`card` (default), `dialog`, `fullscreen`, `minimized`
[OBSERVED · c3cbaca16-BnpTE5ql.js — `setMode("dialog"|"fullscreen"|"minimized")`, default `"card"`].
Layout hooks: `[data-pane-root]`, `[data-pane-split]`, `[data-pane-handle]`, `[data-pane-actions]`,
`[data-pane-body]`, `[data-pane-expanded]`, and `--chat-list-inset-beside-pane`, which shrinks the
chat column when a pane is beside it [OBSERVED · c6a992d55-1jeRaqUi.css]. Header hooks:
`frame-artifact-header-expand`, `frame-artifact-chat-back`, `artifact-pane-close`; the reverse case
has its own string, "Chat shown over the artifact" [OBSERVED · c293c7b4d-cW5GfGCh.js, i18n].

**Header and actions.** The viewer renders a 40 px bar (`--artifact-viewer-bar-height`) with
`--artifact-viewer-clear-start/end` insets, plus a hover-revealed close button pinned to the end
corner, visible on hover, touch or focus [OBSERVED · c3cbaca16-BnpTE5ql.js, c6a992d55-1jeRaqUi.css].
A mode control offers corner (minimise), fill (fullscreen) and dialog, switching with
`transition-[opacity,scale] duration-sheet ease-snap` (300 ms) [OBSERVED · c3cbaca16-BnpTE5ql.js].
Actions named in copy: Copy, "Download as {ext}", "Open this artifact in a browser",
"Open this artifact in a new tab", "Refresh artifact", "Check artifact for errors",
"Close artifact", "Full height", "Report artifact" [OBSERVED · i18n/en-US.json].

**Naming and versioning.** Default name "Untitled artifact"; rename is a title action; every artifact
has a type (`type_slug`, `type_title`) and an icon or "mark"
[OBSERVED · i18n/en-US.json, c3a41e137-Djvo3BXJ.js]. Versions are explicit: "Switch artifact
version, currently version {n}", "Artifact options, {version}", "Older version",
"Loading earlier versions", "Restore this version: {summary}", "Published · {version}",
"Pending changes aren't live" [OBSERVED · i18n/en-US.json]. A rename is blocked while publishing:
"This artifact can't be renamed until its latest version finishes publishing"
[OBSERVED · i18n/en-US.json].

**In the transcript.** The artifact appears as a chip: a 108 px tile row (thumbnail, or a mark if
there is no picture), then title plus a relative "updated" stamp, whole thing an `<a>` labelled
"Open in new tab" / "Open"; hovering loads a hover card with a 3 s timeout
[OBSERVED · c3a41e137-Djvo3BXJ.js].

**Mid-turn updates.** There are states for "Creating artifact…", "Drafting artifact...",
"Updating artifact…", "Updating artifact", "Loading artifact…", "Opening artifact", and
"This artifact didn't load after several tries" with a "Stop loading" option
[OBSERVED · i18n/en-US.json]. For published/live artifacts the model is explicit:
"Everyone who has this artifact open sees the edits below right away", and the app applies "the
edits below to this artifact's live page" [OBSERVED · i18n/en-US.json]. Whether the *preview pane
streams the artifact's source as tokens arrive, or only swaps in a finished version, I could not
determine [UNKNOWN].

**Code artifact vs rendered page.** Two paths: a page in an iframe ("Artifact preview iframe",
"Artifact preview iframe origin", "This artifact needs WebGL") and a code view ("Use Source to see
more", "Download the page file instead") [OBSERVED · i18n/en-US.json]. Code artifacts are gated by
plan [OBSERVED · i18n/en-US.json]. The iframe runs on a separate origin,
`www.claudeusercontent.com` by default [OBSERVED · i18n/en-US.json].

## 7. What would be wrong for a terminal-backed agent

1. **The artifact pane assumes a hosted sandbox.** Preview comes from an iframe on
   `claudeusercontent.com`, with publish, share, invite, comment and version-restore on a
   server-side store [OBSERVED · i18n/en-US.json]. None of that maps to files on disk.
2. **Messages live on a server.** Conversation state, artifact versions and retention
   ("deleted after {n} months of inactivity") are server facts [OBSERVED · i18n/en-US.json].
3. **"Thinking" as a timed collapse needs a separable reasoning stream.** "Thought for 12s" only
   makes sense if reasoning tokens arrive apart from the answer [INFERRED].
4. **The collapsed tool row is a *file*, not a call.** Grouping by path with a 14-verb vocabulary
   [OBSERVED · c21f11e6d-DuZbjtj2.js] assumes the agent edits files. A shell-first agent produces
   commands, exit codes and long stdout — a different row.
5. **Heavy client machinery.** 216 MB renderer, 5,733 JS chunks, an 8 MB WASM, a 2.1 MB stylesheet
   [OBSERVED · `ev_a59cae61a46a5dbe681e6800bfb524520700555535f86027bacd3cddc152326c`]. Take the
   ideas, not the stack.

## What to copy into Kolux

1. **One verb table, one row per subject.** Files group by path, tools group by server, searches
   collapse into one row. Verbs: viewed / edited / wrote to / created / ran / searched / read /
   used / saved. This is the single highest-value idea here.
2. **Collapsed row = icon + verb + subject + chevron, inside a real `<button aria-expanded>`.**
   Muted text that brightens on hover. Full value in `aria-label` when truncated.
3. **Thinking collapses to a duration.** "Thinking…" while live, "Thought for 12s" when done,
   "Show full thinking" to open. Four words of state, no spinner.
4. **Actions hidden until hover, fade in 120 ms in / 60 ms out, and also reveal on keyboard focus.**
   Quiet by default, reachable without a mouse.
5. **A monochrome warm-grey ramp plus an alpha ladder.** 35 greys, borders at 5–20 % ink, one clay
   accent used maybe twice a screen. This is why Claude looks calm.
6. **The transcript column at 768 px, prose at 16/24, UI at 13/20, code at 13/19.**
7. **A composer dock.** Queue messages while a turn runs, show them stacked above the input with
   send/remove/reorder, and put failed sends back in the box.
8. **Artifact as a side pane with modes.** card → fullscreen → minimised, one expand control and
   one close, chat column shrinks rather than being covered.
9. **Artifact chip in the transcript**: thumbnail or mark, title, relative "updated" time, whole
   chip is one link.
10. **`data-is-streaming` on the row** plus a 1 s blinking caret, both disabled under reduced motion.

## What to leave behind

1. **Server-side artifacts** — publishing, sharing, invitations, comment threads, version restore,
   retention timers, permissions. Replace with a local file path and a diff.
2. **The hosted iframe preview** and its `claudeusercontent.com` origin.
3. **Model picker with effort tiers and connector permission prompts.**
4. **Upload-to-server attachments**; local paths only.
5. **The frames/tiling window system** (`dframe-*`, tiles viewport, drag-to-split). Too much for a
   terminal client.
6. **Per-message reactions, "Copy unmodified message", read-aloud, and the whole sharing vocabulary.**
