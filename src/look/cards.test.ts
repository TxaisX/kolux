import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CARD_DENSITY_FIELD, CARD_DETAILS_FIELD, detailsAfter, cardLine, cardShows, cardTitle, CARD_DETAILS, PRESETS, portsWords, densityPatch, hoverLines, presetMark, readCardDetails, tidyDetails, type CardFacts } from "./cards";
import CardLine from "./CardLine";

const facts = (o: Partial<CardFacts> = {}): CardFacts => ({ agents: 0, state: "idle", pr: null, changed: 0, note: null, ...o });

test("PROJ-062 / T-609: nothing saved is the Default preset: status, the agent summary and the changed-file count", () => {
  expect(readCardDetails({})).toEqual({ shown: ["status", "agents", "changes"], density: "default" });
  expect(cardShows({}, "changes"), "T-609: the count is on by default").toBe(true);
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "nonsense" }).density).toBe("default");
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "compact" })).toEqual({ shown: ["status"], density: "compact" });
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "detailed" }).shown).toEqual(["status", "agents", "pr", "changes", "note"]);
});

test("PROJ-062: status stays on in both presets and in any custom set; older profiles get no duplicates or unknown ids", () => {
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "compact" }).shown).toContain("status");
  const odd = readCardDetails({ [CARD_DETAILS_FIELD]: ["pr", "pr", "note", "ports-of-call", 7, "agents", "agents"] });
  expect(odd.shown).toEqual(["status", "agents", "pr", "note"]);
  expect(odd.density).toBe("custom");
  expect(tidyDetails(["pr"])).toEqual(["status", "pr"]);
  expect(tidyDetails("nope")).toEqual(["status"]);
});

test("PROJ-062: an empty custom list follows the preset, so a preset keeps up with later details", () => {
  expect(readCardDetails({ [CARD_DENSITY_FIELD]: "detailed", [CARD_DETAILS_FIELD]: [] }).density).toBe("detailed");
  expect(cardShows({ [CARD_DENSITY_FIELD]: "compact" }, "agents")).toBe(false);
  expect(cardShows({}, "agents")).toBe(true);
});

test("SET-021: picking a preset saves it and clears any custom list", () => {
  expect(densityPatch("compact")).toEqual({ workspaceCardDensity: "compact", workspaceCardDetails: [] });
});

test("PROJ-062: the card's second line says agents, state, pull request, changes and note, and only for what is shown", () => {
  const f = facts({ agents: 2, state: "permission", pr: "open", changed: 3, note: "  first line\nsecond" });
  expect(cardLine(["status", "agents"], f)).toBe("2 agents · Needs you");
  expect(cardLine(["status"], f), "Compact draws no second line").toBeNull();
  expect(cardLine(readCardDetails({ workspaceCardDensity: "detailed" }).shown, f)).toBe("2 agents · Needs you · Pull request open · 3 changed files · first line");
  expect(cardLine(["status", "agents"], facts()), "an idle workspace with no agent says nothing").toBeNull();
  expect(cardLine(["status", "agents"], facts({ agents: 1, state: "working" }))).toBe("1 agent · Working");
  expect(cardLine(["status", "changes"], facts({ changed: 1 }))).toBe("1 changed file");
  expect(cardLine(["status", "note"], facts({ note: "x".repeat(80) }))?.length).toBe(60);
});

test("PROJ-062: Compact hover lists the pull request and the rest, and a long title shows even when the branch is shown", () => {
  const f = facts({ pr: "draft", changed: 2, agents: 1, state: "working" });
  expect(hoverLines(["status"], f)).toEqual(["1 agent · Working", "Draft pull request", "2 changed files"]);
  const t = cardTitle("a very long workspace title", "feature/x", ["status"], f, "Show C:\\w\\x");
  expect(t.split("\n")).toEqual(["a very long workspace title", "Branch feature/x", "1 agent · Working", "Draft pull request", "2 changed files", "Show C:\\w\\x"]);
  expect(cardTitle("same", "same", ["status", "agents", "pr", "changes", "note"], f, "Show p")).toBe("same\nShow p");
});

test("PROJ-062: CardLine draws the line indented under the name, or nothing", () => {
  const html = renderToString(createElement(CardLine, { shown: ["status", "agents"], facts: facts({ agents: 1, state: "working" }), depth: 1 }));
  expect(html).toContain("1 agent · Working");
  expect(html).toContain("padding-left:58px");
  expect(renderToString(createElement(CardLine, { shown: ["status", "agents"], facts: facts({ agents: 1, state: "working" }) }))).toContain("padding-left:44px");
  expect(renderToString(createElement(CardLine, { shown: ["status"], facts: facts({ agents: 1, state: "working" }), depth: 0 }))).toBe("");
});

test("FIX-2: an explicit indent wins over depth, and 0 is an indent too", () => {
  const line = (extra: object) => renderToString(createElement(CardLine, { shown: ["status", "agents"], facts: facts({ agents: 1, state: "working" }), ...extra }));
  expect(line({ depth: 2, indent: 10 })).toContain("padding-left:10px");
  expect(line({ depth: 2, indent: 10 })).not.toContain("padding-left:72px");
  expect(line({ depth: 3, indent: 0 }), "indent 0 is given, so it wins").toContain("padding-left:0");
  expect(line({ depth: 2 })).toContain("padding-left:72px");
});

// FIX-1: the sidebar's chooser writes ONE setting per tick (the sidebar saves one key per call), so a
// set that equals a preset is saved as that preset's marker, not as a literal list: the card keeps
// following the preset when a later version adds a detail to it.
const settle = (start: Record<string, unknown>, steps: Array<[string, boolean]>) => {
  let s = start;
  for (const [id, on] of steps) s = { ...s, [CARD_DETAILS_FIELD]: detailsAfter(s, id, on) };
  return s;
};

test("PROJ-062: the sidebar chooser saves a custom list for a custom set and a preset marker for a preset-equal set", () => {
  expect(detailsAfter({}, "pr", true), "Default plus a pull request is custom").toEqual(["status", "agents", "pr", "changes"]);
  expect(detailsAfter({}, "agents", false), "Default minus the summary is custom").toEqual(["status", "changes"]);
  expect(detailsAfter({ [CARD_DETAILS_FIELD]: ["status", "changes"] }, "changes", false), "and minus the count too is Compact").toEqual([presetMark("compact")]);
  expect(detailsAfter({}, "status", false), "status stays on").toEqual([presetMark("default")]);
  expect(detailsAfter({}, "mystery", true)).toEqual([presetMark("default")]);
});

test("PROJ-062: unticking back to a preset follows the preset again (the frozen-list problem)", () => {
  const detailed = { [CARD_DENSITY_FIELD]: "detailed" };
  const trimmed = settle(detailed, [["pr", false], ["changes", false]]);
  expect(readCardDetails(trimmed)).toEqual({ shown: ["status", "agents", "note"], density: "custom" });
  const back = settle(trimmed, [["note", false], ["changes", true]]);
  expect(back[CARD_DETAILS_FIELD], "not a literal list").toEqual([presetMark("default")]);
  expect(readCardDetails(back)).toEqual({ shown: ["status", "agents", "changes"], density: "default" });
  const full = settle(back, [["pr", true], ["note", true]]);
  expect(full[CARD_DETAILS_FIELD]).toEqual([presetMark("detailed")]);
  expect(readCardDetails(full).density).toBe("detailed");
});

test("PROJ-062: a preset marker survives the settings file, wins over the density setting, and is cleared by the Settings page", () => {
  const saved = JSON.parse(JSON.stringify({ [CARD_DENSITY_FIELD]: "detailed", [CARD_DETAILS_FIELD]: [presetMark("compact")] }));
  expect(readCardDetails(saved)).toEqual({ shown: ["status"], density: "compact" });
  expect(readCardDetails({ ...saved, ...densityPatch("detailed") }).density).toBe("detailed");
  expect(readCardDetails({ [CARD_DETAILS_FIELD]: ["preset:nonsense"] }).density, "an unknown marker is just an empty list").toBe("default");
});

test("PROJ-062 (T-266-b): Compact's hover lists the pull request, the ports and the task", () => {
  const f = facts({ pr: "open", ports: [5173, 3000], task: 42 });
  expect(hoverLines(["status"], f)).toEqual(["Pull request open", "Ports 3000, 5173", "Task #42"]);
  expect(cardTitle("fox", "fox", ["status"], f, "Show C:\w\fox")).toBe("fox\nPull request open\nPorts 3000, 5173\nTask #42\nShow C:\w\fox");
});

test("PROJ-062 (T-266-b): ports and task are separate details; ticked, they move from the hover to the card line", () => {
  const f = facts({ ports: [8080], task: 7 });
  expect(hoverLines(["status", "agents", "ports"], f)).toEqual(["Task #7"]);
  expect(cardLine(["status", "ports", "task"], f)).toBe("Port 8080 · Task #7");
  expect(CARD_DETAILS.map((d) => d.id)).toEqual(expect.arrayContaining(["ports", "task"]));
  for (const p of Object.values(PRESETS)) expect(p).not.toContain("ports");
  expect(detailsAfter({}, "ports", true)).toEqual(["status", "agents", "changes", "ports"]);
});

test("PROJ-062 (T-266-b): empty cases say nothing", () => {
  expect(hoverLines(["status"], facts())).toEqual([]);
  expect(hoverLines(["status"], facts({ ports: [], task: null }))).toEqual([]);
  expect(hoverLines(["status"], facts({ task: 0 }))).toEqual([]);
  expect(portsWords([])).toBeNull();
  expect(cardLine(["status", "ports", "task"], facts())).toBeNull();
});

test("PROJ-062 (T-266-b): ports read well: once each, smallest first, four at most, bad numbers dropped", () => {
  expect(portsWords([3000])).toBe("Port 3000");
  expect(portsWords([5173, 3000, 5173])).toBe("Ports 3000, 5173");
  expect(portsWords([9, 8, 7, 6, 5, 4])).toBe("Ports 4, 5, 6, 7 +2 more");
  expect(portsWords([0, -1, 70000, 1.5])).toBeNull();
});

test("PROJ-062 (T-266-b): the hover text reaches a rendered card", () => {
  const html = renderToString(createElement(CardLine, { shown: ["status", "ports"], facts: facts({ ports: [4000] }) }));
  expect(html).toContain("Port 4000");
  expect(renderToString(createElement(CardLine, { shown: ["status", "ports"], facts: facts() }))).not.toContain("Port");
});
