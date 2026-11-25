// The model and effort controls of an OpenCode chat (2026-11-24). Its list is not built in: it is the
// list OpenCode itself gives, handed to the controls once it has been read.
import { afterEach, expect, test } from "vitest";
import { choicesFor, clean, effortsFor, hasControls, routeOf, savedArgs, savedSeat, setChatModels } from "./controls";
import { seatStart } from "../launch/defaultSeat";
import { applyLineup, lineupOf, modelArgs, modelsFor, restoreShape, seatArgs, seatReady } from "../launch/seats";
import { restoreLayout } from "../terminal/layout";

const FLASH = "openrouter/deepseek/deepseek-v4.1-flash-1017";
const OPUS = "openrouter/anthropic/claude-opus-5.5";
const list = [
  { id: FLASH, label: "DeepSeek V4.1 Flash 1017", provider: "deepseek", efforts: ["none", "low", "high", "max"] },
  { id: OPUS, label: "Claude Opus 5.5", provider: "anthropic", efforts: ["max", "low", "xhigh", "medium", "high"] },
  { id: "openrouter/x/plain", label: "Plain", provider: "x", efforts: [] },
];

afterEach(() => setChatModels([]));

test("an OpenCode chat has the controls, and every pick is applied by the chat itself", () => {
  expect(hasControls("opencode")).toBe(true);
  expect(routeOf("opencode", "model")).toBe("launch");
  expect(routeOf("opencode", "effort")).toBe("launch");
});

test("its models are the ones OpenCode lists, with no default row to fall back to", () => {
  expect(choicesFor("opencode")).toEqual([]);
  setChatModels(list);
  expect(choicesFor("opencode").map((m) => m.id)).toEqual([FLASH, OPUS, "openrouter/x/plain"]);
  expect(choicesFor("opencode").map((m) => m.label)).toEqual(["DeepSeek V4.1 Flash 1017", "Claude Opus 5.5", "Plain"]);
});

test("each model offers its own effort levels, lowest first", () => {
  setChatModels(list);
  expect(effortsFor("opencode", FLASH)).toEqual(["none", "low", "high", "max"]);
  expect(effortsFor("opencode", OPUS)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(effortsFor("opencode", "openrouter/x/plain")).toEqual([]);
});

test("a saved pick waits for the list instead of being forgotten before it arrives", () => {
  expect(clean({ opencode: { model: OPUS, effort: "high" } })).toEqual({ opencode: { model: OPUS, effort: "high" } });
  setChatModels(list);
  expect(clean({ opencode: { model: OPUS, effort: "high" } })).toEqual({ opencode: { model: OPUS, effort: "high" } });
  expect(clean({ opencode: { model: "openrouter/gone/model", effort: "high" } })).toEqual({});
  expect(clean({ opencode: { model: FLASH, effort: "xhigh" } })).toEqual({ opencode: { model: FLASH } });
});

test("a chat's pick never lands on an OpenCode terminal's start line", () => {
  setChatModels(list);
  expect(savedArgs("opencode", { opencode: { model: OPUS, effort: "high" } })).toEqual([]);
});

// 2026-11-25: OpenCode's terminal has no --model flag. A model picked in a chat reached it from the Start
// screen, and the program refused to start ("Unrecognized flag: --model").
test("an OpenCode terminal started from the Start screen gets no model, whatever a chat or an old lineup kept", () => {
  setChatModels(list);
  const fresh = seatStart("opencode", { model: "opus", effort: "medium" }, savedSeat("opencode", { opencode: { model: OPUS, effort: "high" } }));
  expect(fresh).toEqual({ agent: "opencode", model: null });
  expect(seatArgs(fresh)).toEqual([]);
  const kept = applyLineup(lineupOf("custom", "shared", [{ agent: "opencode", model: OPUS, effort: "high" }]), ["opencode"]).seats[0];
  expect(kept).toEqual({ agent: "opencode", model: null });
  expect(seatReady(kept)).toBe(true);
  const team = restoreShape({ name: "kept", copies: "shared", seats: [{ agent: "opencode", model: OPUS, effort: "high" }] }, ["opencode"]);
  expect(team).toEqual([{ agent: "opencode", model: null }]);
  // Any other way a model reaches an OpenCode seat or pane still adds no flag.
  expect(seatArgs({ agent: "opencode", model: OPUS })).toEqual([]);
  expect(modelArgs(OPUS, "opencode")).toEqual([]);
});

// A restored tab runs on its saved arguments when the start line is not answered in time.
test("a saved OpenCode tab comes back without the model flag it was saved with", () => {
  const tab = (key: number, agentId: string) => ({ key, cwd: null, branch: null, agent: "shell", agentId, program: agentId, args: ["--auto", "--model", OPUS, "--model=x/y", "-c"] });
  const back = restoreLayout({ panes: [tab(1, "opencode"), tab(2, "aider")] });
  expect(back?.panes[0].args).toEqual(["--auto", "-c"]);
  expect(back?.panes[1].args).toEqual(["--auto", "--model", OPUS, "--model=x/y", "-c"]);
});

test("no model is routed through a gateway flag any more", () => {
  expect(modelArgs("anthropic/claude-opus-5.5", "othertool")).toEqual(["--model", "anthropic/claude-opus-5.5"]);
  expect(modelsFor("othertool")).toEqual([]);
});
