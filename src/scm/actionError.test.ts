// C10-R4-01: a stage, discard or abort the back end rejects keeps its message on screen. The
// reload that always follows an action used to write the same slot, so the message painted for one
// frame at most; the two slots are now written apart and the action's line is announced.
import { expect, test } from "vitest";
import { emptyStatus, type Status } from "./model";
import { afterReload, noErrors, type PanelErrors } from "./rules";
import src from "./SourceControlPanel.tsx?raw";

const pushed: Status = { ...emptyStatus, branch: "feat", upstream: "origin/feat", base: "origin/main" };
const between = (from: string, to: string) => {
  const at = src.indexOf(from);
  return at < 0 ? "" : src.slice(at, src.indexOf(to, at));
};

test("C10-R4-01: the reload that follows a failed action leaves its message alone", () => {
  // what `guarded`'s catch wrote, then what `finally`'s load(true) writes when the read succeeds
  const failed: PanelErrors = { ...noErrors, action: "git could not stage src/a.ts" };
  const reloaded = afterReload(failed, pushed);
  expect(reloaded.action).toBe("git could not stage src/a.ts");
  expect(reloaded.read).toBeNull();
  // a reload that also fails adds its own line; neither replaces the other
  expect(afterReload(failed, { error: "git busy" })).toEqual({ action: "git could not stage src/a.ts", read: "git busy" });
  // an action that succeeded leaves nothing behind
  expect(afterReload(noErrors, pushed)).toEqual(noErrors);
});

test("C10-R4-01: the catch and the reload write different slots, and the action's line is announced", () => {
  const guarded = between("const guarded", "const abortOp");
  expect(guarded).toContain('setErrs((e) => ({ ...e, action: String(err) }))');
  expect(guarded).not.toContain("setErrs(noErrors)");
  const load = between("const load = useCallback", "useEffect(() => {");
  expect(load).toContain("setErrs((e) => afterReload(e, got));");
  expect(load).not.toContain("action:");
  expect(src).toContain('role="alert" data-action-error');
});
