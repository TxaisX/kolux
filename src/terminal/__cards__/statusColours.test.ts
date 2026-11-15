// D-01 to D-04 (design audit, wave 2026-11-15): one colour per state on every status surface (rule 7).
// working and unread = cyan (--working), needs you = yellow (--working-icon), failed / cannot reach / error /
// deleted = red (--status-bad), done = green (--done / --done-icon), stopped and idle = grey.
import { expect, test } from "vitest";
import { VOCAB } from "../status";
import { classic, buildTheme, readAppearance, THEMES, contrast } from "../../theme";

const fsName = "node:fs";
const read = async (rel: string): Promise<string> => ((await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, e: string) => string }).readFileSync(new URL(rel, import.meta.url), "utf8");
const styles = await read("../../styles.css");
const tower = await read("../../tower/tower.css");
const rows = await read("../../sessions/rows.css");
const chat = await read("../../chat/chat.css");
const extras = await read("../../editor/editor-extras.css");
const insights = await read("../../insights/insights.css");

test("failed and cannot reach have their own red tone, apart from needs you", () => {
  expect(VOCAB.failed.tone).toBe("bad");
  expect(VOCAB.unreachable.tone).toBe("bad");
  expect(VOCAB.permission.tone).toBe("attention");
  expect(classic["status-bad"]).toBe("#ef5350");
});

test("working is cyan and needs you yellow on every surface that shows both", () => {
  expect(styles).toMatch(/\.tab \.badge\.working, \.tab \.badge\.background \{ color: var\(--working\); \}/);
  expect(styles).toMatch(/\.tab \.badge\.unread \{ color: var\(--working\); \}/);
  expect(styles).toMatch(/\.tab \.badge\.permission \{ color: var\(--working-icon\); \}/);
  expect(styles).toMatch(/\.pane-head \.st\.working \{ color: var\(--working\); \}/);
  expect(styles).toMatch(/\.pane-head \.st\.bad \{ color: var\(--status-bad\); \}/);
  expect(styles).toMatch(/\.inbox \.row\.working \.st \{ color: var\(--working\); \}/);
  expect(styles).toMatch(/\.sb-list \.dot\.live, \.sb-list \.dot\.working \{ background: var\(--working\); \}/);
  expect(tower).toMatch(/\.tower \.row\.working \.st \{ color: var\(--working\); \}/);
  expect(rows).toMatch(/\.session-dot\.running \{ background: var\(--working\); \}/);
});

test("errors and deleted lines are red; stopped is grey", () => {
  expect(chat).toMatch(/\.chat-error \{ color: var\(--status-bad\); \}/);
  expect(chat).toMatch(/\.chat-out \.dl\.del \{ color: var\(--status-bad\); \}/);
  expect(extras).toMatch(/\.cs-status\.bad \{ color: var\(--status-bad\); \}/);
  expect(extras).toMatch(/kx-hl-del\) \{ color: var\(--status-bad\); \}/);
  expect(insights).toMatch(/\.ins-pill\.stopped \{ color: var\(--fg-faint\);/);
});

test("the status colours read on every built-in theme, dark and light (3:1 dot, 4.5:1 word)", () => {
  const base = readAppearance({});
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      const t = buildTheme({ ...base, theme }, dark);
      for (const ground of [t["pane-bg"], t.surface]) {
        expect(contrast(t["status-bad"], ground), `${theme} ${dark ? "dark" : "light"} status-bad`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.working, ground), `${theme} ${dark ? "dark" : "light"} working`).toBeGreaterThanOrEqual(3);
        expect(contrast(t["working-icon"], ground), `${theme} ${dark ? "dark" : "light"} working-icon`).toBeGreaterThanOrEqual(3);
      }
    }
  }
});
