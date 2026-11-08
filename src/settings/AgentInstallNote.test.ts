// T-787 (P3-14): an npm agent's Install says Windows will ask for admin permission while Node.js is missing.
// The note comes from the app (agents_list's installNote); the screens only show it.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AgentPickerView } from "../launch/AgentPicker";
import { installNoteOf, installTip } from "../launch/agentInstall";
import type { AgentInfo } from "../launch/PlusMenu";
import { rowWords } from "../launch/pickerRules";

const NOTE = "Needs Node.js (Windows will ask for admin permission)";
const agent = (id: string, o: Partial<AgentInfo> = {}): AgentInfo => ({ id, name: id.toUpperCase(), program: id, args: [], installed: false, path: null, installable: true, install: `npm install -g ${id}`, installNote: null, ...o });
const gemini = agent("gemini", { installNote: NOTE });

test("T-787: the checklist row and the tooltip carry the note for an npm agent while Node.js is missing", () => {
  expect(rowWords(gemini, {})).toBe(NOTE);
  expect(installTip(gemini)).toBe(`npm install -g gemini. ${NOTE}`);
  const html = renderToString(createElement(AgentPickerView, { agents: [gemini, agent("claude")], ticks: ["gemini"], progress: {}, busy: false, error: null, onToggle() {}, onAll() {}, onNone() {}, onInstall() {}, onWebsite() {} }));
  expect(html).toContain(NOTE);
  expect(html.match(/data-agent="claude"[\s\S]*?<\/li>/)?.[0]).not.toContain("Needs Node.js");
});

test("T-787: nothing is added when Node.js is already there, the agent is installed, or it cannot be installed here", () => {
  expect(installNoteOf(agent("gemini"))).toBeNull();
  expect(installTip(agent("gemini"))).toBe("npm install -g gemini");
  expect(installNoteOf({ ...gemini, installed: true })).toBeNull();
  expect(rowWords({ ...gemini, installed: true }, {})).toBe("Installed");
  expect(installNoteOf({ ...gemini, installable: false, install: null })).toBeNull();
  // a running or failed install shows its own words, not the note
  expect(rowWords(gemini, { gemini: { state: "installing" } })).toBe("Installing…");
});
