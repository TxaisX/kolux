import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ClaudeSetupPage, { ClaudeSetupView, PRECEDENCE, sizeOf, type ClaudeSetup } from "./ClaudeSetupPage";

const data: ClaudeSetup = {
  configDir: "C:/Users/a/.claude",
  managedDir: "C:/Program Files/ClaudeCode",
  workspace: "C:/w",
  sources: [
    { scope: "managed", label: "managed-settings.json", path: "C:/Program Files/ClaudeCode/managed-settings.json", state: "missing" },
    { scope: "project", label: ".claude/settings.json", path: "C:/w/.claude/settings.json", state: "found" },
    { scope: "user", label: "settings.json", path: "C:/Users/a/.claude/settings.json", state: "found" },
  ],
  model: { key: "model", value: "opus", scope: "project", path: "C:/w/.claude/settings.json", also: ["user"] },
  settings: [{ key: "theme", value: "light", scope: "project", path: "C:/w/.claude/settings.json", also: ["user"] }],
  permissions: { allow: [{ rule: "Bash(ls)", scope: "user" }], ask: [], deny: [{ rule: "WebFetch", scope: "managed" }], directories: [], defaultMode: null },
  hooks: [{ event: "PreToolUse", matcher: "Bash", kind: "command", command: "check.sh", scope: "local" }],
  mcp: [{ name: "files", kind: "stdio", target: "npx srv", env: [{ key: "API_KEY", value: "••••" }], headers: [], scope: "user", from: ".claude.json", off: true }],
  mcpFlags: [],
  skills: [{ name: "alpha", description: "Does alpha", scope: "user", path: "C:/Users/a/.claude/skills/alpha/SKILL.md" }],
  agents: [],
  plugins: [{ id: "a@m", enabled: true, version: null, scope: "user", from: "settings" }],
  memory: [{ path: "C:/w/CLAUDE.md", kind: "CLAUDE.md", scope: "project", bytes: 2048 }],
  files: {
    settings: [{ scope: "project", label: ".claude/settings.json", path: "C:/w/.claude/settings.json" }, { scope: "user", label: "settings.json", path: "C:/Users/a/.claude/settings.json" }],
    mcp: [{ scope: "user", label: ".claude.json", path: "C:/Users/a/.claude.json" }],
    plugins: [],
  },
  reads: ["C:/w/.claude/settings.json"],
  notes: [],
};
const html = (d: ClaudeSetup | null, error = "") => renderToString(createElement(ClaudeSetupView, { data: d, error, open: () => {} }));

test("T-651: the precedence strip runs Managed > CLI > Local > Project > User", () => {
  expect(PRECEDENCE).toEqual(["managed", "cli", "local", "project", "user"]);
  const h = html(data);
  const at = ["Managed", "CLI", "Local", "Project", "User"].map((s) => h.indexOf(`data-scope="${s.toLowerCase()}"`));
  expect(at.every((n) => n > 0) && at.every((n, i) => i === 0 || n > at[i - 1])).toBe(true);
});

test("T-651: every section is there and each row has a scope badge", () => {
  const h = html(data);
  for (const id of ["model", "settings", "permissions", "hooks", "mcp", "skills", "agents", "plugins", "memory", "shared"]) expect(h).toContain(`data-section="${id}"`);
  expect(h).toContain("also set in User");
  expect(h).toContain("API_KEY=••••");
  expect(h).toContain("files (off)");
  expect(h).toContain("No subagents found.");
});

test("T-651: Open file buttons: one file says Open file, several name each file", () => {
  const h = html(data);
  expect(h).toContain(">Open file<");
  expect(h).toContain("Open: .claude/settings.json");
  expect(h).toContain("Open: settings.json");
  expect(h).toContain("2.0 KB");
});

test("T-651: long values are cut with a tooltip, never a wider page", () => {
  const long = "x".repeat(300);
  const h = html({ ...data, settings: [{ key: "k", value: long, scope: "user", path: "p", also: [] }] });
  expect(h).toContain(`title="${long}"`);
  expect(h).toContain("text-overflow:ellipsis");
  expect(h).toContain("white-space:nowrap");
});

test("T-651: loading and failure states", () => {
  expect(html(null)).toContain("Reading the Claude setup");
  expect(html(null, "boom")).toContain('role="alert"');
  expect(sizeOf(12)).toBe("12 B");
});

test("T-651: each setting row names its source file in a tooltip and has an Open button for it", () => {
  const h = html(data);
  expect(h).toContain('title="Set in C:/w/.claude/settings.json"');
  expect(h).toContain('aria-label="Open C:/w/.claude/settings.json"');
  expect(h).toContain(">Open</button>");
});

test("T-651: the tab opens on the workspace in the window, not the last pick", () => {
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => (k === "kolux.claudeTabWorkspace" ? "C:/old" : null), setItem: () => {} };
  try {
    const h = renderToString(createElement(ClaudeSetupPage, { active: "C:/open" }));
    expect(h).toContain('value="C:/open"');
    expect(h).not.toContain("C:/old");
    expect(renderToString(createElement(ClaudeSetupPage))).toContain('value="C:/old"');
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = was;
  }
});
