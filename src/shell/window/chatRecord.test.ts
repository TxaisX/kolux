import { expect, test } from "vitest";
import type { Pane } from "../../App";
import { layoutOf, restoreLayout } from "../../terminal/layout";
import { withAutoTitle, withChatSession, withUserTitle } from "./chatRecord";

const chat = (key: number, extra: Partial<Pane> = {}): Pane => ({ key, cwd: "C:\\w\\a", branch: null, agent: "claude", program: "claude", args: [], chat: true, ...extra });
const saved = (p: Pane) => layoutOf([p] as never, {}, p.key, "C:\\w\\a", {});

test("review 2 P2-3: a name typed by the user is marked on the record; the chat's own names are not", () => {
  const typed = withUserTitle([chat(1)], 1, "My taxes")[0];
  expect(typed).toMatchObject({ title: "My taxes", titleByUser: true });
  const auto = withAutoTitle([chat(1)], 1, "Greeting")[0];
  expect(auto.title).toBe("Greeting");
  expect(auto.titleByUser).toBeUndefined();
});

test("review 2 P2-3: an automatic name never replaces one the user chose, and clearing a name clears the mark", () => {
  const ps = [chat(1, { title: "My taxes", titleByUser: true })];
  expect(withAutoTitle(ps, 1, "Greeting")).toBe(ps);
  const cleared = withUserTitle(ps, 1, undefined)[0];
  expect(cleared.title).toBeUndefined();
  expect(cleared.titleByUser).toBeUndefined();
  expect(withAutoTitle([cleared], 1, "Greeting")[0].title).toBe("Greeting");
});

test("review 2 P2-3: the mark survives a restart, and a record saved before it loads as automatic", () => {
  const l = saved(chat(1, { title: "My taxes", titleByUser: true }));
  expect(l.panes[0]).toMatchObject({ title: "My taxes", titleByUser: true });
  expect(restoreLayout(JSON.parse(JSON.stringify(l)))!.panes[0].titleByUser).toBe(true);
  const old = restoreLayout(JSON.parse(JSON.stringify(saved(chat(2, { title: "Old name" })))))!.panes[0];
  expect(old.title).toBe("Old name");
  expect(old.titleByUser).toBeUndefined();
});

test("review 2 P2-4: a chat continued in OpenCode keeps the old Claude id in its own field", () => {
  const ps = [chat(1, { chatResume: "0b1c2d3e-aaaa-bbbb-cccc-000000000000" })];
  const next = withChatSession(ps, 1, "ses_new", "0b1c2d3e-aaaa-bbbb-cccc-000000000000")[0];
  expect(next).toMatchObject({ chatResume: "ses_new", chatLegacy: "0b1c2d3e-aaaa-bbbb-cccc-000000000000" });
  const l = saved(next);
  expect(l.panes[0]).toMatchObject({ chatResume: "ses_new", chatLegacy: "0b1c2d3e-aaaa-bbbb-cccc-000000000000" });
  expect(restoreLayout(JSON.parse(JSON.stringify(l)))!.panes[0]).toMatchObject({ chatResume: "ses_new", chatLegacy: "0b1c2d3e-aaaa-bbbb-cccc-000000000000" });
});

test("review 2 P2-4: a new chat or an opened one drops the old Claude id; an unchanged report returns the same list", () => {
  const ps = [chat(1, { chatResume: "ses_new", chatLegacy: "old-claude" })];
  expect(withChatSession(ps, 1, "ses_new", "old-claude")).toBe(ps);
  const opened = withChatSession(ps, 1, "ses_other", null)[0];
  expect(opened.chatResume).toBe("ses_other");
  expect(opened.chatLegacy).toBeUndefined();
  const fresh = withChatSession(ps, 1, null, null)[0];
  expect(fresh.chatResume).toBeUndefined();
  expect(fresh.chatLegacy).toBeUndefined();
});

test("round 3 P3: leaving a chat takes its automatic name away, and never a name the user chose", () => {
  const auto = [chat(1, { title: "Greeting" })];
  const gone = withAutoTitle(auto, 1, null);
  expect(gone[0].title).toBeUndefined();
  expect(withAutoTitle(gone, 1, null)).toBe(gone);
  const mine = [chat(1, { title: "My taxes", titleByUser: true })];
  expect(withAutoTitle(mine, 1, null)).toBe(mine);
});
