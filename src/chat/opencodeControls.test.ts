// The model and effort controls of an OpenCode chat (2026-11-24). Its list is not built in: it is the
// list OpenCode itself gives, handed to the controls once it has been read.
import { afterEach, expect, test } from "vitest";
import { choicesFor, clean, effortsFor, hasControls, routeOf, savedArgs, setChatModels } from "./controls";
import { modelArgs, modelsFor } from "../launch/seats";

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

test("no model is routed through a gateway flag any more", () => {
  expect(modelArgs("anthropic/claude-opus-5.5", "othertool")).toEqual(["--model", "anthropic/claude-opus-5.5"]);
  expect(modelsFor("othertool")).toEqual([]);
});
