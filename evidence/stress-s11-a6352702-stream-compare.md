# S11 phase c: the output path, before and after (DT-C243)

Release build, S11 three repeats each side, medians, CPU as % of one core. Before: main e0b10640
(`stress-s11-e0b10640-stream-before`). After: lane/perf-stream a6352702 (`stress-s11-a6352702-stream-after`,
`--compare` against the before file). Same PC, same scratch profile, window moved off-screen by the harness.

## Where phase c went (6 panes each printing ~20 lines/s), measured before any change

Scratch harness over 10 s windows of phase c (CDP counts; PowerShell per-thread CPU):

1. IPC transport: 1519 script evals per 10 s (one `ExecuteScript` per `terminal-output` event, ~120/s of
   output plus the rest) and 974 `terminal_ack` invokes per 10 s (one custom-protocol fetch round trip
   each, ~97/s: six panes x one ack every 50 ms of trickle). Renderer JS profile: "(program)" 1156 ms of
   12 262 ms (~9 % of a core: V8 compiling and running the evals, fetch plumbing); fetch 133 ms, resolve 28,
   sendIpcMessage 17, json 9.
2. Window process: main thread 5.23 % of a core (ExecuteScript marshalling and protocol handling),
   MojoThread 1.26 %, EBWorkerThread 0.6 %. All six pty-pump threads together ~0.8 %: the Rust
   bookkeeping per chunk (scrub, line log, history write, base64) is not the cost.
3. Drawing: xterm WebGL render 164 ms + write/parse 86 ms per 12 s (~2 % of JS time) plus gpu-process
   7-10 %.

## What changed

- `src/terminal/flow.ts`: `ACK_DELAY_MS` 50 -> 250. The reader only pauses at 512 KB unacknowledged
  (FLOW_HIGH), so a trickle's acknowledgement need not be sent nearly once per line.
- `src-tauri/src/terminal/output_batch.rs` (new): one `terminal-output` event per 16 ms window carries every
  pane's chunks of that window in arrival order (first chunk after a quiet moment goes at once; a 256 KB
  queue goes without waiting; `flush_now` before the exit note). Each chunk keeps `id`, `pane`,
  `generation`, `seq`, so resync (ORCH-057) and flow control are unchanged.
- `src/terminal/outputBus.ts` (new): readers get one chunk at a time, in order; the pane, the onboarding
  terminal, the ports scan and the Codex sign-in scan switched from `listen("terminal-output")` to it.

Scratch phase c (30 s, single runs): 63.4 % -> 40.6 % (acks only) -> 31.4 % (acks + batches). Per 10 s:
evals 1509 -> 382; `terminal_ack` 966 -> 205; eval bytes 466 KB -> 288 KB.

## S11 totals, before -> after (medians; [min-max] over the 3 repeats)

| Phase | CPU % of one core | WS MB | private MB | JS heap MB |
|---|---|---|---|---|
| a) idle, 1 shell pane | 3.88 [3.08-3.97] -> 3.51 [3.48-3.70] | 471.5 -> 470.5 | 255.0 -> 255.1 | 17.3 -> 17.4 |
| b) 6 shell panes, idle | 3.89 [3.62-4.32] -> 3.51 [3.43-4.05] | 491.3 -> 490.9 | 273.4 -> 272.8 | 19.9 -> 19.9 |
| c) 6 panes, ~20 lines/s each | 59.41 [49.92-70.04] -> 25.05 [22.98-25.71] | 557.6 -> 539.5 | 329.7 -> 310.9 | 55.7 -> 46.2 |
| d) 12 panes, minimized | 3.40 [3.22-3.72] -> 3.29 [3.19-3.80] | 245.8 -> 253.2 | 326.9 -> 310.6 | 40.1 -> 35.9 |
| e) 12 shell panes, idle | 5.38 [4.87-5.87] -> 4.72 [4.61-4.93] | 570.4 -> 553.1 | 343.4 -> 329.0 | 50.0 -> 42.3 |
| f) 12 panes + 3 hidden browser tabs | 5.39 [4.94-5.63] -> 5.69 [4.91-5.84] | 391.2 -> 385.1 | 411.0 -> 405.8 | 38.7 -> 37.8 |

Phase c GPU engine 1.81 % -> 1.68 %. Phases a, b, d, e, f move within their min-max spread; f's +0.29 CPU
is inside its before range (4.94-5.63 vs 5.84 after, after's own range 4.91-5.84).

## Per process role, CPU % of one core, before -> after

| Role | a) idle | b) 6 idle | c) 6 streaming | e) 12 idle |
|---|---|---|---|---|
| window (Rust) | 1.23 -> 1.23 | 1.29 -> 1.61 | 10.42 -> 4.72 | 1.69 -> 1.66 |
| wv-browser | 1.37 -> 1.10 | 0.78 -> 0.83 | 15.21 -> 3.91 | 1.21 -> 1.31 |
| renderer | 0.78 -> 0.59 | 1.21 -> 0.94 | 21.32 -> 9.08 | 1.90 -> 1.45 |
| gpu-process | 0.19 -> 0.13 | 0.19 -> 0.13 | 8.76 -> 6.09 | 0.19 -> 0.13 |
| utility | 0.19 -> 0.19 | 0.16 -> 0.19 | 3.70 -> 0.83 | 0.43 -> 0.29 |
| total | 3.88 -> 3.51 | 3.89 -> 3.51 | 59.41 -> 25.05 | 5.38 -> 4.72 |

Phase c memory per role: renderer WS 193.3 -> 177.3 MB, private 132.4 -> 116.2 MB (fewer eval scripts and
ack promises alive at once); the other roles within 2 MB.

## What stays the same

Bytes, order and `seq` per chunk; colours, scrollback, links, search, agent status and title scans run on
the same chunks in the same order (the bus fans a batch out one chunk at a time). The hidden/minimised
fast path (frame.ts, DT-C236) is untouched. Added latency: at most one 16 ms window for a chunk that
follows another within 16 ms; the first chunk after a quiet moment is sent at once.

## S2 output flood (8 panes x ~50 MB), release, before e0b10640 -> after a6352702

| Check | before (`stress-s2-e0b10640`) | after (`stress-s2-a6352702`) |
|---|---|---|
| echo latency, 9th pane, nothing else running (bar p95 <= 250 ms) | PASS p50 12 / p95 14 / max 14 ms | PASS p50 12 / p95 14 / max 15 ms |
| echo latency, 9th pane while 8 panes flood (bar p95 <= 250 ms) | FAIL p50 2067 / p95 2706 / max 3079 ms | PASS p50 69 / p95 97 / max 102 ms |
| all 8 floods finish (bar 600 s) | PASS 415 s (1.0 MB/s) | PASS 110 s (3.6 MB/s) |
| memory growth at the peak | FAIL peak 4781 MB (+4233) | FAIL peak 3521 MB (+2980) |
| memory growth 10 s after the floods | FAIL 2912 MB (+2364) | FAIL 2062 MB (+1520) |
| final line shown after the flood | PASS 8 of 8 | PASS 8 of 8 |
| page errors | PASS 0 | PASS 0 |
| app closes, no process left | PASS | PASS |

The two memory checks failed before this change too (also on main 78987726 on 2026-11-08: peak +5726 MB,
and on f1ff878b on 2026-10-25: +3429 MB); the flood's working set is a separate matter (xterm scrollback
and the history file path), not the output transport.
