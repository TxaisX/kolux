// EDIT-040: the Handoff section at the foot of the right sidebar: a folded note that belongs to
// the workspace in front alone, saved a moment after typing stops and whenever focus leaves, with
// Hand to agent, which starts the chosen agent in a new tab with the note as its first prompt and
// adds a dated line saying who received it.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../launch/PlusMenu";
import { handedLine, sinceText, type Note } from "./model";
import { Select } from "../ui/Select";

type Props = {
  dir: string;
  /** The agents found on this machine, the default first. */
  agents: AgentInfo[];
  onHand: (agent: AgentInfo, note: string) => void;
};

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; text: string };

export default function HandoffNote({ dir, agents, onHand }: Props) {
  const [text, setText] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const [agentId, setAgentId] = useState("");
  const [now, setNow] = useState(Date.now());
  const shown = useRef(dir);
  const pending = useRef<{ dir: string; text: string } | null>(null);
  const timer = useRef(0);

  /** Writes the waiting text, for the workspace it was typed in even after a switch. */
  const flush = async () => {
    const p = pending.current;
    window.clearTimeout(timer.current);
    if (!p) return;
    pending.current = null;
    if (p.dir === shown.current) setSaving({ kind: "saving" });
    try {
      const at = await invoke<number>("workspace_note_save", { path: p.dir, text: p.text });
      if (p.dir === shown.current) {
        setUpdated(at);
        setSaving({ kind: "saved" });
      }
    } catch (err) {
      if (p.dir === shown.current) setSaving({ kind: "error", text: String(err) });
    }
  };

  useEffect(() => {
    shown.current = dir;
    setText("");
    setUpdated(null);
    setSaving({ kind: "idle" });
    invoke<Note>("workspace_note_get", { path: dir })
      .then((n) => {
        if (shown.current !== dir) return;
        setText(n.text);
        setUpdated(n.updated);
      })
      .catch(() => {});
    return () => void flush();
  }, [dir]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const change = (value: string) => {
    setText(value);
    pending.current = { dir, text: value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };
  const agent = agents.find((a) => a.id === agentId) ?? agents[0] ?? null;
  const hand = () => {
    if (!agent || !text.trim()) return;
    onHand(agent, text);
    const next = handedLine(text, agent.name, new Date());
    setText(next);
    pending.current = { dir, text: next };
    void flush();
  };

  const status =
    saving.kind === "saving" ? "Saving…" : saving.kind === "saved" ? "Saved" : saving.kind === "error" ? `Not saved: ${saving.text}` : updated !== null ? sinceText(updated, now) : "";
  return (
    <details className="scm-handoff" data-handoff>
      <summary>
        <span>Handoff</span>
        <span className={saving.kind === "error" ? "state error" : "state"} role="status">
          {status}
        </span>
      </summary>
      <textarea aria-label="handoff note" className="field multi" placeholder="What the next person or agent should know about this workspace" value={text} onChange={(e) => change(e.target.value)} onBlur={() => void flush()} />
      <div className="btn-row">
        <Select label="agent to hand to" value={agent?.id ?? ""} onChange={(v) => setAgentId(v)} options={[...(agents.length === 0 ? [{ value: "", label: "No agent found" }] : []), ...agents.map((a) => ({ value: a.id, label: a.name }))]} className="field" disabled={agents.length === 0} />
        <button className="btn" disabled={!agent || !text.trim()} title={text.trim() ? undefined : "Write a note first"} onClick={hand}>
          Hand to agent…
        </button>
      </div>
    </details>
  );
}
