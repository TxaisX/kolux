# Chat visual rules for Kolux (2026-11-20)

The owner's ask: "make the terminals into more of a chat session so that we can have the simplicity of
the visuals and responses as Claude." This file is the design contract for that. It is built from two
captures taken the same day (`claude-desktop-chat-capture-2026-11-20.md`,
`claude-code-turn-capture-2026-11-20.md`) and from what Kolux already ships.

Read the two captures for evidence. This file only states the rules Kolux will follow.

## The one idea that does the most work: rows group by subject

A turn is not a list of tool calls. It is a small number of rows, each about one thing.

- Key a row by what it touched: a file path, a tool server, or "web search" when the call is a search.
- One row per subject, holding that subject's operations in order.
- The row reads: icon, verb, subject, chevron. Nothing else until it is opened.
- Verbs are a fixed table, not free text: viewed, edited, wrote to, created, ran, searched, read,
  used, saved.
- A burst is one row with a count, not N rows: "12 calls · open the group for the rest".

Why: this is what keeps a busy turn readable. Everything else in this list is smaller than this.

## Rules

1. **Every collapsible row is a real button.** `<button aria-expanded>`, icon + verb + subject +
   chevron, full value in `aria-label` when the text is cut. Muted by default, brighter on hover.
2. **Thinking shows a duration, never a summary.** "Thinking…" while live, "Thought for 12s" when
   finished, and a way to open the full text. No spinner.
3. **Failure is a tag, not a layout.** An error row has the same shape as a success row and is marked.
   The cause is kept as words the CLI already gives us ("interrupted", "tool call did not complete",
   "blocked by a safety monitor"), not collapsed into one generic "stopped".
4. **Actions appear on hover, and on keyboard focus.** 120 ms in, 60 ms out. A chat that hides its
   copy button from keyboard users is not quiet, it is broken.
5. **Quiet is a palette, not an effect.** Warm greys for every border and hover tint, one accent colour
   used about twice a screen. No gradients, no shadows on messages, no colour on every status.
6. **One column, fixed measure.** The transcript does not stretch to a 2560 px window: it keeps a
   readable measure and centres. Prose is roomy; labels and tool rows are compact.
7. **Streaming is visible in one place only.** A blinking caret at the end of the live row, switched off
   under reduced motion. Nothing else animates while text arrives.
8. **The composer queues.** A message typed while a turn runs sits above the input, stacked, with send
   and remove. A failed send goes back in the box rather than disappearing.
9. **Artifacts sit beside the chat, never over it.** The chat column narrows; the artifact gets its own
   header with one expand control and one close. In the transcript, an artifact is one chip with a
   thumbnail, its name and how long ago it changed.
10. **Nothing is invented.** Cost, duration and usage come from the result the engine already reports.

## Measured details

These were captured byte for byte from the real terminal UI
(`claude-tui-visuals-2026-11-20.md`), so they are not guesses:

1. **A collapsed group is one sentence, past tense.** "Searched for 1 pattern, read 2 files, ran 1
   shell command · 1 failed". The counts are bold, the sentence is grey, and a failure count is the
   one place colour appears. Not a list, not a summary card.
2. **A diff states its size before its content.** "Added 2 lines, removed 1 line", then each line is
   `[number][space][marker][content]`. The red or green tint covers four characters (number, space,
   marker), not the whole line. The reader can size the change without reading it.
3. **The interrupt hint never moves.** The working line is `✶ Verb… (20s · ↓ 160 tokens)` and the
   footer always ends `· esc to interrupt`. The sub-state lives in the parentheses; the verb does not
   change position or length between states.
4. **Tool rows are `● Name(target)` with `⎿ ` beneath**, and the indent ladder has three stops: the
   left margin, plus one step, plus two. No deeper nesting, ever.
5. **The group opens to the tool rows it hides**, in call order, with the failure already marked.

## What we copy from the terminal, not the desktop app

The desktop app is the visual reference. The terminal is the behavioural one, because a Kolux pane runs
the same process:

- The collapse rule and the row vocabulary come from Claude Code.
- The interruption wording comes from Claude Code: eight distinct messages, each naming a cause.
- The permission prompt keeps its two honest behaviours: refuse to approve a target it cannot fully
  show, and say so instead of hiding options.

## What we leave behind

- Server-side artifacts, sharing, comments, version restore, retention.
- The hosted preview iframe.
- Model picker with effort tiers; connector permission prompts.
- Upload-to-server attachments: Kolux passes local paths.
- Per-message reactions, read-aloud, and the sharing vocabulary.
- The desktop app's window tiling.

## Where these rules land in the code

| Rule | Home |
|---|---|
| Rows group by subject, verb table | `src/chat/steps.ts` (`fold`), `src/chat/model.ts` |
| Collapsible row markup | `src/chat/ChatView.tsx` (`ViewRow`) |
| Thinking duration, streaming caret | `src/chat/live/` alongside the event reducer |
| Hover and focus actions | `src/chat/chat.css` |
| Grey ramp and the single accent | `src/styles.css` theme tokens |
| Artifact pane and chip | `src/chat/live/` (slice 5) |

## How we know it worked

A person watching a 20-call turn should be able to answer, without opening anything: what files were
touched, what failed, and whether it is still working. If they have to open the group to answer any of
those, the rows are wrong.
