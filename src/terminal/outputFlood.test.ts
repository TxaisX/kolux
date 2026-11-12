// Fix-term rows 786/787: the web view's per-chunk work over a large synthetic stream, timed without the app.
// @vitest-environment node
import { expect, test } from "vitest";
import { Terminal } from "@xterm/xterm";
import { decodeOutput } from "./codec";
import { Gate, Scanner } from "./shellMarks";
import { notePrinted } from "./printedAddresses";
import { batchAcks } from "./flow";

const MB = 1024 * 1024;
const LINE = "x".repeat(92);

/** `mb` megabytes of 100-byte numbered lines, cut into base64 chunks of `chunk` bytes the way the events carry them. */
function stream(mb: number, chunk: number): string[] {
  const lines = Math.floor((mb * MB) / 100);
  const text = Array.from({ length: lines }, (_, i) => `${String(i).padStart(6, "0")} ${LINE}\n`).join(""); // ASCII, so characters are bytes
  const out: string[] = [];
  for (let at = 0; at < text.length; at += chunk) out.push(btoa(text.slice(at, at + chunk)));
  return out;
}

function rate(label: string, mb: number, started: number) {
  const s = (performance.now() - started) / 1000;
  const line = `FLOOD ${label}: ${mb} MB in ${s.toFixed(2)} s = ${(mb / s).toFixed(1)} MB/s
`;
  const node = (globalThis as unknown as { process: { env: Record<string, string | undefined>; getBuiltinModule(n: string): { appendFileSync(p: string, d: string): void } } }).process;
  if (node.env.FLOOD_LOG) node.getBuiltinModule("node:fs").appendFileSync(node.env.FLOOD_LOG, line);
  return mb / s;
}

test("the pane's per-chunk handler (decode, scan, gate, address note, ack count) passes 48 MB far faster than 0.6 MB/s", () => {
  for (const chunk of [8 * 1024, 64 * 1024]) {
    const events = stream(48, chunk);
    const scanner = new Scanner();
    const gate = new Gate(false);
    let acked = 0;
    const acks = batchAcks((n) => (acked += n));
    const t0 = performance.now();
    let got = 0;
    for (const data of events) {
      const bytes = decodeOutput(data);
      scanner.feed(bytes);
      const out = gate.push(bytes, false);
      notePrinted("G:/dev/x", bytes);
      if (out) got += out.length;
      acks.drew(bytes.length);
    }
    acks.flush();
    const r = rate(`handler chunk=${chunk / 1024}KB`, 48, t0);
    expect(got).toBe(acked);
    expect(r).toBeGreaterThan(5);
  }
});

test("xterm's parser takes 48 MB of lines (scrollback 5000) and holds a bounded buffer", async () => {
  const events = stream(48, 64 * 1024);
  const term = new Terminal({ cols: 120, rows: 30, scrollback: 5000, allowProposedApi: true });
  const t0 = performance.now();
  // the app's own flow control keeps about 512 KB in flight; xterm throws data away past 50 MB queued
  for (let at = 0; at < events.length; at += 8) {
    await new Promise<void>((done) => {
      const group = events.slice(at, at + 8);
      let left = group.length;
      for (const data of group)
        term.write(decodeOutput(data), () => {
          if (--left === 0) done();
        });
    });
  }
  const r = rate("xterm parse (no renderer)", 48, t0);
  expect(term.buffer.active.length).toBeLessThanOrEqual(5000 + 30);
  expect(r).toBeGreaterThan(1);
  term.dispose();
  // 48 MB through the parser: ~1 s alone, several seconds when other lanes load the PC
}, 30_000);
