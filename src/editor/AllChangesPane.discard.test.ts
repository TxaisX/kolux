// A Discard that kept some rows is not "failed": the engine keeps a row on purpose (a file that is now a folder, a
// nested Git repository) and still discards the others, and says so in one line per row it kept or could not remove.
import { expect, test } from "vitest";
import { discardSay } from "./AllChangesPane";
import source from "./AllChangesPane.tsx?raw";

test("a Discard error starts 'Not everything was discarded:' and shows each of the engine's lines on its own line", () => {
  const err = "foo is now a folder, so Kolux leaves it. Remove or move the folder by hand if you want the file back.\nbar.txt: Access is denied.";
  const say = discardSay(err);
  const lines = say.text.split("\n");
  expect(lines[0]).toBe("Not everything was discarded:");
  expect(lines.slice(1)).toEqual(err.split("\n"));
  expect(say.text).not.toMatch(/failed/i);
  // The result line keeps the engine's line breaks when it is drawn.
  expect(source).toMatch(/role=\{outcome\.bad \? "alert" : "status"\} style=\{\{ whiteSpace: "pre-line"/);
});
