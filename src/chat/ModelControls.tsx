// Native chat, the model and effort controls beside Send (CHAT-024; T-334). The rules are in controls.ts.
import { useEffect, useRef } from "react";
import { LAUNCH_NOTE, TERMINAL_NOTE, choicesFor, effortsFor, fastOffered, routeOf, statusOf, statusText, type Change, type Choice, type What } from "./controls";
import { Select } from "../ui/Select";

type Props = {
  agent: string;
  /** The model the agent shows, read from its output; null until known. */
  shown: string | null;
  /** The choices saved for the next launch. */
  saved: Choice;
  changes: readonly Change[];
  disabled: boolean;
  /** Counts up when a bare /model asks for the picker: the model list takes focus. */
  openPicker: number;
  onModel: (id: string) => void;
  onEffort: (level: string) => void;
  onFast: (on: boolean) => void;
};

export function ModelControls({ agent, shown, saved, changes, disabled, openPicker, onModel, onEffort, onFast }: Props) {
  const select = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (openPicker > 0) select.current?.focus();
  }, [openPicker]);
  const choices = choicesFor(agent);
  const model = statusOf(changes, "model");
  const effort = statusOf(changes, "effort");
  const modelValue = model?.value ?? shown ?? saved.model ?? "";
  const efforts = effortsFor(agent, modelValue || undefined);
  const effortValue = effort?.value ?? saved.effort ?? "";
  const fast = fastOffered(agent, modelValue || undefined);
  const note = (what: What) => (routeOf(agent, what) === "launch" ? LAUNCH_NOTE : routeOf(agent, what) === "terminal" ? TERMINAL_NOTE : undefined);
  return (
    <div className="chat-controls" role="group" aria-label="Model and effort">
      <label className="chat-control">
        <span>Model</span>
        <Select
          controlRef={select}
          label="Model"
          className=""
          disabled={disabled}
          value={modelValue}
          title={note("model")}
          onChange={(v) => v && onModel(v)}
          options={[...(modelValue === "" ? [{ value: "", label: shown === null ? "Not read yet" : "Pick a model" }] : []), ...choices.map((c) => ({ value: c.id, label: `${c.label}${c.id === shown ? " (in use)" : ""}` }))]}
        />
        {statusText(model) && <small className={`chat-control-status ${model?.status}`} role="status">{statusText(model)}</small>}
      </label>
      {efforts.length > 0 && (
        <label className="chat-control">
          <span>Effort</span>
          <Select
            label="Effort"
            className=""
            disabled={disabled}
            value={effortValue}
            title={note("effort")}
            onChange={(v) => v && onEffort(v)}
            options={[...(effortValue === "" ? [{ value: "", label: "Model default" }] : []), ...efforts.map((l) => ({ value: l, label: l }))]}
          />
          {routeOf(agent, "effort") === "launch" && <small className="chat-control-status">At next launch</small>}
          {statusText(effort) && <small className={`chat-control-status ${effort?.status}`} role="status">{statusText(effort)}</small>}
        </label>
      )}
      {fast && (
        <div className="chat-control" role="group" aria-label="Fast mode" title={note("fast")}>
          <span>Fast</span>
          {/* The current value is not read from the agent, so neither button is shown pressed until the user picks one. */}
          <button type="button" aria-pressed={saved.fast === true} disabled={disabled} onClick={() => onFast(true)}>On</button>
          <button type="button" aria-pressed={false} disabled={disabled} onClick={() => onFast(false)}>Off</button>
          <small className="chat-control-status">At next launch</small>
        </div>
      )}
    </div>
  );
}
