// lazy/uiMenu: src/ui's Menu read on first open. Before the code is in, an open menu draws nothing (and no row draws
// outside one); once read, Menu and MenuItem are src/ui's own, with the same props.
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import * as Ui from "../ui/Menu";
import { ContextMenu, Menu, MenuItem } from "./uiMenu";

test("an on-demand menu draws nothing until its code is read, then is src/ui's Menu with its rows", async () => {
  expect(renderToString(<MenuItem>x</MenuItem>), "a row before the code is in").toBe("");
  expect(renderToString(<ContextMenu at={{ x: 1, y: 2 }} onClose={() => {}} label="Row"><MenuItem>x</MenuItem></ContextMenu>)).toBe("");
  await Menu.read();
  const row = MenuItem({ title: "t", onClick: () => {}, children: "x" });
  expect(row?.type, "a row is src/ui's MenuItem once read").toBe(Ui.MenuItem);
  expect(row?.props).toMatchObject({ title: "t", children: "x" });
  // A closed menu draws nothing, exactly as src/ui's does (the server render marks deferred()'s Suspense, which draws nothing).
  const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!--\/?\$-->/g, "");
  expect(html(<Menu open={false} onClose={() => {}} label="More"><MenuItem>x</MenuItem></Menu>)).toBe(html(<Ui.Menu open={false} onClose={() => {}} label="More"><Ui.MenuItem>x</Ui.MenuItem></Ui.Menu>));
  expect(html(<ContextMenu at={null} onClose={() => {}} label="Row"><MenuItem>x</MenuItem></ContextMenu>)).toBe("");
});
