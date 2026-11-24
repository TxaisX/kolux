// The empty chat (2026-11-24, as Open WebUI draws it): the model's name large over its mark, the message box
// centred under it (the pane places the box; it keeps one place in the tree so a typed draft survives),
// and three suggestion chips under the box that fill it rather than send.
import AgentMark from "../../marks/AgentMark";
import { STARTERS, markFor } from "./welcome";

type HeadProps = {
  label: string;
  provider: string;
  /** The process is not up yet. */
  starting: boolean;
};

export function Welcome({ label, provider, starting }: HeadProps) {
  return (
    <div className="chat-welcome-head">
      <span className="chat-welcome-mark" aria-hidden="true">
        <AgentMark id={markFor(provider) ?? provider} size={30} label={label} />
      </span>
      <h2 className="chat-welcome-title">{label}</h2>
      <p className="chat-welcome-line">{starting ? "Starting…" : "Ask in plain words. It works in this folder and shows you what it changes."}</p>
    </div>
  );
}

export function Suggestions({ onFill }: { onFill: (text: string) => void }) {
  return (
    <div className="chat-starters" role="group" aria-label="Things to try">
      {STARTERS.map((s) => (
        <button key={s.label} type="button" onClick={() => onFill(s.text)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
