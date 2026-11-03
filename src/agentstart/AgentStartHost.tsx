// SESS-031 / VIEW-087 (T-187-b, T-189-b): the dialog for continuing a conversation in an agent, and
// the single mount that gives the "start an agent" buttons what they need. Mounted once by the window.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "../onboarding/dialogFocus";
import "./agentstart.css";
import { carryLine, runCarry, type CarryContext } from "./carry";
import { closeCarry, currentEnv, folderReady, report, setEnv, useCarryDialog, type Env } from "./host";
import { available, pickTarget } from "./rules";

type Loaded = { ctx: CarryContext | null; error: string | null };

export default function AgentStartHost(env: Env) {
  // Registered during render so a button clicked right after a state change sees the new window state.
  setEnv(env);
  const source = useCarryDialog();
  return source ? <CarryDialog key={`${source.agent}:${source.id}`} source={source} /> : null;
}

function CarryDialog({ source }: { source: { agent: string; id: string; title?: string } }) {
  const env = currentEnv();
  const agents = useMemo(() => available(env?.agents ?? []), [env?.agents]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [target, setTarget] = useState<string>(() => pickTarget(agents, source.agent, env?.defaultId)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, closeCarry); // 49-ux2: focus on open, Escape from anywhere, focus back on close

  useEffect(() => {
    let live = true;
    invoke<CarryContext>("session_carry_context", { agent: source.agent, id: source.id }).then(
      (ctx) => live && setLoaded({ ctx, error: null }),
      (e) => live && setLoaded({ ctx: null, error: String(e) }),
    );
    return () => {
      live = false;
    };
  }, [source.agent, source.id]);

  const sourceName = env?.agents.find((a) => a.id === source.agent)?.name ?? source.agent;
  const go = async () => {
    if (!env || !loaded?.ctx || busy) return;
    setBusy(true);
    setError(null);
    const r = await runCarry({ ctx: loaded.ctx, agents: env.agents, targetId: target, workspace: env.workspace, ready: folderReady, launch: env.launch });
    setBusy(false);
    if (r.ok) {
      report(r, "A new session started with the earlier conversation.");
      closeCarry();
    } else setError(r.message);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeCarry()}>
      <div ref={dialog} tabIndex={-1} className="agentstart-dialog" role="dialog" aria-modal="true" aria-label="Continue in an agent">
        <h2>Continue in an agent</h2>
        <p className="conn-detail">
          {source.title ? `"${source.title}" · ` : ""}
          {sourceName} session
        </p>
        {!loaded && <p className="conn-detail">Reading the conversation…</p>}
        {loaded?.error && (
          <p role="alert" className="conn-detail agentstart-error">
            {loaded.error}
          </p>
        )}
        {loaded?.ctx && (
          <>
            <fieldset className="auto-label" aria-label="Agent">
              <legend>Agent</legend>
              {agents.length === 0 && <p className="conn-detail">No agent is installed and switched on.</p>}
              {agents.map((a) => (
                <label key={a.id} className="auto-radio">
                  <input type="radio" name="carry-target" checked={target === a.id} onChange={() => setTarget(a.id)} /> {a.name}
                  {a.id === source.agent ? " (this session's agent)" : ""}
                </label>
              ))}
            </fieldset>
            <p className="conn-detail">
              {carryLine(sourceName, target === source.agent)} It opens in {loaded.ctx.dir ?? "the workspace in front"}.{loaded.ctx.trimmed ? " Long conversations are trimmed to fit." : ""}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="conn-detail agentstart-error">
            {error}
          </p>
        )}
        <div className="auto-dialog-foot">
          <button className="btn" onClick={closeCarry}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !loaded?.ctx || target === ""} onClick={() => void go()}>
            {busy ? "Starting…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
