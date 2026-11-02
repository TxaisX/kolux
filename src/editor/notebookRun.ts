// EDIT-024 (T-316-b): what pressing Run on a notebook cell does, apart from the screen so it can be tested.
// The order is fixed: ask whether the notebook is trusted (once; a no leaves everything untouched), save the
// notebook as it stands, run the cell (Rust re-checks the trust itself and reads the saved file), then put the
// outputs into the notebook. Nothing here runs code: `invoke` does, in Rust.
import { serialize, withOutputs, type Notebook } from "./notebook";

/** What Rust's notebook_run_cell answers with. */
export type CellRun = { outputs: unknown[]; execution_count: number };

export type RunDeps = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  /** Shows "Trust this notebook?"; true when the user agrees. */
  ask: () => Promise<boolean>;
  /** Puts the notebook's new text into the tab (the page's buffer). */
  onText: (text: string) => void;
  /** Writes the tab to disk; false when it was not written. Rust reads the file, so the run waits for this. */
  save: () => Promise<boolean>;
  /** The notebook as the tab holds it now (the user may have kept typing while the cell ran). */
  current: () => Notebook | null;
};

export type RunOutcome = "ran" | "declined" | "skipped";

export const TRUST_TITLE = "Trust this notebook?";
export const TRUST_BODY = "Running its cells runs code on this computer.";

/** Runs cell `index` of `nb` (the notebook at `path`). Throws with a plain message when something fails. */
export async function runCell(path: string, nb: Notebook, index: number, deps: RunDeps): Promise<RunOutcome> {
  if (nb.cells[index]?.cell_type !== "code") return "skipped";
  if (!(await deps.invoke<boolean>("notebook_trusted", { path }))) {
    if (!(await deps.ask())) return "declined";
    await deps.invoke("notebook_trust", { path });
  }
  deps.onText(serialize(nb));
  if (!(await deps.save())) throw new Error("The notebook could not be saved, so the cell was not run.");
  const run = await deps.invoke<CellRun>("notebook_run_cell", { path, index });
  // ponytail: a cell moved or removed while it ran takes the outputs of whichever cell now sits at `index`
  // (or none); matching on the cell's id would close that, at the cost of notebooks that have no ids.
  deps.onText(serialize(withOutputs(deps.current() ?? nb, index, run.outputs, run.execution_count)));
  return "ran";
}
