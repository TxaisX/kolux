import { describe, expect, it, vi } from "vitest";
import { agentFromTitle, followedTitle, Gate, identityPacer, IDLE, TITLE_PACE_MS, parseOsc, printsMarks, reduceIdentity, Scanner, shownAgent, Startup, startupText, tabAgent, typedAsIs, type Identity, type Mark } from "./shellMarks";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);
const PROMPT = "\x1b]133;A\x07";
const START = "\x1b]133;C\x07";
const END = (code: number) => `\x1b]133;D;${code}\x07`;
const TITLE = (t: string) => `\x1b]0;${t}\x07`;

/** The marks of `stream` when it arrives in two chunks cut at `at`. */
function cut(stream: string, at: number): Mark[] {
  const all = bytes(stream);
  const s = new Scanner();
  return [...s.feed(all.slice(0, at)), ...s.feed(all.slice(at))];
}

describe("Scanner (TERM-058, ACCT-047)", () => {
  it("finds prompt, start, end and title marks in one chunk", () => {
    const s = new Scanner();
    const marks = s.feed(bytes(`banner\r\n${PROMPT}$ ${TITLE("✳ Claude Code")}${START}out${END(2)}${PROMPT}`));
    expect(marks).toEqual([{ kind: "prompt" }, { kind: "title", text: "✳ Claude Code" }, { kind: "start" }, { kind: "end", code: 2 }, { kind: "prompt" }]);
  });

  it("reads the same marks whatever chunk boundary cuts the sequence", () => {
    const stream = `Welcome\r\n${TITLE("user@host: ~/repo")}${PROMPT}$ claude\r${START}\x1b]2;Claude Code – working…\x1b\\${END(0)}${PROMPT}`;
    const whole = new Scanner().feed(bytes(stream));
    expect(whole.map((m) => m.kind)).toEqual(["title", "prompt", "start", "title", "end", "prompt"]);
    for (let at = 1; at < bytes(stream).length; at++) expect(cut(stream, at), `cut at ${at}`).toEqual(whole);
  });

  it("takes BEL and ST terminators and a title with semicolons", () => {
    expect(new Scanner().feed(bytes("\x1b]2;a;b;c\x1b\\"))).toEqual([{ kind: "title", text: "a;b;c" }]);
    expect(new Scanner().feed(bytes("\x1b]0;  spaced  \x07"))).toEqual([{ kind: "title", text: "spaced" }]);
  });

  it("ignores other OSC codes and an end mark without a code keeps null", () => {
    expect(parseOsc("1;icon")).toBeNull();
    expect(parseOsc("52;c;aGk=")).toBeNull();
    expect(parseOsc("133;B")).toBeNull();
    expect(parseOsc("133;D")).toEqual({ kind: "end", code: null });
    expect(parseOsc("133;D;x")).toEqual({ kind: "end", code: null });
    expect(parseOsc("9999;status")).toBeNull();
  });

  it("abandons an OSC interrupted by another escape and drops an oversized one", () => {
    const s = new Scanner();
    // A CSI colour change inside a half-written OSC: the OSC is garbage, the prompt after it counts.
    expect(s.feed(bytes(`\x1b]0;half\x1b[31mred${PROMPT}`))).toEqual([{ kind: "prompt" }]);
    // ESC ] right after the abandoning ESC starts a fresh OSC.
    expect(new Scanner().feed(bytes("\x1b]0;half\x1b]133;A\x07"))).toEqual([{ kind: "prompt" }]);
    const huge = `\x1b]0;${"x".repeat(5000)}\x07${PROMPT}`;
    expect(new Scanner().feed(bytes(huge))).toEqual([{ kind: "prompt" }]);
  });

  it("keeps multi-byte titles whole across a cut inside the character", () => {
    const stream = TITLE("日本語 title");
    const whole = new Scanner().feed(bytes(stream));
    expect(whole).toEqual([{ kind: "title", text: "日本語 title" }]);
    for (let at = 1; at < bytes(stream).length; at++) expect(cut(stream, at)).toEqual(whole);
  });
});

describe("Gate (ACCT-047)", () => {
  it("holds output until the prompt mark, then shows everything in order", () => {
    const g = new Gate(true);
    expect(g.push(bytes("Last login\r\n"), false)).toBeNull();
    expect(g.push(bytes("motd\r\n"), false)).toBeNull();
    expect(g.open).toBe(false);
    const shown = g.push(bytes(`${PROMPT}$ `), true);
    expect(new TextDecoder().decode(shown!)).toBe(`Last login\r\nmotd\r\n${PROMPT}$ `);
    expect(g.open).toBe(true);
    expect(g.push(bytes("x"), false)).toEqual(bytes("x"));
  });

  it("a shell that exits before the mark still shows what it printed", () => {
    const g = new Gate(true);
    g.push(bytes("zsh: no such file: ~/.zshrc\r\n"), false);
    const held = g.release();
    expect(new TextDecoder().decode(held!)).toBe("zsh: no such file: ~/.zshrc\r\n");
    expect(g.open).toBe(true);
    expect(g.release()).toBeNull();
  });

  it("knows which shells print marks, by name or path", () => {
    expect(printsMarks("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(true);
    expect(printsMarks("powershell.exe")).toBe(true);
    expect(printsMarks("/bin/zsh")).toBe(true);
    expect(printsMarks("\"C:\\Program Files\\Git\\bin\\bash.exe\"")).toBe(true);
    expect(printsMarks("fish")).toBe(true);
    expect(printsMarks("cmd.exe")).toBe(false);
    expect(printsMarks("/bin/sh")).toBe(false);
    expect(printsMarks("wsl.exe")).toBe(false);
    expect(printsMarks(null)).toBe(true);
    expect(printsMarks(undefined)).toBe(true);
  });

  it("is open from the start for a shell without hooks and keeps the newest bytes at its cap", () => {
    expect(new Gate(false).push(bytes("a"), false)).toEqual(bytes("a"));
    const g = new Gate(true, 8);
    g.push(bytes("12345"), false);
    g.push(bytes("6789"), false);
    expect(g.dropped).toBe(5);
    expect(new TextDecoder().decode(g.release()!)).toBe("6789");
  });
});

describe("Startup (ACCT-047)", () => {
  it("types a short plain command once, at the first prompt only", () => {
    const s = new Startup("claude", true);
    expect(s.pending).toBe(true);
    expect(s.onPrompt()).toBe("claude\r");
    expect(s.onPrompt()).toBeNull();
    expect(s.onQuiet()).toBeNull();
    expect(s.pending).toBe(false);
    expect(s.exited()).toBe(false);
  });

  it("hands a long or quoted command over whole, as one bracketed paste", () => {
    const prompt = `claude "fix the 'quoted' bug in src\\main.rs" --model opus`;
    expect(typedAsIs(prompt)).toBe(false);
    expect(startupText(prompt)).toBe(`\x1b[200~${prompt}\x1b[201~\r`);
    expect(startupText("a".repeat(161))).toBe(`\x1b[200~${"a".repeat(161)}\x1b[201~\r`);
    expect(startupText("codex\n")).toBe("codex\r");
    expect(startupText("one\ntwo")).toBe("\x1b[200~one\ntwo\x1b[201~\r");
  });

  it("falls back to the quiet timer only for a shell without hooks", () => {
    const wrapped = new Startup("ls", true);
    expect(wrapped.onQuiet()).toBeNull();
    expect(wrapped.pending).toBe(true);
    const plain = new Startup("dir", false);
    expect(plain.onQuiet()).toBe("dir\r");
    expect(plain.onQuiet()).toBeNull();
  });

  it("reports a command lost when the shell ends first, and nothing for no command", () => {
    const s = new Startup("claude", true);
    expect(s.exited()).toBe(true);
    expect(s.onPrompt()).toBeNull();
    const none = new Startup("  ", true);
    expect(none.pending).toBe(false);
    expect(none.exited()).toBe(false);
    expect(new Startup(undefined, false).onQuiet()).toBeNull();
  });
});

describe("identity from titles and marks (TERM-058)", () => {
  const run = (marks: Mark[], restored = false) => marks.reduce((st, m) => reduceIdentity(st, m, restored), IDLE);

  it("recognises Claude and Codex from titles, not from words inside other words", () => {
    expect(agentFromTitle("✳ Claude Code")).toBe("claude");
    expect(agentFromTitle("codex – working")).toBe("codex");
    expect(agentFromTitle("CLAUDE")).toBe("claude");
    expect(agentFromTitle("preclaudeX")).toBeNull();
    expect(agentFromTitle("user@host: ~/codexes")).toBeNull();
    expect(agentFromTitle("")).toBeNull();
  });

  it("starting Claude in a shell gives the tab Claude; the prompt returning takes it away", () => {
    const running = run([{ kind: "prompt" }, { kind: "start" }, { kind: "title", text: "✳ Claude Code" }]);
    expect(running).toEqual<Identity>({ running: true, title: "✳ Claude Code", agent: "claude" });
    expect(shownAgent("shell", running)).toBe("claude");
    expect(followedTitle(undefined, running, "Terminal 2")).toBe("✳ Claude Code");
    const back = reduceIdentity(running, { kind: "end", code: 0 });
    expect(back).toEqual(IDLE);
    expect(shownAgent("shell", back)).toBe("shell");
    expect(followedTitle(undefined, back, "Terminal 2")).toBe("Terminal 2");
    expect(reduceIdentity(running, { kind: "prompt" })).toEqual(IDLE);
  });

  it("a title naming an agent counts even without a start mark; an unrelated title keeps the agent while running", () => {
    const st = run([{ kind: "title", text: "Claude Code" }]);
    expect(st.running).toBe(true);
    expect(st.agent).toBe("claude");
    const renamed = reduceIdentity(st, { kind: "title", text: "Thinking…" });
    expect(renamed.agent).toBe("claude");
    expect(renamed.title).toBe("Thinking…");
    // A path title at the prompt is the shell's own, never a program title.
    const sh = reduceIdentity(IDLE, { kind: "title", text: "C:\\repo" });
    expect(sh.agent).toBeNull();
    expect(followedTitle(undefined, { running: true, title: "~/repo", agent: null }, "Terminal 1")).toBe("Terminal 1");
  });

  it("replayed or restored output never counts as a command starting or finishing", () => {
    const st = run([{ kind: "start" }, { kind: "title", text: "Claude Code" }, { kind: "end", code: 0 }], true);
    expect(st).toEqual(IDLE);
    const live = run([{ kind: "start" }, { kind: "title", text: "Claude Code" }]);
    expect(reduceIdentity(live, { kind: "end", code: 0 }, true)).toEqual(live);
  });

  it("the pane's own agent and the live program outrank a saved record; a split tab follows the focused pane", () => {
    expect(shownAgent("codex", IDLE, "claude")).toBe("codex");
    expect(shownAgent("shell", IDLE, "claude")).toBe("claude");
    expect(shownAgent("shell", { running: true, title: "vim", agent: null }, "claude")).toBe("shell");
    expect(shownAgent("shell", { running: true, title: "codex", agent: "codex" }, "claude")).toBe("codex");
    expect(tabAgent([{ focused: false, agent: "claude" }, { focused: true, agent: "shell" }])).toBe("shell");
    expect(tabAgent([{ focused: true, agent: "codex" }, { focused: false, agent: "shell" }])).toBe("codex");
    expect(tabAgent([{ focused: false, agent: "claude" }, { focused: false, agent: "shell" }])).toBe("claude");
    expect(tabAgent([])).toBe("shell");
  });

  it("a user's own name beats the program title", () => {
    expect(followedTitle("Build box", { running: true, title: "Claude Code", agent: "claude" }, "Terminal 1")).toBe("Build box");
    expect(followedTitle("   ", { running: true, title: "Claude Code", agent: "claude" }, "Terminal 1")).toBe("Claude Code");
  });
});

describe("title storm (perf: one render per real change, titles paced)", () => {
  const title = (text: string): Mark => ({ kind: "title", text }) as Mark;
  it("gives back the same identity when a mark changes nothing", () => {
    const a = reduceIdentity(IDLE, title("✳ Claude Code"));
    expect(reduceIdentity(a, title("✳ Claude Code"))).toBe(a);
    const r = reduceIdentity(IDLE, { kind: "start" } as Mark);
    expect(reduceIdentity(r, { kind: "start" } as Mark)).toBe(r);
    expect(reduceIdentity(a, title("✶ Claude Code"))).not.toBe(a);
  });
  // Each apply is one setLive in the pane, so one TerminalPane render, one onIdentity and one window render.
  const feed = (titles: string[], gapMs: number) => {
    vi.useFakeTimers();
    try {
      const applied: Identity[] = [];
      const pacer = identityPacer((id) => applied.push(id));
      let now = IDLE;
      const note = (next: Identity) => {
        if (next === now) return; // TerminalPane.noteIdentity's own check
        now = next;
        pacer.note(next);
      };
      note(reduceIdentity(now, title("✳ Claude Code"))); // the agent appears: goes at once
      const first = applied.length;
      for (const t of titles) {
        note(reduceIdentity(now, title(t)));
        vi.advanceTimersByTime(gapMs);
      }
      vi.advanceTimersByTime(TITLE_PACE_MS);
      return { first, extra: applied.length - first, last: applied[applied.length - 1], now };
    } finally {
      vi.useRealTimers();
    }
  };
  it("100 identical title marks cost no extra render", () => {
    const r = feed(Array(100).fill("✳ Claude Code"), 10);
    expect(r.first).toBe(1);
    expect(r.extra).toBe(0);
  });
  it("100 distinct titles in one second cost about five renders, and the newest title lands", () => {
    const frames = Array.from({ length: 100 }, (_, i) => `${"✳✶✻✽"[i % 4]} Claude Code ${i}`);
    const r = feed(frames, 10);
    expect(r.extra).toBeGreaterThan(0);
    expect(r.extra).toBeLessThanOrEqual(6);
    expect(r.last).toBe(r.now);
    expect(r.last?.title).toBe(frames[99]);
  });
  it("a change of running or agent is never held back", () => {
    vi.useFakeTimers();
    try {
      const applied: Identity[] = [];
      const pacer = identityPacer((id) => applied.push(id));
      const a = reduceIdentity(IDLE, title("✳ Claude Code"));
      pacer.note(a);
      pacer.note(reduceIdentity(a, title("✶ Claude Code"))); // title only: held
      expect(applied).toEqual([a]);
      pacer.note(IDLE); // the prompt came back: at once, and the held title is dropped
      expect(applied).toEqual([a, IDLE]);
      vi.advanceTimersByTime(TITLE_PACE_MS * 2);
      expect(applied).toEqual([a, IDLE]);
      pacer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
