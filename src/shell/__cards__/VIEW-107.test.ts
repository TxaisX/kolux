// VIEW-107 acceptance: three open tabs survive a quit (layoutOf -> saved JSON -> restoreLayout -> stillThere), and
// the quit question names unsaved editor files. MIRROR src/App.tsx:1566 (layoutOf in the save effect), src/main.tsx:54-70 (restore pipeline).
import { expect, test } from "vitest";
import { sessionOrder } from "../../sessions/restoreOrder";
import { layoutOf, restoreLayout, stillThere } from "../../terminal/layout";
import { losable, quitQuestion } from "../closeAsk";

const tab = (key: number, agent: "claude" | "codex" | "shell") => ({ key, cwd: "C:/w/app", branch: "main", agent, program: null, args: [] as string[] });

test("box 1: three tabs written down at quit come back as the same three tabs, in order, with the active one", () => {
  const live = [tab(1, "claude"), tab(2, "codex"), tab(3, "shell")];
  const saved = layoutOf(live, 2, "C:/w/app", {});
  expect(saved.panes.map((p) => p.key)).toEqual([1, 2, 3]);
  // the settings file is JSON: write it, read it back, apply the folder check main.tsx makes
  const back = stillThere(restoreLayout(JSON.parse(JSON.stringify(saved))) as NonNullable<ReturnType<typeof restoreLayout>>, () => true);
  expect(back.panes.map((p) => [p.key, p.agent, p.cwd])).toEqual([[1, "claude", "C:/w/app"], [2, "codex", "C:/w/app"], [3, "shell", "C:/w/app"]]);
  expect(back.focused).toBe(2);
  expect(back.activeDir).toBe("C:/w/app");
  expect(sessionOrder(back.panes).map((p) => p.key)).toEqual([1, 2, 3]);
});

test("box 2 (the question's content only; the close event is LIVE): unsaved editor files are listed and quitting says it loses them", () => {
  expect(losable([], [])).toBeNull();
  const l = losable(["notes.md"], []);
  expect(l).toEqual({ files: ["notes.md"], agents: [] });
  const q = quitQuestion(l as NonNullable<typeof l>);
  expect(q.title).toBe("Quit with unsaved changes?");
  expect(q.body).toContain("1 file has unsaved changes: notes.md. Quitting now loses them.");
  expect(q.confirm).toBe("Quit without saving");
});
