// GIT-018 (T-228-d): who writes commit messages: an installed agent with its model (listed from the
// installed CLI) and thinking effort, a custom command, or nobody.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WRITER_COMMAND_KEY, WRITER_EFFORT_KEY, WRITER_KEY, writerName, writerOf } from "./generate";
import { listFor, rememberPatch, rememberedLists, sourceNote } from "../settings/writerModels";
import { agentChoices, agentPatch, effortsFor, modelMode, modelPatch, pickerHint, type WriterOptions } from "./writerPick";
import { Select } from "../ui/Select";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => unknown };

export default function WriterPicker({ settings, save }: Props) {
  const writer = writerOf(settings);
  const stored = settings[WRITER_KEY];
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const [raw, setOptions] = useState<WriterOptions | null>(null);
  useEffect(() => {
    invoke<{ id: string; installed: boolean }[]>("agent_list").then(
      (l) => setInstalled(new Set(l.filter((a) => a.installed).map((a) => a.id))),
      () => setInstalled(null),
    );
  }, []);
  const agent = writer.mode === "agent" ? writer.agent : null;
  useEffect(() => {
    setOptions(null);
    if (agent === null) return;
    let live = true;
    invoke<WriterOptions>("scm_writer_options", { agent }).then(
      (o) => live && setOptions(o),
      (e) => live && setOptions({ agent, name: writerName(agent), installed: false, models: [], efforts: [], hint: String(e) }),
    );
    return () => {
      live = false;
    };
  }, [agent]);
  // ACCT-033: the installed tool's list when it answers, else the list it gave last time, else a built-in one.
  const shown = raw === null ? null : listFor(raw, rememberedLists(settings));
  const options = shown === null ? null : shown.options;
  const note = shown !== null && raw !== null && raw.installed && shown.source !== "installed" ? sourceNote(shown.source, raw.name) : null;
  useEffect(() => {
    const p = raw === null ? null : rememberPatch(raw, rememberedLists(settings));
    if (p !== null) void save(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const efforts = effortsFor(options, writer.model);
  const mode = modelMode(options);
  return (
    <>
      <div className="look-select">
        <span>Written by</span>
        <Select
          label="commit message writer"
          value={stored === "custom" || stored === "off" ? String(stored) : (agent ?? "claude")}
          onChange={(v) => void save(v === "custom" || v === "off" ? { [WRITER_KEY]: v } : agentPatch(v))}
          options={[...agentChoices(installed, agent ?? "claude").map((a) => ({ value: a.id, label: `${a.name}${a.installed ? "" : " (not installed)"}` })), { value: "custom", label: "Custom command" }, { value: "off", label: "Off: no generate button" }]}
        />
      </div>
      {agent !== null && (
        <>
          <div className="look-select">
            <span>Model</span>
            {mode === "list" ? (
              <Select label="commit message model" value={writer.model ?? ""} onChange={(v) => void save(modelPatch(options, v, writer.effort))} options={[
                { value: "", label: `Default${agent === "claude" ? " (Sonnet)" : ""}` },
                ...(writer.model !== null && !options?.models.some((m) => m.id === writer.model) ? [{ value: writer.model, label: writer.model }] : []),
                ...(options?.models.map((m) => ({ value: m.id, label: m.name })) ?? []),
              ]} className="field" />
            ) : (
              <input
                key={writer.model ?? ""}
                aria-label="commit message model"
                className="field"
                placeholder="Default"
                defaultValue={writer.model ?? ""}
                onBlur={(e) => e.target.value.trim() !== (writer.model ?? "") && void save(modelPatch(options, e.target.value, writer.effort))}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            )}
          </div>
          {efforts.length > 0 && (
            <div className="look-select">
              <span>Thinking effort</span>
              <Select label="commit message effort" value={writer.effort ?? ""} onChange={(v) => void save({ [WRITER_EFFORT_KEY]: v })} options={[
                { value: "", label: "Default" },
                ...(writer.effort !== null && !efforts.includes(writer.effort) ? [{ value: writer.effort, label: writer.effort }] : []),
                ...efforts.map((l) => ({ value: l, label: l })),
              ]} className="field" />
            </div>
          )}
          {(note ?? pickerHint(options)) && (
            <p className="conn-detail" data-writer-hint>
              {note ?? pickerHint(options)}
            </p>
          )}
        </>
      )}
      {stored === "custom" && (
        <>
          <input
            key={String(settings[WRITER_COMMAND_KEY] ?? "")}
            aria-label="custom commit message command"
            className="field"
            placeholder="e.g. my-writer --text {prompt}"
            defaultValue={String(settings[WRITER_COMMAND_KEY] ?? "")}
            onBlur={(e) => e.target.value !== String(settings[WRITER_COMMAND_KEY] ?? "") && void save({ [WRITER_COMMAND_KEY]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <p className="conn-detail">The prompt goes wherever <code>{"{prompt}"}</code> appears in the command, or on its standard input when it does not. Put quotes around a word with spaces in it; backslashes are kept as typed.</p>
        </>
      )}
    </>
  );
}
