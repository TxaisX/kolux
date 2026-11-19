// ONB-017 (the Setup Guide's CLI step) and ONB-028 (the CLI tip): one panel that sets up the kolux
// command and the Kolux skills. The command is registered for the whole system (cli_register, T-250-b);
// the skills go through the community skills installer, whose command is typed at a prompt in a small
// inline terminal and runs only when the user presses Enter (T-196-b). The outcome is "Installed" or
// "Needs attention". Nothing here runs an installer itself.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startTicked, caps, type Cap, type CapId, type CliStatus } from "./guide";
import { nothingToDo, outcomeOf, planOf, type Outcome, type Registration } from "./cliInstall";
import InlineTerminal from "./InlineTerminal";

type Scan = { skills: { name: string; source: string }[] };

/** The capabilities as they are on this computer right now, read when `on` turns true and again on `refresh`. */
export function useCliCaps(on: boolean) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [home, setHome] = useState<string[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    let live = true;
    invoke<CliStatus>("cli_status").then((x) => live && setCli(x), () => live && setCli(null));
    invoke<Scan>("skills_scan", { workspace: null, refresh: n > 0 }).then(
      (s) => live && setHome(s.skills.filter((k) => k.source === "home").map((k) => k.name)),
      () => {},
    );
    return () => void (live = false);
  }, [on, n]);
  return { cli, caps: caps(cli, home), refresh: () => setN((x) => x + 1) };
}

const COPIED_CMD = "Command copied";
const COPY_FAILED_CMD = "Could not copy; select the command above and copy it yourself";

export default function CliSetup({ list, onChanged }: { list: Cap[]; onChanged: () => void }) {
  const [ticked, setTicked] = useState<CapId[]>(() => startTicked(list));
  const key = list.map((c) => `${c.id}:${c.ready}`).join();
  useEffect(() => setTicked(startTicked(list)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const plan = planOf(ticked, list);

  const run = async () => {
    setBusy(true);
    setNote(null);
    setOutcome(null);
    try {
      if (plan.register) {
        const done = await invoke<Registration>("cli_register").then(
          (r) => r,
          (e) => String(e),
        );
        setOutcome(outcomeOf(done, null));
      }
      // The skills installer was retired (slim-down wave B); this step goes with the command line.
      setLine(null);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const copy = () => navigator.clipboard.writeText(line ?? "").then(() => setNote(COPIED_CMD), () => setNote(COPY_FAILED_CMD));
  return (
    <>
      <p className="guide-note">
        Registering the CLI puts the <code>kolux</code> command in every terminal on this computer, not only inside Kolux, so an agent you start anywhere can open
        terminals, start other agents and read Kolux's skills.
      </p>
      <ul className="guide-caps">
        {list.map((c) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={ticked.includes(c.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((t) => t !== c.id))} />
              <span className="name">{c.label}</span>
              <span className={`state${c.ready ? " ok" : ""}`}>{c.ready ? "Ready" : "Not set up"}</span>
            </label>
            <span className="about">{c.about}</span>
          </li>
        ))}
      </ul>
      {outcome && (
        <p className={`guide-note${outcome.kind === "installed" ? " ok" : " warn"}`} role="status" data-outcome={outcome.kind}>
          {outcome.kind === "installed" ? "Installed: the kolux command is registered." : `Needs attention: ${outcome.why}`}
        </p>
      )}
      {line && (
        <>
          <code className="skills-cmd">{line}</code>
          <InlineTerminal command={line} onExit={onChanged} />
        </>
      )}
      <div className="btn-row">
        <button className="btn primary" disabled={busy || nothingToDo(plan)} onClick={() => void run()}>
          Set up
        </button>
        {line && (
          <button className="btn" onClick={() => void copy()}>
            Copy command
          </button>
        )}
        <button className="btn" onClick={onChanged}>
          Re-check
        </button>
      </div>
      {note && <p className="guide-note dim" role="status">{note}</p>}
    </>
  );
}
