import { expect, test } from "vitest";
import content from "./Content.tsx?raw";

test("the full-page screens sit inside a boundary that restarts when the screen changes", () => {
  const open = content.indexOf("<ScreenBoundary key={screen}>");
  const close = content.indexOf("</ScreenBoundary>");
  expect(open).toBeGreaterThan(0);
  expect(close).toBeGreaterThan(open);
  const inside = content.slice(open, close);
  for (const screen of ["<ArtifactsPage", "<SkillsPage", "<InboxView", "<AgentsChat", "<TowerView", "<FloorView", "<SpaceView"]) expect(inside, screen).toContain(screen);
});
