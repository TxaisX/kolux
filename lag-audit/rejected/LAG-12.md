# LAG-12 is not fixed in this round: history writes stay as they are

Finding LAG-12 (priority P3): "History writes are unbuffered and compaction runs inline"
(`src-tauri/src/terminal.rs`, the `History` struct that saves each pane's output to disk).

Decision: no code change. This is a written rejection, made by the board planner on 2026-11-23.
The owner can overrule it; see "What it would take" below.

## What was checked in the code (commit d8c3b71b)

1. The cost the review named first is already gone. The history file used to be opened again for
   every chunk of output (about 1 ms each on Windows). The handle is now kept open between chunks
   (`History.file`, marked "Fix-term 787"). One chunk is one `write_all` on that handle. Nothing
   forces the bytes to the physical disk (`sync_all` and `sync_data` are not called), so the
   operating system already buffers the write.
2. A slow history write on one pane does not hold up another pane. Two existing tests pin that:
   `perf_a_slow_history_on_one_pane_does_not_hold_up_another` and
   `perf_let_go_waits_for_a_history_write_under_way`.
3. Compaction is rare. A pane's file is cut back to its newest 128 KB only when it passes 1 MB
   (`HISTORY_CAP`, `HISTORY_KEEP`), so it runs once per roughly 900 KB of output per pane, and it
   rewrites at most about 1 MB through a temp file and a rename.

## Why no bounded fix was carded

A fix means an in-memory buffer or a background writer. Both give up the rule the code states for
this file: it is append-only, "so a crash at any moment leaves a usable copy". Bytes that are still
in memory are lost when the app dies, and that file is what brings a pane's output back after a
crash. Trading a small, unmeasured cost for a weaker restore is a product decision, not a worker's.

Nobody measured this cost in the running app. The review read the code only, and it rated the
finding P3, the lowest priority.

## What it would take to reopen LAG-12

- A measurement that shows history writes slowing terminal output: write calls and bytes per
  second per pane under a flood of output, counted with an injected fake file.
- An owner decision on how many of the newest bytes may be lost in a crash.

With both, a bounded card is possible: a small buffer flushed on a size limit, on a short timer,
on exit and before every read of the file, with the existing history tests kept green.
