import { describe, expect, it } from "vitest";
import type { ChatItem } from "./model";
import { DEFAULT_MODEL, seatArgs } from "../launch/seats";
import { choicesFor, clean, confirmModel, controlsOff, effortsFor, failChange, failedChange, loadSaved, modelCommand, modelFromWords, opensPicker, readModel, routeOf, saveChoice, savedArgs, savedSeat, sentChange, statusText, MODEL_NOT_SENT, type Change } from "./controls";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const note = (text: string): ChatItem => ({ id: text, role: "status", kind: "notice", text });

describe("CHAT-024 choices", () => {
  it("the list names the agent's own default", () => {
    const list = choicesFor("claude");
    expect(list.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku", "default"]);
    expect(list[list.length - 1]?.label).toBe("Agent default");
  });
  it("effort levels run from minimal to max", () => {
    expect(effortsFor("claude", "opus")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("codex", "gpt-5")).toEqual(["minimal", "low", "medium", "high"]);
    expect(effortsFor("claude", "haiku")).toEqual([]);
  });
  it("Claude switches the model from the box; the rest is launch-only; Codex uses its picker", () => {
    expect(routeOf("claude", "model")).toBe("chat");
    expect(routeOf("claude", "effort")).toBe("launch");
    expect(routeOf("claude", "fast")).toBe("launch");
    expect(routeOf("codex", "model")).toBe("terminal");
    expect(routeOf("codex", "effort")).toBe("terminal");
    expect(modelCommand("sonnet")).toBe("/model sonnet");
  });
  it("a bare /model opens the picker; /model with words is sent", () => {
    expect(opensPicker("claude", "/model")).toBe(true);
    expect(opensPicker("claude", "  /model  ")).toBe(true);
    expect(opensPicker("claude", "/model sonnet")).toBe(false);
    expect(opensPicker("omp", "/model")).toBe(false);
  });
  it("words that match no known model give nothing", () => {
    expect(modelFromWords("claude", "sonnet")).toBe("sonnet");
    expect(modelFromWords("claude", "Claude Haiku")).toBe("haiku");
    expect(modelFromWords("claude", "banana split")).toBeNull();
    expect(modelFromWords("claude", "")).toBeNull();
  });
  it("controls are off while the agent works or has no terminal", () => {
    expect(controlsOff(true, true)).toBe(true);
    expect(controlsOff(false, false)).toBe(true);
    expect(controlsOff(false, true)).toBe(false);
  });
});

describe("CHAT-024 reading the model back", () => {
  it("reads the model the agent says it set", () => {
    expect(readModel("claude", [note("Set model to Opus 4.1")])).toBe("opus");
    expect(readModel("claude", [note("Set model to Sonnet"), note("hi")])).toBe("sonnet");
  });
  it("the newest word wins and an unknown model gives null", () => {
    expect(readModel("claude", [note("Set model to Opus"), note("Set model to Haiku")])).toBe("haiku");
    expect(readModel("claude", [note("Set model to Mystery")])).toBeNull();
    expect(readModel("claude", [])).toBeNull();
  });
  it("what the user typed is not a report", () => {
    expect(readModel("claude", [{ id: "u", role: "user", kind: "text", text: "Set model to opus" }])).toBeNull();
  });
});

describe("CHAT-024 sent and confirmed", () => {
  it("a change is sent until the agent shows it", () => {
    let c: Change[] = sentChange([], "model", "sonnet");
    expect(statusText(c[0])).toBe("Sent, not confirmed yet");
    c = confirmModel(c, "opus");
    expect(c[0].status).toBe("sent");
    c = confirmModel(c, "sonnet");
    expect(statusText(c[0])).toBe("Confirmed");
  });
  it("picking the agent's own default sends /model default, and the model it then reports confirms it", () => {
    expect(modelCommand(DEFAULT_MODEL)).toBe("/model default");
    const sent = sentChange([], "model", DEFAULT_MODEL);
    expect(statusText(sent[0])).toBe("Sent, not confirmed yet");
    expect(statusText(confirmModel(sent, null)[0])).toBe("Sent, not confirmed yet");
    expect(statusText(confirmModel(sent, "sonnet")[0])).toBe("Confirmed");
  });
  it("a pick that was not sent stays in the control as failed", () => {
    const c = failedChange([], "model", DEFAULT_MODEL, MODEL_NOT_SENT);
    expect(c[0]).toMatchObject({ what: "model", value: DEFAULT_MODEL, status: "failed", error: MODEL_NOT_SENT });
    expect(statusText(c[0])).toBe(MODEL_NOT_SENT);
  });
  it("a failure for a replaced change is ignored", () => {
    let c = sentChange([], "model", "sonnet");
    const first = c[0].seq;
    c = sentChange(c, "model", "haiku");
    expect(failChange(c, first, "boom")).toEqual(c);
    expect(failChange(c, c[0].seq, "boom")[0].status).toBe("failed");
  });
  it("changes of different kinds sit side by side", () => {
    const c = sentChange(sentChange([], "model", "opus"), "effort", "high");
    expect(c.map((x) => x.what)).toEqual(["model", "effort"]);
  });
});

describe("CHAT-024 saved launch choices", () => {
  it("empty by default", () => {
    expect(loadSaved(mem())).toEqual({});
    expect(savedArgs("claude", {})).toEqual([]);
  });
  it("a saved model and effort give the launch arguments", () => {
    const s = mem();
    saveChoice("claude", { model: "sonnet" }, s);
    saveChoice("claude", { effort: "high" }, s);
    expect(loadSaved(s)).toEqual({ claude: { model: "sonnet", effort: "high" } });
    expect(savedArgs("claude", loadSaved(s))).toEqual(["--model", "sonnet", "--effort", "high"]);
  });
  it("a model the provider withdrew is forgotten and the next launch uses the agent's default", () => {
    const s = mem();
    s.setItem("kolux.chat.launchChoices", JSON.stringify({ claude: { model: "retired-model", effort: "high" }, codex: { model: "gpt-5" } }));
    expect(loadSaved(s)).toEqual({ codex: { model: "gpt-5" } });
    expect(savedArgs("claude", loadSaved(s))).toEqual([]);
  });
  it("a new model drops the old model's effort", () => {
    const s = mem();
    saveChoice("claude", { model: "opus", effort: "max" }, s);
    saveChoice("claude", { model: "haiku" }, s);
    expect(loadSaved(s)).toEqual({ claude: { model: "haiku" } });
  });
  it("fast mode is kept only for a model that offers it", () => {
    expect(clean({ claude: { model: "sonnet", fast: true } })).toEqual({ claude: { model: "sonnet" } });
    expect(clean({ claude: { model: "opus", fast: true } })).toEqual({ claude: { model: "opus", fast: true } });
  });
  it("row 389: picking an agent in the launch pane starts from its saved choice, so the launch carries its arguments", () => {
    const s = mem();
    saveChoice("claude", { model: "sonnet", effort: "high" }, s);
    const seat = { agent: "claude", ...savedSeat("claude", loadSaved(s)) };
    expect(seat).toEqual({ agent: "claude", model: "sonnet", effort: "high", fast: undefined });
    expect(seatArgs(seat)).toEqual(savedArgs("claude", loadSaved(s)));
    // Nothing saved: the seat still waits for an explicit model pick.
    expect(savedSeat("codex", loadSaved(s))).toEqual({ model: null, effort: undefined, fast: undefined });
  });
  it("broken storage gives an empty set", () => {
    const s = mem();
    s.setItem("kolux.chat.launchChoices", "{not json");
    expect(loadSaved(s)).toEqual({});
    expect(loadSaved({ getItem: () => { throw new Error("blocked"); } })).toEqual({});
  });
});
