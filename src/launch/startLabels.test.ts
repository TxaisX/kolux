// Job 50 item 1a: the palette's Quick actions row runs addChooser, which opens the Start form on the New look
// (paneActions.ts: `if (!classic) return openStart(...)`) and adds a chooser pane on the Classic look, so its
// label follows the look.
import { expect, test } from "vitest";
import paneActions from "../terminal/paneActions.ts?raw";

test("job 50: the palette row says Start agents on the New look and New session on the Classic look", () => {
  expect(paneActions).toContain("if (!classic) return openStart({ here: true });");
  expect(paneActions).toContain('{ section: "Quick actions", label: classic ? "New session" : "Start agents", run: () => addChooser() }');
});
