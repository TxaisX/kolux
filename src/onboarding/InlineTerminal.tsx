// ONB-017 / ONB-028: the small terminal inside the Setup Guide's CLI step and the CLI tip. It opens the
// user's shell, waits for a prompt (cliInstall.ts, about fifty checks at most), then types the setup
// command WITHOUT pressing Enter: the user presses it. When the shell exits, `onExit` runs so the step
// can look again. The pane closes its shell when this panel goes away, so no installer runs unseen.
import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import TerminalPane from "../terminal/TerminalPane";
import { decodeOutput, type ExitEvent } from "../terminal/codec";
import { onTerminalOutput } from "../terminal/outputBus";
import { createTyper, type Typer } from "./cliInstall";

const decoder = new TextDecoder();

/** `height` is the terminal's pixel height: shorter inside onboarding's Explore Kolux stops (ONB-024). */
export default function InlineTerminal({ command, onExit, height = 220 }: { command: string | null; onExit: () => void; height?: number }) {
  const id = useRef<number | null>(null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const typer = useRef<Typer | null>(null);
  const want = useRef(command);
  want.current = command;
  const stops = useRef<(() => void)[]>([]);

  useEffect(() => {
    let live = true;
    const watch = (p: Promise<() => void>) => void p.then((off) => (live ? stops.current.push(off) : off()), () => {});
    watch(
      onTerminalOutput((e) => {
        if (id.current === null || e.id !== id.current) return;
        try {
          typer.current?.output(decoder.decode(decodeOutput(e.data), { stream: true }));
        } catch {
          // an undecodable chunk is not prompt text
        }
      }),
    );
    // Exits from any other terminal are ignored.
    watch(listen<ExitEvent>("terminal-exit", (e) => id.current !== null && e.payload.id === id.current && exit.current()));
    return () => {
      live = false;
      typer.current?.stop();
      stops.current.splice(0).forEach((off) => off());
    };
  }, []);

  const bind = useMemo(
    () => (pty: number) => {
      id.current = pty;
      typer.current?.stop();
      typer.current = createTyper({
        write: (data) => invoke("terminal_write", { id: pty, data, generation: null }),
        every: (fn, ms) => {
          const t = window.setInterval(fn, ms);
          return () => window.clearInterval(t);
        },
        now: () => Date.now(),
      });
      typer.current.start();
      if (want.current) typer.current.want(want.current);
    },
    [],
  );
  // A command that changes (the ticks changed) is typed once, and never the same one twice.
  useEffect(() => {
    if (command) typer.current?.want(command);
  }, [command]);

  return (
    <div className="inline-term" data-testid="inline-term" style={{ height }}>
      <TerminalPane agent="shell" focused onPty={(pty) => bind(pty)} />
      <p className="guide-note dim">The command is typed at the prompt but not run. Press Enter in the terminal to run it.</p>
    </div>
  );
}
