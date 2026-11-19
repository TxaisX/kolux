import { expect, test } from "vitest";
import { lastPart, moveFolder, offerFrom, queueOffer, renamesFolders } from "./folderRename";

const answer = (over: Record<string, unknown> = {}) => ({ renamed: true, reason: null, old: "tx/amber-otter", branch: "tx/fix-login", name: "Fix login", tracking: null, folder: "fix-login", ...over });

test("T-110-b: a renamed branch with a folder proposal asks; a refusal, a failure or no proposal asks nothing", () => {
  expect(offerFrom({ dir: "G:/ws/p/amber-otter", answer: answer(), error: null })).toEqual({ dir: "G:/ws/p/amber-otter", folder: "fix-login", name: "Fix login" });
  expect(offerFrom({ dir: "d", answer: answer({ folder: null }), error: null })).toBeNull();
  expect(offerFrom({ dir: "d", answer: answer({ renamed: false, reason: "pushed" }), error: null })).toBeNull();
  expect(offerFrom({ dir: "d", answer: null, error: "fatal: lock" })).toBeNull();
  expect(offerFrom({ dir: "d", answer: answer({ name: null }), error: null })?.name).toBe("fix-login");
});

test("T-110-b: offers queue one at a time and a later offer for the same folder replaces the earlier", () => {
  const a = { dir: "a", folder: "x", name: "X" };
  const b = { dir: "b", folder: "y", name: "Y" };
  const q = queueOffer(queueOffer([], a), b);
  expect(q.map((o) => o.dir)).toEqual(["a", "b"]);
  expect(queueOffer(q, { dir: "a", folder: "z", name: "Z" }).map((o) => o.folder)).toEqual(["y", "z"]);
});

test("T-110-b: the move calls the back end with the folder and its new name; a refusal comes back whole", async () => {
  const calls: unknown[] = [];
  const ok = (cmd: string, args?: unknown) => (calls.push([cmd, args]), Promise.resolve("G:\\ws\\p\\fix-login" as never));
  await expect(moveFolder("G:\\ws\\p\\amber-otter", "fix-login", ok as never)).resolves.toBe("G:\\ws\\p\\fix-login");
  expect(calls).toEqual([["workspace_move_folder", { path: "G:\\ws\\p\\amber-otter", name: "fix-login" }]]);
  const refused = () => Promise.reject("fatal: failed to move 'G:/ws/p/amber-otter' to 'G:/ws/p/fix-login': Permission denied");
  await expect(moveFolder("d", "n", refused as never)).rejects.toMatch(/Permission denied/);
  expect(lastPart("G:\\ws\\p\\amber-otter\\")).toBe("amber-otter");
  expect(lastPart("G:/ws/p/amber-otter")).toBe("amber-otter");
});

test("T-110-b: folder renaming is on unless switched off", () => {
  expect(renamesFolders({})).toBe(true);
  expect(renamesFolders({ renameFolders: true })).toBe(true);
  expect(renamesFolders({ renameFolders: false })).toBe(false);
});
