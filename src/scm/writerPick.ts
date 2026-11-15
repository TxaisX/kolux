// GIT-018 (T-228-d): picking an agent, a model and a thinking effort for commit messages. The pure
// rules behind the Settings > Git controls: which agents are offered, which efforts a
// model takes, and what a change of agent or model resets.
import { WRITER_AGENTS, WRITER_EFFORT_KEY, WRITER_KEY, WRITER_MODEL_KEY } from "./generate";

export type ModelInfo = { id: string; name: string; efforts: string[] };
export type WriterOptions = { agent: string; name: string; installed: boolean; models: ModelInfo[]; efforts: string[]; hint: string | null };

/** The agents the picker offers: the installed ones, plus the one already chosen so the select never shows a blank. */
export function agentChoices(installed: ReadonlySet<string> | null, chosen: string): { id: string; name: string; installed: boolean }[] {
  return WRITER_AGENTS.filter((a) => installed === null || installed.has(a.id) || a.id === chosen).map((a) => ({ ...a, installed: installed === null || installed.has(a.id) }));
}

/** The efforts on offer for `model`: its own list when the CLI gave one, else the agent's. */
export function effortsFor(o: WriterOptions | null, model: string | null): string[] {
  if (o === null) return [];
  const own = o.models.find((m) => m.id === model)?.efforts ?? [];
  return own.length > 0 ? own : o.efforts;
}

/** Changing agent starts the model and effort over (they belong to the old agent). */
export const agentPatch = (agent: string): Record<string, unknown> => ({ [WRITER_KEY]: agent, [WRITER_MODEL_KEY]: "", [WRITER_EFFORT_KEY]: "" });

/** Changing model keeps the effort only when the new model takes it. */
export function modelPatch(o: WriterOptions | null, model: string, effort: string | null): Record<string, unknown> {
  const keep = effort !== null && effortsFor(o, model.trim() === "" ? null : model).includes(effort);
  return keep ? { [WRITER_MODEL_KEY]: model.trim() } : { [WRITER_MODEL_KEY]: model.trim(), [WRITER_EFFORT_KEY]: "" };
}

/** What the model control shows: a list when the CLI gave one, else a free field with the hint. */
export const modelMode = (o: WriterOptions | null): "list" | "free" => (o !== null && o.installed && o.models.length > 0 ? "list" : "free");

/** The line under the controls. */
export function pickerHint(o: WriterOptions | null): string | null {
  if (o === null) return "Reading the agent’s models…";
  return o.hint;
}
