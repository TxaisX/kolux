// AUTO-001 box 2, the window half: a custom cron line the back end refuses (61 in the minute field,
// src-tauri/tests/cards_09.rs auto001_box2) leaves Save off and shows the reason. The real AutomationDialog
// runs with its state kept by shallow-react.ts. MIRROR AutomationDialog.tsx preview effect: the refusal text
// is seeded into the previewError slot where the effect's catch puts it.
import { expect, test, vi } from "vitest";
import AutomationDialog from "../AutomationDialog";
import { find, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>()));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

const projects = [{ id: "p1", name: "shop", path: "C:\src\shop", base: "main" }];
const trees = [{ path: "C:\src\shop", branch: "main", isMain: true }];
const save = (tree: El) => find(tree, (e) => e.type === "button" && textOf(e).startsWith("Sav"));

test("box 2: a custom line with 61 in the minute field leaves Save off and says why", () => {
  const editing = { id: "auto-1", name: "Hourly", prompt: "x", provider: "claude", projectId: "p1", enabled: true, workspaceMode: "existing", workspace: "C:\src\shop", trigger: { kind: "schedule", cron: "61 * * * *", timezone: "UTC" }, form: { preset: "custom", time: "", day: null, custom: "61 * * * *" } };
  const props = { projects, agents: [], editing, onClose: () => {}, onSaved: () => {} } as never;
  // Worktrees read, no refusal yet: Save is on.
  expect(save(mount(AutomationDialog, props, { 15: trees }).render()).props.disabled).toBe(false);
  // The back end's refusal arrives (the text of cards_09 auto001_box2): Save is off and the message shows.
  const view = mount(AutomationDialog, props, { 15: trees, 18: "the minute field has 61; it takes 0 to 59" });
  const tree = view.render();
  expect(save(tree).props.disabled).toBe(true);
  const alert = find(tree, (e) => e.props.role === "alert");
  expect(textOf(alert)).toBe("Invalid: the minute field has 61; it takes 0 to 59");
});
