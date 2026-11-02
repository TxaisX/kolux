// Upgrade regression (the window half; the Rust half is src-tauri/tests/cards_19.rs app048_box2_*): the settings.json a
// profile written by the v0.1.5 release holds (src-tauri/tests/fixtures/profile-v0.1.5/, made by that release's own
// layoutOf and setting names, see scripts/profile-fixture.md) is read by today's window code, the same functions
// src/main.tsx settle() calls, and gives back exactly the layout and look that were saved. A setting renamed in the
// window, or a changed saved-layout shape, fails here.
import { expect, test } from "vitest";
import { readLook, stampLook } from "../settings/general";
import { readAppearance } from "../theme";
import { LAYOUT_FIELD, restoreLayout, stillThere } from "./layout";

// src has no node types; the builtin modules come through process.getBuiltinModule (as settings/__cards__/APP-048-050.test.ts does).
const process: any = (globalThis as any).process;
const builtin = (name: string): any => process.getBuiltinModule(name);
const fs = builtin("node:fs");
const path = builtin("node:path");
const dir: string = path.dirname(builtin("node:url").fileURLToPath(import.meta.url));
// FIXTURE_SETTINGS lets the failing demo in evidence/APP-048-fixture.txt point at a scratch copy with one key renamed.
const file: string = process.env.FIXTURE_SETTINGS ?? path.resolve(dir, "../../src-tauri/tests/fixtures/profile-v0.1.5/settings.json");
const settings: Record<string, unknown> = JSON.parse(fs.readFileSync(file, "utf8"));

const base = { branch: null, program: null, args: [] as string[] };

test("app048: today's restoreLayout reads the v0.1.5 saved layout back as the panes, tabs and focus that were saved", () => {
  const layout = restoreLayout(settings[LAYOUT_FIELD]);
  expect(layout).not.toBeNull();
  expect(layout!.panes).toEqual([
    { ...base, key: 1, cwd: "C:/fixture/alpha", agent: "claude", agentId: "claude", program: "claude", session: "5b0f6c1e-7a52-4c1d-9e0b-3f2a8d4c6b71", account: null, title: "alpha main", group: 1, pinned: true, color: "blue" },
    { ...base, key: 2, cwd: "C:/fixture/alpha", agent: "shell", title: "README.md", group: 1, kind: "editor", path: "C:/fixture/alpha/README.md" },
    { ...base, key: 3, cwd: "C:/fixture/alpha", agent: "shell", title: "main.rs", group: 1, kind: "editor", path: "C:/fixture/alpha/src/main.rs" },
    { ...base, key: 4, cwd: "C:/fixture/beta", agent: "shell", title: "beta shell", group: 4, color: "green" },
  ]);
  expect(layout!.activeTab).toEqual({ 1: 3, 4: 4 });
  expect(layout!.focused).toBe(3);
  expect(layout!.activeDir).toBe("C:/fixture/alpha");
  expect(layout!.stacked).toEqual({ "C:/fixture/beta": true });
  // the folders still exist: nothing is dropped on the way in
  expect(stillThere(layout!, () => true)).toEqual(layout);
});

test("app048: today's setting readers find the look, theme, mode and font the v0.1.5 window saved", () => {
  expect(readLook(settings)).toBe("new");
  expect(stampLook(settings)).toBeNull(); // the look and the mode are both there, so the first start writes nothing
  const a = readAppearance(settings);
  expect(a.theme).toBe("cobalt");
  expect(a.mode).toBe("dark");
  expect(a.appFont).toBe("Segoe UI");
});
