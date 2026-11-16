// The Changes tab discards one row at a time (one path, or both names of one staged rename), so an engine error
// mostly means that row was not discarded. A row the engine left on purpose says "so Kolux leaves"; anything else
// (Git's own error, a failed removal) is a plain "could not".
import { expect, test } from "vitest";
import { discardSay } from "./AllChangesPane";
import source from "./AllChangesPane.tsx?raw";

const A = "C:/r/lib is a link to another folder, so Kolux leaves lib/a.txt. Remove the link by hand, then discard again.";
const B = "C:/r/out is now a file, so Kolux leaves out/b.txt. Remove or move that file by hand, then discard again.";
const D = "notes.txt is now a folder, so Kolux leaves it. Remove or move the folder by hand, then discard again.";
const OWN = "vendor/tool is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.";
const GIT = "error: pathspec 'x.txt' did not match any file(s) known to git";

test.each([
  ["A, a link", A],
  ["B, now a file", B],
  ["D, now a folder", D],
  ["its own repository", OWN],
  ["two kept lines", `${A}\n${D}`],
])("a row the engine left on purpose (%s) reads 'Kolux left this as it is:', each line on its own", (_, err) => {
  const say = discardSay(err, "notes.txt");
  const lines = say.text.split("\n");
  expect(lines[0]).toBe("Kolux left this as it is:");
  expect(lines.slice(1)).toEqual(err.split("\n"));
  // R74-05: a row left on purpose needs attention (yellow, `note warn`), it is not an error.
  expect(say.bad).toBe(true);
  expect(say.error).toBeFalsy();
});

test.each([
  ["Git's own line", GIT],
  ["a kept line and a Git line", `${D}\n${GIT}`],
  ["a failed removal", "notes.txt: Access is denied."],
])("any other error (%s) reads 'Could not discard <file>:', each line on its own", (_, err) => {
  const say = discardSay(err, "x.txt");
  const lines = say.text.split("\n");
  expect(lines[0]).toBe("Could not discard x.txt:");
  expect(lines.slice(1)).toEqual(err.split("\n"));
  expect(say.bad).toBe(true);
  expect(say.error, "a real failure is red").toBe(true);
});

test("the page never claims that nothing, or not everything, was discarded", () => {
  for (const err of [A, OWN, GIT, `${D}\n${GIT}`]) expect(discardSay(err, "x.txt").text).not.toMatch(/not everything|nothing was|failed/i);
});

test("the result line keeps the engine's line breaks when it is drawn", () => {
  // Kept as a source pin: the line is drawn only after a real Discard, which this house pattern does not drive.
  expect(source).toMatch(/role=\{outcome\.bad \? "alert" : "status"\} style=\{\{ whiteSpace: "pre-line"/);
});

test("R74-05: the result line draws an error red (note error) and any other bad line yellow (note warn)", () => {
  expect(source).toContain('className={`note${outcome.error ? " error" : outcome.bad ? " warn" : ""}`}');
});
