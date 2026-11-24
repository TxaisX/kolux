import { expect, test } from "vitest";
import {
  EVERYDAY_CHATS_FIELD,
  dropEverydayChat,
  everydayChatName,
  everydayChatsOf,
  newEverydayChat,
  putEverydayChat,
  readEverydayChats,
  setEverydayChoice,
  setEverydayName,
  setEverydayUserName,
  setEverydaySession,
  touchEverydayChat,
  type EverydayChat,
} from "./everydayChats";

const rec = (id: string, over: Partial<EverydayChat> = {}): EverydayChat => ({ id, agent: "claude", cwd: "C:\\Users\\X\\Kolux\\Everyday", at: 1, ...over });

test("kept chats are read back newest first, and a broken record is dropped rather than drawn", () => {
  const list = readEverydayChats({
    everydayChats: [
      { id: "a", agent: "claude", cwd: "C:\\E", at: 10 },
      { id: "b", agent: "opencode", cwd: "C:\\E", model: "sun", session: "s-1", name: "Taxes", at: 30 },
      { id: "a", agent: "claude", cwd: "C:\\E", at: 20 }, // one row per id: the first wins
      { id: "c", agent: "claude" }, // no folder
      { id: "", agent: "claude", cwd: "C:\\E" }, // no id
      { id: "d", cwd: "C:\\E" }, // no agent
      "nope",
      null,
    ],
  });
  expect(list.map((c) => c.id)).toEqual(["b", "a"]);
  expect(list[0]).toMatchObject({ agent: "opencode", model: "sun", session: "s-1", name: "Taxes" });
  expect(list[1].at).toBe(10);
});

test("a missing or malformed list reads as none", () => {
  expect(readEverydayChats({})).toEqual([]);
  expect(readEverydayChats({ everydayChats: "x" })).toEqual([]);
  expect(everydayChatsOf(undefined)).toEqual([]);
  expect(everydayChatsOf([{ id: "a", agent: "claude", cwd: "C:\\E", at: 1 }]).map((c) => c.id)).toEqual(["a"]);
});

test("a new record names its AI, folder and model, and never reuses an id", () => {
  const a = newEverydayChat("claude", "C:\\E", null, 1000);
  const b = newEverydayChat("claude", "C:\\E", null, 1000);
  expect(a).toMatchObject({ agent: "claude", cwd: "C:\\E", at: 1000 });
  expect(a.model).toBeUndefined();
  expect(a.name).toBeUndefined();
  expect(a.session).toBeUndefined();
  expect(a.id).not.toBe(b.id);
  expect(newEverydayChat("opencode", "C:\\E", "sun", 2).model).toBe("sun");
});

test("put adds a chat first and replaces one in place; an unchanged list comes back as it was", () => {
  const a = rec("a", { at: 20 });
  const b = rec("b", { at: 10 });
  const list = [a, b];
  expect(putEverydayChat(list, rec("c", { at: 30 })).map((c) => c.id)).toEqual(["c", "a", "b"]);
  expect(putEverydayChat(list, rec("b", { at: 10 })).map((c) => c.id)).toEqual(["a", "b"]);
  const same = putEverydayChat(list, { ...b });
  expect(same).toBe(list);
});

test("review 2 P2-4: a Claude chat continued on OpenCode keeps its old id in its own field, which reads back", () => {
  const list = [rec("a", { session: "0b1c2d3e-old" })];
  const next = setEverydaySession(list, "a", "ses_new", "0b1c2d3e-old");
  expect(next[0]).toMatchObject({ session: "ses_new", legacy: "0b1c2d3e-old" });
  expect(setEverydaySession(next, "a", "ses_new", "0b1c2d3e-old")).toBe(next);
  expect(readEverydayChats({ [EVERYDAY_CHATS_FIELD]: JSON.parse(JSON.stringify(next)) })[0]).toMatchObject({ session: "ses_new", legacy: "0b1c2d3e-old" });
  // Opening another chat on the row, or leaving the field out, clears or keeps it as asked.
  expect(setEverydaySession(next, "a", "ses_other", null)[0].legacy).toBeUndefined();
  expect(setEverydaySession(next, "a", "ses_other")[0].legacy).toBe("0b1c2d3e-old");
});

test("a session id and a name land on the one chat, and a no-op returns the same list", () => {
  const list = [rec("a"), rec("b")];
  const withSession = setEverydaySession(list, "b", "s-9");
  expect(withSession[0].session).toBeUndefined();
  expect(withSession[1].session).toBe("s-9");
  expect(setEverydaySession(withSession, "b", "s-9")).toBe(withSession);
  expect(setEverydaySession(list, "b", "")).toBe(list);
  expect(setEverydaySession(list, "gone", "s-9")).toBe(list);
  const named = setEverydayName(list, "a", "  Taxes  ");
  expect(named[0].name).toBe("Taxes");
  expect(setEverydayName(named, "a", "Taxes")).toBe(named);
  expect(setEverydayName(list, "a", "   ")).toBe(list);
});

test("a model or effort picked in the chat lands on the one record, and a no-op returns the same list", () => {
  const list = [rec("a", { model: "sun", effort: "low" }), rec("b")];
  const onB = setEverydayChoice(list, "b", { model: "anthropic/claude-opus-5.5", effort: "high" });
  expect(onB[0].model).toBe("sun");
  expect(onB[1]).toMatchObject({ model: "anthropic/claude-opus-5.5", effort: "high" });
  expect(setEverydayChoice(onB, "b", { model: "anthropic/claude-opus-5.5" })).toBe(onB);
  // A model pick alone leaves the effort as it was; null means the agent's own default, written as no model.
  const effortOnly = setEverydayChoice(onB, "a", { effort: "max" });
  expect(effortOnly[0]).toMatchObject({ model: "sun", effort: "max" });
  const cleared = setEverydayChoice(onB, "b", { model: null });
  expect(cleared[1].model).toBeUndefined();
  expect(cleared[1].effort).toBe("high");
  expect(setEverydayChoice(list, "gone", { model: "x" })).toBe(list);
});

test("touch moves a used chat to the top with the time it was used", () => {
  const list = [rec("a", { at: 20 }), rec("b", { at: 10 })];
  const used = touchEverydayChat(list, "b", 99);
  expect(used.map((c) => c.id)).toEqual(["b", "a"]);
  expect(used[0].at).toBe(99);
  expect(touchEverydayChat(list, "gone", 99)).toBe(list);
});

test("drop takes one chat out, and says so by returning a new list", () => {
  const list = [rec("a"), rec("b")];
  expect(dropEverydayChat(list, "a").map((c) => c.id)).toEqual(["b"]);
  expect(dropEverydayChat(list, "gone")).toBe(list);
});

test("an unnamed chat reads as New chat until its first message names it", () => {
  expect(everydayChatName(rec("a"))).toBe("New chat");
  expect(everydayChatName(rec("a", { name: "Taxes" }))).toBe("Taxes");
});

test("the settings key is the one the window writes", () => {
  expect(EVERYDAY_CHATS_FIELD).toBe("everydayChats");
});

test("round 3 P2: a name the user chose is marked, reads back, and the chat's own names never replace it", () => {
  const list = [rec("a", { name: "Auto" })];
  const mine = setEverydayUserName(list, "a", "My taxes");
  expect(mine[0]).toMatchObject({ name: "My taxes", nameByUser: true });
  // the settings file round trip keeps the mark
  expect(readEverydayChats({ everydayChats: JSON.parse(JSON.stringify(mine)) })[0].nameByUser).toBe(true);
  // an automatic name over a user's name is ignored
  expect(setEverydayName(mine, "a", "Something OpenCode said")).toBe(mine);
  // clearing the user's name hands the row back to the chat
  const cleared = setEverydayUserName(mine, "a", undefined);
  expect(cleared[0].nameByUser).toBeUndefined();
  expect(setEverydayName(cleared, "a", "Auto again")[0].name).toBe("Auto again");
  // a user name with no text is not a name
  expect(setEverydayUserName(list, "a", "  ")).toBe(list);
});
